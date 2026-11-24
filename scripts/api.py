#   This is the web API
#   The only module the website calls. It runs in the visitor's browser through
#   Pyodide. Plain Python floats, ints, strings, lists, dicts and None go in and
#   come out: no numpy types and no objects.
#
#   Wiring only. It builds whatever instrument the visitor enters from the
#   engine's classes, builds a Market keyed by the underlying's name, and prices
#   it with each derivative's own price() and payoff(), greeks.py, and batch.py
#   (which runs many of the engine's trees in one pass). The arithmetic here is
#   arranging those results: differences against a reference price, unit
#   conversions, the same bump-and-reprice steps greeks.py uses (done in one
#   batch for the tree instruments), and the fits and differences the delta and
#   gamma charts need.

#   David Smith

import json
import math
import numbers

import numpy as np

from market import Market
from derivatives import (
    EuropeanCallOption,
    EuropeanPutOption,
    AmericanCallOption,
    AmericanPutOption,
    Future,
    RatesFuture,
    Convertible,
)
from greeks import delta, gamma, vega, rho, theta
from batch import price_many

# Binomial steps for the tree instruments' (American options, convertible)
# value curves, delta and gamma (curves and headline), vega and rho, and
# ladders. The headline price, base_price, the bond floor, the convertible's
# vega (see DEFAULT_STEP_VEGA), and the theta chart with the headline theta use
# each instrument's own default steps from derivatives.py.
CURVE_STEPS = 80

# Instrument types the site can build, the engine class behind each, what kind
# of value tile it gets, and which contract terms it needs.
TYPES = {
    "european_call": {"kind": "option", "terms": ("strike", "expiry_years")},
    "european_put": {"kind": "option", "terms": ("strike", "expiry_years")},
    "american_call": {"kind": "option", "terms": ("strike", "expiry_years")},
    "american_put": {"kind": "option", "terms": ("strike", "expiry_years")},
    "future": {"kind": "future", "terms": ("expiry_years",)},
    "sofr_future": {"kind": "rates", "terms": ()},
    "convertible": {"kind": "convertible", "terms": ("expiry_years", "face", "conversion_ratio")},
}
TREE_TYPES = ("american_call", "american_put", "convertible")

# Which market inputs each kind reads (the sliders the Explorer shows)
APPLIES = {
    "option": ("spot", "vol", "time", "rate"),
    "future": ("spot", "time", "rate"),
    "rates": ("rate",),
    "convertible": ("spot", "vol", "time", "rate", "credit_spread"),
}

SOFR_UNDERLYING = "SOFR"
SOFR_EXPIRY = 0.25                                 # RatesFuture needs an expiry; its price doesn't read it

# Tree instruments: delta and gamma reprice spot at S*exp(+h) and S*exp(-h), with
#   h = TREE_BUMP_NODES * sigma * sqrt(T / N)
# where sigma is the underlying's vol in the market being priced, T the
# instrument's years to expiry and N the tree steps of that calculation. One
# up-move of the tree is exp(sigma * sqrt(T / N)) and the tree's price wobbles
# with a period of two up-moves in log spot, so each side of the bump spans
# exactly one wobble and S*exp(+h), S and S*exp(-h) all sit at the same point
# of it: the wobble cancels out of the differences. (A relative bump S(1 +/- h)
# is uneven in log spot, its two sides land at different points of the wobble,
# and the convertible's gamma dipped below zero.) The two steps are unequal in
# spot, so delta and gamma use the central differences for unequal steps
# (_tree_delta_gamma), which are greeks.delta's and greeks.gamma's when the
# steps are equal.
TREE_BUMP_NODES = 2
SMOOTH_POINTS = 3                                  # convertible display curves: fit over +/-3 grid points
VEGA_BUMP_PCT = 0.01                               # greeks.vega's default bump: 1% of vol
RHO_BUMP_PCT = 0.01                                # greeks.rho's default bump: 1% of the rate

# Tree types whose point vega uses the default-step tree instead of
# CURVE_STEPS. On 80 steps the convertible's vega bump (1% of vol) can straddle
# a node crossing the conversion point: at 35% vol it read 12.14 per point
# against 6.19 on 500 steps. Its two vega rows go in their own batch.
DEFAULT_STEP_VEGA = ("convertible",)

GRID_POINTS = 61                                   # levels on the value chart's x axis
THETA_POINTS = 41                                  # points on the value-to-expiry path
# The trees price every theta-chart point on the default-step tree (500 steps),
# about 6 ms each in the browser, so they get fewer: one every twelfth of the
# life, which keeps a spot move on the convertible near 135 ms instead of 300.
# Odd, so the chart's labeled middle point sits at half the life.
TREE_THETA_POINTS = 13
SPOT_RANGE = {"convertible": 0.50}                 # chart range either side of setup spot
DEFAULT_SPOT_RANGE = 0.30
SOFR_RATE_TOP = 0.08                               # SOFR chart: 0% to the larger of 8% and twice the setup rate
HALF_TIME = 0.5                                    # "at half the time left" curve
FIFTEEN_TIME = 0.15                                # "at 15% of the time left" curve
VOL_LADDER = (-0.10, -0.05, 0.05, 0.10)            # -10, -5, +5, +10 volatility points
RATE_LADDER = (-0.0050, -0.0025, 0.0025, 0.0050)   # -50, -25, +25, +50 basis points
DAYS_PER_YEAR = 365                                # same day count greeks.theta uses (1/365)

_BASE_PRICE = {}
_BASE_PRICE_SIZE = 64
_CURVE_CACHE = {}
_CURVE_CACHE_SIZE = 24


# ---------------------------------------------------------------- helpers

def _plain(x):
    # Recursively turn numpy scalars into Python numbers, and NaN or inf into None,
    # so the result survives json.dumps(allow_nan=False) and Pyodide's conversion.
    if x is None or isinstance(x, (bool, str)):
        return x
    if isinstance(x, dict):
        return {str(k): _plain(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_plain(v) for v in x]
    if isinstance(x, numbers.Integral):
        return int(x)
    if isinstance(x, numbers.Real):
        f = float(x)
        return f if math.isfinite(f) else None
    raise TypeError(f"api returned a {type(x).__name__}, which isn't plain data")


def _remember(cache, size, key, value):
    if len(cache) >= size:
        cache.pop(next(iter(cache)))
    cache[key] = value
    return value


def _positive(spec, name):
    v = spec.get(name)
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v <= 0:
        raise ValueError(f"{name} must be a number above zero, got {v!r}")
    return float(v)


def make_derivative(spec, steps=None):
    """Build one instrument from the engine's classes.

    spec: {"type": one of TYPES, "underlying": name (not needed for sofr_future),
           plus whichever of strike, expiry_years, face, conversion_ratio the type needs}
    steps: None keeps each tree class's own default; a number builds the same
           tree with that many steps. Non-tree classes ignore it.
    """
    t = spec.get("type")
    if t not in TYPES:
        raise ValueError(f"unknown instrument type {t!r}")
    und = SOFR_UNDERLYING if t == "sofr_future" else spec.get("underlying")
    if not isinstance(und, str) or not und:
        raise ValueError("the instrument needs an underlying")
    tree = {} if steps is None else {"steps": steps}
    if t == "sofr_future":
        expiry = spec.get("expiry_years") or SOFR_EXPIRY
        return RatesFuture(und, expiry)
    expiry = _positive(spec, "expiry_years")
    if t == "future":
        return Future(und, expiry)
    if t == "convertible":
        return Convertible(und, expiry, _positive(spec, "conversion_ratio"), _positive(spec, "face"), **tree)
    strike = _positive(spec, "strike")
    if t == "european_call":
        return EuropeanCallOption(und, strike, expiry)
    if t == "european_put":
        return EuropeanPutOption(und, strike, expiry)
    if t == "american_call":
        return AmericanCallOption(und, strike, expiry, **tree)
    return AmericanPutOption(und, strike, expiry, **tree)


def _value(deriv, market):
    # The engine's price, with one guard. EuropeanCallOption.price() and
    # EuropeanPutOption.price() run Black-Scholes, which divides by sigma*sqrt(T)
    # and returns NaN once T reaches 0. At or past expiry, use the option's own
    # payoff(), the same way tree_price() does in derivatives.py. Every other
    # class already handles T <= 0 in its price().
    if isinstance(deriv, (EuropeanCallOption, EuropeanPutOption)) and deriv.time_to_expiry(market) <= 0:
        return deriv.payoff(market.spot(deriv.underlying))
    return deriv.price(market)


def _is_tree_deriv(deriv):
    return isinstance(deriv, (AmericanPutOption, AmericanCallOption, Convertible))


def _many(deriv, markets):
    # One derivative across many markets. Tree instruments go through
    # batch.price_many in one pass; the rest are priced one market at a time
    # through _value, which keeps the European expiry guard.
    if _is_tree_deriv(deriv):
        return list(price_many(deriv, markets))
    return [_value(deriv, m) for m in markets]


def _many_or_none(deriv, markets):
    # Like _many, but a market the tree can't price (trees.py refuses when the
    # up-move probability leaves 0..1, e.g. very low vol with a high rate) gets
    # None instead of sinking the whole batch.
    try:
        return _many(deriv, markets)
    except ValueError:
        out = []
        for m in markets:
            try:
                out.append(_many(deriv, [m])[0])
            except ValueError:
                out.append(None)
        return out


def _smooth_weights(k):
    # Weights that turn 2k+1 evenly spaced prices into the value, at the middle
    # one, of the least-squares quadratic through them (the same kind of fit as
    # batch.fitted_delta_gamma). On an even grid that weighted average is the
    # same at every point, so the fit is applied as one weighted sum.
    x = np.arange(-k, k + 1, dtype=float)
    return np.linalg.pinv(np.vander(x, 3))[2]  # row for the constant term = fitted value at x = 0


_SMOOTH_W = _smooth_weights(SMOOTH_POINTS)


def _smooth(ys):
    # Replace each point with its +/-SMOOTH_POINTS quadratic fit's value. The
    # first and last SMOOTH_POINTS points have no full window and stay as they
    # are; callers pad the grid so those never reach the chart.
    y = np.asarray(ys, dtype=float)
    out = y.copy()
    k = SMOOTH_POINTS
    out[k:-k] = np.correlate(y, _SMOOTH_W, mode="valid")
    return list(out)


# ---------------------------------------------------------------- one instrument

class _Setup:
    # Everything fixed by the visitor's setup: the instrument (at default and at
    # CURVE_STEPS), the market they typed in, and the chart grid.
    def __init__(self, spec, base):
        self.spec = spec
        self.type = spec.get("type")
        self.full = make_derivative(spec)
        self.curve = make_derivative(spec, CURVE_STEPS) if self.type in TREE_TYPES else self.full
        self.kind = TYPES[self.type]["kind"]
        self.applies = APPLIES[self.kind]
        self.und = self.full.underlying
        self.tree = self.type in TREE_TYPES
        self.key = json.dumps([spec, base], sort_keys=True)

        rate = float(base["rate"])
        if "vol" in self.applies and base.get("vol") is None:
            raise ValueError(f"{self.type} needs a volatility")
        if self.kind == "rates":
            self.market = Market(0.0, rate, {}, {}, {}, {})
        else:
            u = self.und
            vols = {} if base.get("vol") is None else {u: float(base["vol"])}
            self.market = Market(
                time=0.0,
                rate=rate,
                spots={u: _positive(base, "spot")},
                vols=vols,
                div_yields={u: float(base.get("div_yield") or 0.0)},
                credit_spreads={u: float(base.get("credit_spread") or 0.0)},
            )

        if self.kind == "rates":
            lo, hi = 0.0, max(SOFR_RATE_TOP, math.ceil(rate * 2 * 100) / 100)
        else:
            s0 = self.market.spot(self.und)
            r = SPOT_RANGE.get(self.type, DEFAULT_SPOT_RANGE)
            lo, hi = s0 * (1 - r), s0 * (1 + r)
        self.h = (hi - lo) / (GRID_POINTS - 1)
        self.xs = [lo + i * self.h for i in range(GRID_POINTS)]

    def pad(self):
        # Extra grid levels on each side of the chart range. Black-Scholes and the
        # future need one, for central differences. The convertible needs enough
        # for its display smoothing; the American options need none.
        if not self.tree:
            return 1
        return SMOOTH_POINTS if self.kind == "convertible" else 0

    def now(self, now):
        # The setup market with the slider state applied. Inputs this kind
        # doesn't read are ignored, and missing ones keep the setup value.
        now = now or {}
        m = self.market
        u = self.und
        if "time" in self.applies and now.get("days_passed"):
            m = m.set("time", now["days_passed"] / DAYS_PER_YEAR)
        if now.get("rate") is not None:
            m = m.set("rate", now["rate"])
        if "spot" in self.applies and now.get("spot_pct"):
            m = m.set("spots", m.spot(u) * (1 + now["spot_pct"] / 100), u)
        if "vol" in self.applies and now.get("vol") is not None:
            m = m.set("vols", now["vol"], u)
        if "credit_spread" in self.applies and now.get("credit_spread") is not None:
            m = m.set("credit_spreads", now["credit_spread"], u)
        return m


def _tree_bump(sigma, t_left, steps):
    # The log spot bump h for tree delta and gamma (see TREE_BUMP_NODES). None
    # when there's no time or no vol left.
    if t_left <= 0 or sigma <= 0:
        return None
    return TREE_BUMP_NODES * sigma * math.sqrt(t_left / steps)


def _tree_delta_gamma(spot, h, up, mid, down):
    # Delta and gamma from the prices at S*exp(h), S and S*exp(-h): the central
    # differences for the unequal steps a = S(exp(h) - 1) up and b = S(1 - exp(-h))
    # down,
    #   delta = (b^2 (V_up - V) + a^2 (V - V_down)) / (a b (a + b))
    #   gamma = 2 ((V_up - V) / a - (V - V_down) / b) / (a + b)
    # With a = b they are (V_up - V_down) / 2a and (V_up - 2V + V_down) / a^2.
    a = spot * math.expm1(h)
    b = -spot * math.expm1(-h)
    delta = (b * b * (up - mid) + a * a * (mid - down)) / (a * b * (a + b))
    gamma = 2 * ((up - mid) / a - (mid - down) / b) / (a + b)
    return delta, gamma


def _base_price(s):
    if s.key not in _BASE_PRICE:
        _remember(_BASE_PRICE, _BASE_PRICE_SIZE, s.key, _value(s.full, s.market))
    return _BASE_PRICE[s.key]


def _curves(s, market):
    # Everything on the value chart that doesn't depend on the current spot, so
    # a spot move reuses it. Keyed on the spec, the setup market and the
    # non-spot sliders (vol, days passed, rate, credit spread).
    dc = s.curve
    und = s.und
    key = (s.key, market.vols.get(und), market.time, market.rate, market.credit_spreads.get(und))
    if key in _CURVE_CACHE:
        return _CURVE_CACHE[key]

    xs, h = s.xs, s.h

    if s.kind == "rates":
        out = {
            "x": xs,
            "now": _many(dc, [market.set("rate", x) for x in xs]),
            "half": None, "fifteen": None, "expiry": None,
            "delta": None, "gamma": None,
            "bond_floor": None, "padded": None, "now_raw": None,
        }
        return _remember(_CURVE_CACHE, _CURVE_CACHE_SIZE, key, out)

    t_left = dc.time_to_expiry(market)
    pad = s.pad()
    lo = xs[0]
    padded = [lo + i * h for i in range(-pad, GRID_POINTS + pad)]  # inner levels are exactly xs
    inner = slice(pad, pad + GRID_POINTS)

    def along(m):
        # One price per padded spot level, in one batch for the trees
        return _many(dc, [m.set("spots", x, und) for x in padded])

    now_raw = along(market)

    if s.tree:
        # Delta and gamma at each level: reprice that level at S*exp(+/-h), in
        # one batch of CURVE_STEPS trees, against the level's own price on the
        # "now" curve (same market, same steps).
        h_log = _tree_bump(market.vol(und), t_left, CURVE_STEPS)
        if h_log is None:
            delta_curve = gamma_curve = None
        else:
            ups = [market.set("spots", x * math.exp(h_log), und) for x in xs]
            downs = [market.set("spots", x * math.exp(-h_log), und) for x in xs]
            bumped = _many(dc, ups + downs)
            pu, pd = bumped[:GRID_POINTS], bumped[GRID_POINTS:]
            center = now_raw[inner]
            dg = [_tree_delta_gamma(x, h_log, u, c, d) for x, u, c, d in zip(xs, pu, center, pd)]
            delta_curve = [d for d, _ in dg]
            gamma_curve = [g for _, g in dg]
    else:
        pv = now_raw
        delta_curve = [(pv[i + 1] - pv[i - 1]) / (2 * h) for i in range(pad, pad + GRID_POINTS)]
        gamma_curve = [(pv[i + 1] - 2 * pv[i] + pv[i - 1]) / (h * h) for i in range(pad, pad + GRID_POINTS)]

    # Earlier-in-life curves: not for futures (no optionality, the lines sit on
    # top of each other) and not once there's no time left.
    strata = t_left > 0 and s.kind != "future"
    half_raw = fifteen_raw = None
    if strata:
        half_raw = along(market.set("time", dc.expiry - HALF_TIME * t_left))
        fifteen_raw = along(market.set("time", dc.expiry - FIFTEEN_TIME * t_left))

    m_exp = market.set("time", dc.expiry)
    expiry = _many(dc, [m_exp.set("spots", x, und) for x in xs])

    # The convertible's tree curves wobble as conversion points cross the
    # nodes. For display, each point is replaced by the value of a quadratic
    # fitted over it and the 3 grid points on either side. The delta and
    # gamma above use the raw tree prices, not these smoothed ones.
    def display(ys):
        if ys is None:
            return None
        return (_smooth(ys) if s.kind == "convertible" else list(ys))[inner]

    # The convertible's bond floor: the same bond with conversion ratio 0,
    # priced on the instrument's own (default) steps. It doesn't read spot.
    bond_floor = None
    if s.kind == "convertible":
        d = s.full
        bond_floor = Convertible(d.underlying, d.expiry, 0, d.face, d.steps).price(market)

    out = {
        "x": xs,
        "now": display(now_raw), "half": display(half_raw), "fifteen": display(fifteen_raw), "expiry": expiry,
        "delta": delta_curve, "gamma": gamma_curve,
        "bond_floor": bond_floor,
        "padded": padded, "now_raw": now_raw,
    }
    return _remember(_CURVE_CACHE, _CURVE_CACHE_SIZE, key, out)


def _breakdown(s, market, price, bond_floor):
    d = s.full
    if s.kind == "option":
        payoff = d.payoff(market.spot(d.underlying))
        return {"kind": "option", "payoff": payoff, "time_value": price - payoff}
    if s.kind == "future":
        spot = market.spot(d.underlying)
        return {"kind": "future", "spot": spot, "carry": price - spot}
    if s.kind == "rates":
        # Quoted as 100 minus the rate, so 100 - price is the implied rate in percent
        return {"kind": "rates", "implied_rate_pct": 100 - price}
    conversion = d.conversion_ratio * market.spot(d.underlying)
    larger = "conversion" if conversion > bond_floor else "bond"
    return {
        "kind": "convertible",
        "conversion_value": conversion,
        "bond_floor": bond_floor,
        "larger_floor": larger,
        "option": price - max(conversion, bond_floor),
    }


def _tree_point(s, market, cv):
    # Point Greeks (except theta, which comes with the theta chart), both
    # ladders and the two earlier-in-life dots for a tree instrument. One batch
    # of CURVE_STEPS trees, one row per bumped market, using greeks.py's own
    # formulas and the same units as _point_greeks:
    #   delta, gamma from V(S*exp(h)), V(S) and V(S*exp(-h)) by _tree_delta_gamma, with h
    #           from _tree_bump, the same as each point of the delta and gamma curves
    #   vega  = (V(vol + h) - V(vol - h)) / 2h with h = 1% of vol, / 100 for per point
    #   rho   = (V(r + h) - V(r - h)) / 2h with h = 1% of the rate, / 10,000 for per bp
    # The exception is vega for DEFAULT_STEP_VEGA types: the same two rows, in a
    # second batch on the default-step tree.
    # Ladder changes are against the "ref" row, the same CURVE_STEPS tree at this market.
    dc = s.curve
    und = s.und
    spot = market.spot(und)

    sigma = market.vol(und)
    r = market.rate
    vega_h = sigma * VEGA_BUMP_PCT
    rho_h = r * RHO_BUMP_PCT
    vol_rows = [market.bump("vols", sh, und) for sh in VOL_LADDER]
    vol_ok = [m.vol(und) > 0 for m in vol_rows]  # a shift to zero vol or below gets None
    vega_pair = [market.bump("vols", -vega_h, und), market.bump("vols", vega_h, und)]
    vega_on_default_steps = s.type in DEFAULT_STEP_VEGA
    t_left = dc.time_to_expiry(market)
    strata = cv["half"] is not None
    h_log = _tree_bump(sigma, t_left, CURVE_STEPS)

    rows, at = [], {}

    def add(name, markets):
        at[name] = slice(len(rows), len(rows) + len(markets))
        rows.extend(markets)

    add("ref", [market])
    if h_log is not None:
        add("spot", [market.set("spots", spot * math.exp(h_log), und), market.set("spots", spot * math.exp(-h_log), und)])
    if vega_h != 0 and not vega_on_default_steps:
        add("vega", vega_pair)
    add("rho", [market.bump("rate", -rho_h), market.bump("rate", rho_h)])
    add("vol_ladder", [m for m, ok in zip(vol_rows, vol_ok) if ok])
    add("rate_ladder", [market.bump("rate", sh) for sh in RATE_LADDER])
    if strata:
        add("earlier", [market.set("time", dc.expiry - HALF_TIME * t_left),
                        market.set("time", dc.expiry - FIFTEEN_TIME * t_left)])
    p = _many_or_none(dc, rows)

    def diff(a, b):
        return None if a is None or b is None else a - b

    ref = p[at["ref"]][0]
    if ref is None:
        # The tree can't price the current market itself
        raise ValueError("the tree can't price this market: its up-move probability falls outside 0 to 1")
    vega = None
    if vega_h != 0:
        vm, vp = _many_or_none(s.full, vega_pair) if vega_on_default_steps else p[at["vega"]]
        vega = None if vm is None or vp is None else (vp - vm) / (2 * vega_h) / 100
    rho_m, rho_p = p[at["rho"]]
    vol_changes = iter(diff(v, ref) for v in p[at["vol_ladder"]])
    earlier = p[at["earlier"]] if strata else [None, None]
    rho_val = None
    if rho_h != 0 and rho_m is not None and rho_p is not None:
        rho_val = (rho_p - rho_m) / (2 * rho_h) / 10_000
    d_val = g_val = None
    if h_log is not None:
        pu, pd = p[at["spot"]]
        if pu is not None and pd is not None:
            d_val, g_val = _tree_delta_gamma(spot, h_log, pu, ref, pd)
    return {
        "greeks": {
            "delta": d_val,
            "gamma": g_val,
            "vega": vega,
            "rho": rho_val,
        },
        "vega_ladder": [{"shift": sh, "change": next(vol_changes) if ok else None} for sh, ok in zip(VOL_LADDER, vol_ok)],
        "rho_ladder": [{"shift": sh, "change": diff(v, ref)} for sh, v in zip(RATE_LADDER, p[at["rate_ladder"]])],
        "half": earlier[0],
        "fifteen": earlier[1],
    }


def _point_greeks(s, market):
    # The Black-Scholes, future and SOFR instruments: greeks.py at the
    # instrument's own steps. What each function returns, and the conversion to
    # the units the site shows:
    #   delta(): (V(S+h) - V(S-h)) / 2h, per 1 unit of spot. As is.
    #   gamma(): second difference over h^2, change in delta per 1 unit of spot. As is.
    #   theta(): V(t + 1/365) - V(t), already the change over one day. As is.
    #   vega():  per 1.00 of vol as a decimal, which is 100 volatility points. / 100 for per point.
    #   rho():   per 1.00 of rate as a decimal, which is 10,000 basis points. / 10,000 for per bp.
    # None where the input isn't in the market (no spot for SOFR, no vol for a
    # future or SOFR), or where greeks.py refuses to bump (rho at a 0% rate,
    # vega at zero vol).
    d = s.full
    und = s.und
    has_spot = und in market.spots
    has_vol = und in market.vols and market.vols[und] != 0
    return {
        "delta": delta(d, market) if has_spot else None,
        "gamma": gamma(d, market) if has_spot else None,
        "theta": theta(d, market),
        "vega": vega(d, market) / 100 if has_vol else None,
        "rho": rho(d, market) / 10_000 if market.rate != 0 else None,
    }


def _path_times(expiry, t_now, points):
    # points evenly spaced times from day 0 to expiry, with today's time in
    # place of the nearest one so the chart's today dot is a point on its line.
    # Both ends (day 0 and expiry) and the middle point, which the chart labels,
    # stay put; the count doesn't change.
    n = points - 1
    times = [expiry * i / n for i in range(n + 1)]
    if t_now <= 0 or t_now >= expiry or t_now in times:
        return times
    i = min(max(round(t_now / expiry * n), 1), n - 1)
    mid = n // 2
    if i == mid:
        i = mid + 1 if t_now > times[mid] else mid - 1
    times[i] = t_now
    return times


def _theta_path(s, market, price):
    # Value at the current spot (and every other current input) from day 0 to
    # expiry, with only time moving. Today's point is the headline price itself.
    # For the trees every other point is priced on the same default-step tree as
    # the headline, in one batch that also holds the row for the headline theta,
    # V(t + 1/365) - V(t). The trees have TREE_THETA_POINTS points, the others
    # THETA_POINTS. Returns (path, tree theta or None).
    if "time" not in s.applies:
        return None, None
    d = s.full if s.tree else s.curve
    t_now = market.time
    times = _path_times(d.expiry, t_now, TREE_THETA_POINTS if s.tree else THETA_POINTS)
    rows = [market.set("time", t) for t in times if t != t_now]
    if s.tree:
        rows.append(market.bump("time", 1 / DAYS_PER_YEAR))
    priced = iter(_many_or_none(d, rows))
    values = [price if t == t_now else next(priced) for t in times]
    tree_theta = None
    if s.tree:
        next_day = next(priced)
        tree_theta = None if next_day is None else next_day - price
    return {"days": [t * DAYS_PER_YEAR for t in times], "values": values}, tree_theta


def _ladder(s, market, field, shifts):
    # The Black-Scholes, future and SOFR instruments (the trees use _tree_point):
    # change in value for each shift against the price at the current market.
    # A shift that would take volatility to zero or below gets None.
    dc = s.curve
    key = dc.underlying if field == "vols" else None
    ref = _value(dc, market)
    out = []
    for sh in shifts:
        shocked = market.bump(field, sh, key)
        if field == "vols" and shocked.vol(key) <= 0:
            out.append({"shift": sh, "change": None})
        else:
            out.append({"shift": sh, "change": _value(dc, shocked) - ref})
    return out


# ---------------------------------------------------------------- public

def explore(spec, base, now=None):
    """Everything the Explorer shows for one instrument the visitor entered.

    spec   {"type", "underlying", plus "strike", "expiry_years", "face",
            "conversion_ratio" as the type needs; optional "id" is echoed back}
    base   the setup market, as decimals: {"spot", "vol", "div_yield", "rate",
            "credit_spread"} (spot and vol aren't needed by every type)
    now    the slider state: {"spot_pct" (percent move from setup spot, 5 = +5%),
            "vol", "days_passed" (calendar days), "rate", "credit_spread"}, with
            vol, rate and credit_spread as decimals. Missing keys keep the setup value.

    Output, all in the instrument's own unit unless noted:
      price, base_price (at the setup market), change, change_pct (percent of base_price)
      breakdown      depends on "kind" (option, future, rates, convertible)
      x, x_current   61 spot levels (or rates for SOFR) and where the market is now
      curves         now, half, fifteen, expiry on x (None where they don't apply)
      at_current     the same four at x_current
      time_left      years left for now, half and fifteen
      delta_curve, gamma_curve   on x: central differences on curves.now, or for
                                 the trees each level repriced at S*exp(+/-h) (None for SOFR)
      greeks         delta, gamma, theta per day, vega per vol point, rho per bp
      theta_path     {days, values}: value at this spot from day 0 to expiry,
                     with today as one of its points (41 points, 13 for the trees)
      vega_ladder, rho_ladder    [{shift, change}] against price
    """
    s = _Setup(spec, base)
    market = s.now(now)
    d, dc, und = s.full, s.curve, s.und
    t_left = d.time_to_expiry(market)

    price = _value(d, market)
    base_price = _base_price(s)
    change = price - base_price

    cv = _curves(s, market)
    tp = _tree_point(s, market, cv) if s.tree else None

    if s.kind == "rates":
        x_current = market.rate
        at_current = {"now": price, "half": None, "fifteen": None, "expiry": None}
        time_left = {"now": t_left, "half": None, "fifteen": None}
    else:
        x_current = market.spot(und)
        strata = cv["half"] is not None
        if tp:
            half_now, fifteen_now = tp["half"], tp["fifteen"]
        else:
            half_now = _value(dc, market.set("time", d.expiry - HALF_TIME * t_left)) if strata else None
            fifteen_now = _value(dc, market.set("time", d.expiry - FIFTEEN_TIME * t_left)) if strata else None
        at_current = {
            "now": price,
            "half": half_now,
            "fifteen": fifteen_now,
            "expiry": _value(dc, market.set("time", d.expiry)),
        }
        time_left = {
            "now": t_left,
            "half": HALF_TIME * t_left if strata else None,
            "fifteen": FIFTEEN_TIME * t_left if strata else None,
        }

    theta_path, tree_theta = _theta_path(s, market, price)

    if tp:
        g = tp["greeks"]
        greeks = {"delta": g["delta"], "gamma": g["gamma"], "theta": tree_theta, "vega": g["vega"], "rho": g["rho"]}
        vega_ladder, rho_ladder = tp["vega_ladder"], tp["rho_ladder"]
    else:
        greeks = _point_greeks(s, market)
        vega_ladder = _ladder(s, market, "vols", VOL_LADDER) if und in market.vols else None
        rho_ladder = _ladder(s, market, "rate", RATE_LADDER)

    result = {
        "id": spec.get("id", s.type),
        "kind": s.kind,
        "inputs": {
            "spot": market.spots.get(und),
            "vol": market.vols.get(und),
            "days_passed": market.time * DAYS_PER_YEAR,
            "rate": market.rate,
            "credit_spread": market.credit_spreads.get(und),
            "time_left_years": t_left,
        },
        "price": price,
        "base_price": base_price,
        "change": change,
        "change_pct": change / base_price * 100 if base_price else None,
        "breakdown": _breakdown(s, market, price, cv["bond_floor"]),
        "x": cv["x"],
        "x_current": x_current,
        "curves": {k: cv[k] for k in ("now", "half", "fifteen", "expiry")},
        "at_current": at_current,
        "time_left": time_left,
        "delta_curve": cv["delta"],
        "gamma_curve": cv["gamma"],
        "greeks": greeks,
        "theta_path": theta_path,
        "vega_ladder": vega_ladder,
        "rho_ladder": rho_ladder,
    }
    return _plain(result)


# ---------------------------------------------------------------- a book

# Futures cost nothing to enter, so a position in one carries no value, only
# gains and losses. Its price × size is still reported, as notional.
NO_VALUE_CLASSES = (Future, RatesFuture)


def _book_market(market):
    # One Market with every dict keyed by underlying id; credit spread defaults to 0
    unds = market.get("underlyings") or []
    ids = [u["id"] for u in unds]
    if len(set(ids)) != len(ids):
        raise ValueError("underlying ids must be unique")
    return Market(
        time=0.0,
        rate=float(market["rate"]),
        spots={u["id"]: _positive(u, "spot") for u in unds},
        vols={u["id"]: float(u["vol"]) for u in unds},
        div_yields={u["id"]: float(u.get("div_yield") or 0.0) for u in unds},
        credit_spreads={u["id"]: float(u.get("credit_spread") or 0.0) for u in unds},
    )


def book_report(market, positions, scenarios):
    """Value a book and run scenarios on it with shock.py.

    market     {"rate", "underlyings": [{"id", "name", "spot", "vol", "div_yield",
                "credit_spread"}]}, decimals. Every Market dict is keyed by id.
    positions  [{"id", "spec" (as explore's, with "underlying" an underlying id),
                "quantity", "multiplier"}]. Each becomes a book.Position named by
                its id with quantity = quantity × multiplier.
    scenarios  [{"id", "moves": [{"field", "key", "amount", "kind"}]}] in
                shock.py's Move vocabulary (kind "add" or "pct").

    Returns, in each position's own money (price × size):
      positions  [{"id", "price", "size", "value", "notional"}]: value is
                 price × size, but 0 for futures; notional is price × size
      book       {"value": sum of values, "gross": sum of |notional|}
      scenarios  [{"id", "changes": {position id: change}, "total",
                 "pct_of_size": {position id: change / |notional| × 100},
                 "total_pct_of_gross"}] from exposure_map
      interactions  for each scenario with more than one move:
                 {"id", "moves": [labels], "positions": {position id:
                 {"singles", "sum", "joint", "interaction"}}, "book": the same
                 four for the whole book} from interaction()
    """
    # shock.py imports pandas; importing it here means the browser loads pandas
    # only when the Book page first needs Python.
    from shock import Move, Scenario, ShockType, exposure_map, interaction
    from book import Book, Position

    m = _book_market(market)

    built = []
    for p in positions:
        pid = p["id"]
        if not isinstance(pid, str) or not pid or pid == "Total":
            raise ValueError(f"bad position id {pid!r}")  # exposure_map adds a "Total" row
        spec = p["spec"]
        if spec.get("type") != "sofr_future" and spec.get("underlying") not in m.spots:
            raise ValueError(f"position {pid} is written on an underlying the market doesn't have")
        size = float(p["quantity"]) * float(p.get("multiplier") or 1)
        if size == 0:
            raise ValueError(f"position {pid} has zero size")
        built.append((pid, make_derivative(spec), size))
    book = Book([Position(pid, d, size) for pid, d, size in built])

    out_positions = []
    for pid, d, size in built:
        price = d.price(m)
        notional = price * size
        out_positions.append({
            "id": pid,
            "price": price,
            "size": size,
            "value": 0.0 if isinstance(d, NO_VALUE_CLASSES) else notional,
            "notional": notional,
        })
    ref = {p["id"]: abs(p["notional"]) for p in out_positions}
    gross = sum(ref.values())

    def pct(v, base):
        return v / base * 100 if base > 1e-12 else 0.0

    scen = []
    for sc in scenarios:
        moves = [Move(mv["field"], mv["amount"], mv.get("key"), ShockType(mv["kind"])) for mv in sc["moves"]]
        if not moves:
            raise ValueError(f"scenario {sc['id']} has no moves")
        scen.append(Scenario(sc["id"], moves))
    if len({s.name for s in scen}) != len(scen):
        raise ValueError("scenario ids must be unique")

    out_scenarios = []
    interactions = []
    if built and scen:
        df = exposure_map(book, m, scen)
        for s in scen:
            changes = {pid: df.loc[pid, s.name] for pid, _, _ in built}
            total = df.loc["Total", s.name]
            out_scenarios.append({
                "id": s.name,
                "changes": changes,
                "total": total,
                "pct_of_size": {pid: pct(v, ref[pid]) for pid, v in changes.items()},
                "total_pct_of_gross": pct(total, gross),
            })

        for s in scen:
            if len(s.moves) < 2:
                continue
            it = interaction(book, m, s)
            move_cols = list(it.columns[:-3])  # one per move, then Sum of singles, Joint, Interaction
            if len(move_cols) != len(s.moves):
                raise ValueError(f"scenario {s.name} moves the same input twice")

            def row(name):
                return {
                    "singles": [it.loc[name, c] for c in move_cols],
                    "sum": it.loc[name, "Sum of singles"],
                    "joint": it.loc[name, "Joint"],
                    "interaction": it.loc[name, "Interaction"],
                }

            interactions.append({
                "id": s.name,
                "moves": move_cols,
                "positions": {pid: row(pid) for pid, _, _ in built},
                "book": row("Total"),  # exposure_map's Total row: the sum of the positions
            })

    return _plain({
        "positions": out_positions,
        "book": {"value": sum(p["value"] for p in out_positions), "gross": gross},
        "scenarios": out_scenarios,
        "interactions": interactions,
    })


if __name__ == "__main__":
    import time

    examples = [
        ({"type": "european_call", "underlying": "SPX", "strike": 6000, "expiry_years": 0.5},
         {"spot": 6000, "vol": 0.18, "div_yield": 0.013, "rate": 0.04}),
        ({"type": "american_put", "underlying": "SPX", "strike": 5800, "expiry_years": 1},
         {"spot": 6000, "vol": 0.20, "div_yield": 0.013, "rate": 0.04}),
        ({"type": "convertible", "underlying": "XYZ", "expiry_years": 5, "face": 1000, "conversion_ratio": 20},
         {"spot": 42, "vol": 0.35, "div_yield": 0.0, "rate": 0.04, "credit_spread": 0.025}),
        ({"type": "sofr_future"}, {"rate": 0.04}),
    ]
    for spec, base in examples:
        t0 = time.perf_counter()
        r = explore(spec, base)
        t1 = time.perf_counter()
        explore(spec, base, {"spot_pct": 5})
        t2 = time.perf_counter()
        json.dumps(r, allow_nan=False)
        print(f"{spec['type']:14s} price {r['price']:10.4f}  first {1000 * (t1 - t0):7.1f} ms  spot move {1000 * (t2 - t1):7.1f} ms")
