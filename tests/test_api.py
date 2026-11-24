import json
import math

import numpy as np
import pytest

import api
from batch import price_many
from greeks import theta, vega, rho
from market import Market

# One instrument of every type, with a setup market, as the Explorer sends them
CASES = {
    "european_call": ({"type": "european_call", "underlying": "SPX", "strike": 6000, "expiry_years": 0.5},
                      {"spot": 6000, "vol": 0.18, "div_yield": 0.013, "rate": 0.04}),
    "european_put": ({"type": "european_put", "underlying": "SPX", "strike": 5700, "expiry_years": 0.25},
                     {"spot": 6000, "vol": 0.18, "div_yield": 0.013, "rate": 0.04}),
    "american_call": ({"type": "american_call", "underlying": "ABC", "strike": 95, "expiry_years": 1},
                      {"spot": 100, "vol": 0.3, "div_yield": 0.04, "rate": 0.03}),
    "american_put": ({"type": "american_put", "underlying": "SPX", "strike": 5800, "expiry_years": 1},
                     {"spot": 6000, "vol": 0.20, "div_yield": 0.013, "rate": 0.04}),
    "future": ({"type": "future", "underlying": "SPX", "expiry_years": 0.5},
               {"spot": 6000, "div_yield": 0.013, "rate": 0.04}),
    "sofr_future": ({"type": "sofr_future"}, {"rate": 0.04}),
    "convertible": ({"type": "convertible", "underlying": "XYZ", "expiry_years": 5, "face": 1000, "conversion_ratio": 20},
                    {"spot": 42, "vol": 0.35, "div_yield": 0.0, "rate": 0.04, "credit_spread": 0.025}),
}
TREES = ["american_call", "american_put", "convertible"]

SHOCKED = {"spot_pct": 7, "vol": 0.26, "days_passed": 30, "rate": 0.0475, "credit_spread": 0.04}


def _market(spec, base, now=None):
    # The market explore() should be pricing, built here without api.py
    now = now or {}
    if spec["type"] == "sofr_future":
        return Market(0.0, now.get("rate", base["rate"]), {}, {}, {}, {})
    u = spec["underlying"]
    kind = api.TYPES[spec["type"]]["kind"]
    reads = api.APPLIES[kind]
    vol = now.get("vol", base.get("vol")) if "vol" in reads else base.get("vol")
    cs = now.get("credit_spread", base.get("credit_spread") or 0.0) if "credit_spread" in reads else (base.get("credit_spread") or 0.0)
    return Market(
        time=now.get("days_passed", 0) / 365 if "time" in reads else 0.0,
        rate=now.get("rate", base["rate"]),
        spots={u: base["spot"] * (1 + now.get("spot_pct", 0) / 100)},
        vols={} if vol is None else {u: vol},
        div_yields={u: base.get("div_yield", 0.0)},
        credit_spreads={u: cs},
    )


def _walk(x):
    # Every leaf is plain data, and no NaN or infinity
    if isinstance(x, dict):
        for k, v in x.items():
            assert isinstance(k, str)
            _walk(v)
    elif isinstance(x, list):
        for v in x:
            _walk(v)
    else:
        assert x is None or type(x) in (bool, int, float, str), f"{type(x)} leaked out"
        if type(x) is float:
            assert math.isfinite(x)


EXPECTED_KEYS = {
    "": {"id", "kind", "inputs", "price", "base_price", "change", "change_pct", "breakdown", "x", "x_current",
         "curves", "at_current", "time_left", "delta_curve", "gamma_curve", "greeks", "theta_path",
         "vega_ladder", "rho_ladder"},
    "inputs": {"spot", "vol", "days_passed", "rate", "credit_spread", "time_left_years"},
    "curves": {"now", "half", "fifteen", "expiry"},
    "at_current": {"now", "half", "fifteen", "expiry"},
    "time_left": {"now", "half", "fifteen"},
    "greeks": {"delta", "gamma", "theta", "vega", "rho"},
}


# ---------------------------------------------------------------- every type

@pytest.mark.parametrize("t", list(CASES))
@pytest.mark.parametrize("shocked", [False, True], ids=["setup", "shocked"])
def test_every_type(t, shocked):
    spec, base = CASES[t]
    now = SHOCKED if shocked else None
    r = api.explore(spec, base, now)

    json.dumps(r, allow_nan=False)
    _walk(r)
    for part, keys in EXPECTED_KEYS.items():
        assert set(r[part] if part else r) == keys, part

    # price is exactly what the derivative's own price() says, built here directly
    d = api.make_derivative(spec)
    assert r["price"] == pytest.approx(float(d.price(_market(spec, base, now))), rel=1e-12, abs=1e-12)
    assert r["base_price"] == pytest.approx(float(d.price(_market(spec, base))), rel=1e-12, abs=1e-12)
    if not shocked:
        assert r["change"] == pytest.approx(0, abs=1e-12)

    n = api.GRID_POINTS
    assert len(r["x"]) == n and len(r["curves"]["now"]) == n
    for k in ("half", "fifteen", "expiry"):
        assert r["curves"][k] is None or len(r["curves"][k]) == n
    if t == "sofr_future":
        assert r["delta_curve"] is None and r["greeks"]["delta"] is None and r["theta_path"] is None
    else:
        assert len(r["delta_curve"]) == n and r["greeks"]["delta"] is not None
        assert len(r["theta_path"]["values"]) == _theta_points(t)
    assert len(r["rho_ladder"]) == 4


def test_spec_id_is_echoed():
    spec, base = CASES["european_call"]
    assert api.explore({**spec, "id": 7}, base)["id"] == 7


def test_grids():
    r = api.explore(*CASES["european_call"])
    assert r["x"][0] == pytest.approx(4200) and r["x"][-1] == pytest.approx(7800)
    r = api.explore(*CASES["convertible"])
    assert r["x"][0] == pytest.approx(21) and r["x"][-1] == pytest.approx(63)
    r = api.explore(*CASES["sofr_future"])
    assert r["x"][0] == 0 and r["x"][-1] == pytest.approx(0.08)
    # SOFR: up to twice the setup rate when that's above 8%
    r = api.explore({"type": "sofr_future"}, {"rate": 0.061})
    assert r["x"][-1] == pytest.approx(0.13)


def test_bad_specs_are_refused():
    base = CASES["european_call"][1]
    for spec in (
        {"type": "swaption", "underlying": "SPX"},
        {"type": "european_call", "underlying": "SPX", "expiry_years": 0.5},
        {"type": "european_call", "underlying": "SPX", "strike": -1, "expiry_years": 0.5},
        {"type": "european_call", "underlying": "", "strike": 6000, "expiry_years": 0.5},
        {"type": "convertible", "underlying": "XYZ", "expiry_years": 5, "face": 1000},
    ):
        with pytest.raises(ValueError):
            api.explore(spec, base)
    with pytest.raises(ValueError):
        api.explore(CASES["european_call"][0], {"spot": 6000, "rate": 0.04})  # no volatility


def test_curves_are_cached_by_spec_and_setup():
    spec, base = CASES["european_call"]
    a = api.explore(spec, base)
    b = api.explore({**spec, "strike": 6100}, base)
    c = api.explore(spec, {**base, "spot": 6100})
    assert a["curves"]["now"] != b["curves"]["now"]
    assert a["curves"]["now"] != c["curves"]["now"]


def test_convertible_breakdown_adds_up():
    r = api.explore(*CASES["convertible"])
    b = r["breakdown"]
    assert b["conversion_value"] == pytest.approx(20 * 42)
    assert b["bond_floor"] == pytest.approx(1000 * math.exp(-(0.04 + 0.025) * 5))
    assert max(b["conversion_value"], b["bond_floor"]) + b["option"] == pytest.approx(r["price"])


def test_zero_rate_drops_rho_only():
    for t in ("european_call", "american_put"):
        spec, base = CASES[t]
        r = api.explore(spec, base, {"rate": 0.0})
        assert r["greeks"]["rho"] is None
        assert all(b["change"] is not None for b in r["rho_ladder"])


def test_a_tree_the_engine_refuses_is_reported():
    # trees.py refuses when the up-move probability leaves 0..1. A ladder row
    # that does that gets None; the current market doing it raises.
    spec, base = CASES["convertible"]
    r = api.explore(spec, {**base, "vol": 0.12, "rate": 0.08})
    assert r["vega_ladder"][0]["change"] is None
    assert r["vega_ladder"][2]["change"] is not None
    with pytest.raises(ValueError):
        api.explore(spec, {**base, "vol": 0.02, "rate": 0.08})


# ---------------------------------------------------------------- the trees

def _theta_points(t):
    return api.TREE_THETA_POINTS if t in TREES else api.THETA_POINTS


def _tree_cases(t):
    yield None
    yield SHOCKED
    yield {"vol": 0.05}  # the two lowest vol-ladder rows are skipped
    yield {"rate": 0.0}  # no rho


def _tree_delta_gamma(d, m):
    # The tree delta and gamma one tree at a time: price at S*exp(+/-h), with
    # h = 2 * sigma * sqrt(T / N), and take the slope and curvature at S of the
    # parabola through the three prices (central differences for unequal steps)
    und = d.underlying
    s = m.spot(und)
    h = 2 * m.vol(und) * math.sqrt(d.time_to_expiry(m) / d.steps)
    xs = [s * math.exp(-h), s, s * math.exp(h)]
    ys = [float(d.price(m.set("spots", x, und))) for x in xs]
    c2, c1, _ = np.polyfit(xs, ys, 2)
    return c1 + 2 * c2 * s, 2 * c2


def test_unequal_step_differences_are_exact_for_a_parabola():
    # The formula is exact on V = 3 - 2S + 0.7S^2, at any spot and log bump
    for spot, h in ((42.0, 0.15), (6000.0, 0.045), (100.0, 0.6)):
        v = lambda x: 3 - 2 * x + 0.7 * x * x
        up, mid, down = v(spot * math.exp(h)), v(spot), v(spot * math.exp(-h))
        dl, gm = api._tree_delta_gamma(spot, h, up, mid, down)
        assert dl == pytest.approx(-2 + 1.4 * spot, rel=1e-9)
        assert gm == pytest.approx(1.4, rel=1e-7)


@pytest.mark.parametrize("t", TREES)
def test_tree_greeks_and_ladders_match_one_tree_at_a_time(t):
    # The batched Greeks and ladders equal greeks.py and plain price() calls on
    # the tree of the same steps, in the same units: delta, gamma (repriced at
    # S*exp(+/-h)), vega, rho and the ladders on CURVE_STEPS, theta on the
    # default steps (the theta chart's)
    spec, base = CASES[t]
    d = api.make_derivative(spec, api.CURVE_STEPS)
    full = api.make_derivative(spec)
    d_vega = full if t in api.DEFAULT_STEP_VEGA else d
    for now in _tree_cases(t):
        r = api.explore(spec, base, now)
        m = _market(spec, base, now)
        g = r["greeks"]
        dl, gm = _tree_delta_gamma(d, m)
        assert g["delta"] == pytest.approx(dl, rel=1e-6, abs=1e-9)
        assert g["gamma"] == pytest.approx(gm, rel=1e-6, abs=1e-9)
        assert g["theta"] == pytest.approx(float(theta(full, m)), abs=1e-9)
        assert g["vega"] == pytest.approx(float(vega(d_vega, m)) / 100, abs=1e-9)
        if m.rate == 0:
            assert g["rho"] is None
        else:
            assert g["rho"] == pytest.approx(float(rho(d, m)) / 10_000, abs=1e-12)
        ref = float(d.price(m))
        for b in r["vega_ladder"]:
            shocked = m.bump("vols", b["shift"], d.underlying)
            if shocked.vol(d.underlying) <= 0:
                assert b["change"] is None
            else:
                assert b["change"] == pytest.approx(float(d.price(shocked)) - ref, abs=1e-9)
        for b in r["rho_ladder"]:
            assert b["change"] == pytest.approx(float(d.price(m.bump("rate", b["shift"]))) - ref, abs=1e-9)
        if r["curves"]["half"] is not None:
            t_left = d.time_to_expiry(m)
            half = m.set("time", d.expiry - api.HALF_TIME * t_left)
            assert r["at_current"]["half"] == pytest.approx(float(d.price(half)), abs=1e-9)


@pytest.mark.parametrize("t", TREES)
def test_tree_curves_reprice_each_level(t):
    # Every point on the delta and gamma curves is its own S*exp(+/-h)
    # repricing on the CURVE_STEPS tree, at that level's spot
    spec, base = CASES[t]
    d = api.make_derivative(spec, api.CURVE_STEPS)
    r = api.explore(spec, base)
    m = _market(spec, base)
    for i in (0, 7, 30, 44, 60):
        dl, gm = _tree_delta_gamma(d, m.set("spots", r["x"][i], d.underlying))
        assert r["delta_curve"][i] == pytest.approx(dl, rel=1e-6, abs=1e-9)
        assert r["gamma_curve"][i] == pytest.approx(gm, rel=1e-6, abs=1e-9)


def _sign_changes(ys):
    diffs = [b - a for a, b in zip(ys, ys[1:]) if abs(b - a) > 1e-12]
    return sum(1 for a, b in zip(diffs, diffs[1:]) if (a > 0) != (b > 0))


@pytest.mark.parametrize("t", TREES)
def test_tree_gamma_has_no_zigzag(t):
    # A handful of turns across the chart, not one per point. The convertible's
    # gamma only falls (the tree's wobble cancels out of the log bump), and the
    # American put's few turns are early-exercise ripples near its flat top.
    spec, base = CASES[t]
    for now in (None, SHOCKED):
        turns = _sign_changes(api.explore(spec, base, now)["gamma_curve"])
        assert turns == 0 if t == "convertible" else turns < 10


@pytest.mark.parametrize("t", TREES)
def test_tree_gamma_is_non_negative(t):
    spec, base = CASES[t]
    for now in (None, SHOCKED):
        r = api.explore(spec, base, now)
        assert min(r["gamma_curve"]) >= -1e-12
        assert r["greeks"]["gamma"] >= -1e-12


@pytest.mark.parametrize("t", TREES)
def test_point_delta_gamma_sit_on_the_curves(t):
    # At setup spot the headline and the curve reprice the same markets
    r = api.explore(*CASES[t])
    i = r["x"].index(min(r["x"], key=lambda x: abs(x - r["x_current"])))
    assert r["x"][i] == pytest.approx(r["x_current"])
    assert r["greeks"]["delta"] == pytest.approx(r["delta_curve"][i], abs=1e-9)
    assert r["greeks"]["gamma"] == pytest.approx(r["gamma_curve"][i], abs=1e-9)


@pytest.mark.parametrize("t", TREES)
def test_spot_move_runs_no_curve_trees(t, monkeypatch):
    spec, base = CASES[t]
    api.explore(spec, base)  # caches the setup curves
    sizes = []
    real = api.price_many
    monkeypatch.setattr(api, "price_many", lambda d, ms: sizes.append(len(ms)) or real(d, ms))
    api.explore(spec, base, {"spot_pct": 4})
    # One CURVE_STEPS batch for the point Greeks and ladders; one default-step
    # batch for the theta chart (TREE_THETA_POINTS - 1 points, today being the
    # headline price, plus the next-day row for theta); and for the convertible
    # a two-row default-step batch for vega. No batch reprices the curves.
    theta_rows = api.TREE_THETA_POINTS
    if t in api.DEFAULT_STEP_VEGA:
        assert sorted(sizes) == sorted([2, 15, theta_rows])
    else:
        assert sorted(sizes) == sorted([17, theta_rows])


@pytest.mark.parametrize("t", list(CASES))
@pytest.mark.parametrize("days", [0, 10, 91, 92, 179])
def test_theta_chart_today_point_is_the_headline(t, days):
    spec, base = CASES[t]
    if t != "sofr_future" and days > spec["expiry_years"] * 365 - 1:
        return  # past where the days slider stops
    r = api.explore(spec, base, {"days_passed": days})
    tp = r["theta_path"]
    if tp is None:
        assert t == "sofr_future"
        return
    expiry_days = spec["expiry_years"] * 365
    n = _theta_points(t)
    assert len(tp["days"]) == n
    assert tp["days"] == sorted(tp["days"])
    assert tp["days"][0] == 0 and tp["days"][-1] == pytest.approx(expiry_days)
    assert tp["days"][n // 2] == pytest.approx(expiry_days / 2)  # the labeled middle stays
    today = [v for x, v in zip(tp["days"], tp["values"]) if x == r["inputs"]["days_passed"]]
    assert today == [r["price"]]  # exactly the headline, so the dot sits on the line


def test_convertible_display_smoothing_stays_close():
    spec, base = CASES["convertible"]
    r = api.explore(spec, base)
    d = api.make_derivative(spec, api.CURVE_STEPS)
    m = _market(spec, base)
    raw = price_many(d, [m.set("spots", x, "XYZ") for x in r["x"]])
    for shown, tree in zip(r["curves"]["now"], raw):
        assert abs(shown - tree) <= 0.005 * tree


def test_convertible_vega_agrees_with_its_ladder():
    # On 80 steps the 35%-vol vega read 12.14 per point; its +/-5 point ladder
    # says about 7. The default-step vega must sit near the ladder's slope.
    r = api.explore(*CASES["convertible"])
    lad = {b["shift"]: b["change"] for b in r["vega_ladder"]}
    assert r["greeks"]["vega"] == pytest.approx((lad[0.05] - lad[-0.05]) / 10, rel=0.15)


def test_committed_exposure_json_is_current():
    # web/src/data/exposure.json is generated; rerun scripts/export.py if this fails
    import export

    assert export.OUT.read_text() == export.dump(export.build())
