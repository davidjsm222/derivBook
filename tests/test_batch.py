import numpy as np
import pytest

import trees
from batch import binomial_price_batch, convertible_price_batch, price_many, fitted_delta_gamma
from base import base_market, base_derivatives, POSITION_IDS
from derivatives import (
    AmericanPutOption,
    AmericanCallOption,
    EuropeanCallOption,
    EuropeanPutOption,
    Convertible,
)
from greeks import gamma as bump_gamma
from market import Market
from pricing import bs_call, bs_delta, bs_gamma

ATOL = 1e-10
ROWS = 200
STEPS = 80


def _expired_market(spot, rate, q, vol, cs=0.0):
    # A market sitting exactly at a 1-year instrument's expiry
    return Market(time=1.0, rate=rate, spots={"X": spot}, vols={"X": vol},
                  div_yields={"X": q}, credit_spreads={"X": cs})


# ---------------------------------------------------------------- batch trees

def _option_rows(seed):
    rng = np.random.default_rng(seed)
    K = rng.uniform(20, 200, ROWS)
    S = K * np.exp(rng.uniform(-1.2, 1.2, ROWS))      # deep out of the money to deep in
    S[:10] = K[:10] * 0.3                               # forced deep cases
    S[10:20] = K[10:20] * 3.0
    T = rng.uniform(0.01, 3.0, ROWS)
    T[rng.choice(ROWS, 20, replace=False)] = 0.0        # expired rows
    r = rng.uniform(0.0, 0.08, ROWS)
    q = rng.uniform(0.0, 0.04, ROWS)
    sigma = rng.uniform(0.08, 0.6, ROWS)
    return S, K, T, r, q, sigma


@pytest.mark.filterwarnings("ignore::RuntimeWarning")  # trees.py at T = 0, checked on purpose
@pytest.mark.parametrize("option_type", ["call", "put"])
@pytest.mark.parametrize("american", [False, True], ids=["european", "american"])
def test_binomial_price_batch_matches_trees(option_type, american):
    S, K, T, r, q, sigma = _option_rows(seed=1 if option_type == "call" else 2)
    got = binomial_price_batch(S, K, T, r, q, sigma, STEPS, option_type, american)
    assert got.shape == (ROWS,)

    for k in range(ROWS):
        if T[k] > 0:
            want = trees.binomial_price(S[k], K[k], T[k], r[k], q[k], sigma[k], STEPS, option_type, american)
        else:
            # trees.binomial_price can't run at T = 0 (p is 0/0 and its guard raises),
            # so the reference is the engine's own expiry rule in derivatives.py
            with pytest.raises(ValueError):
                trees.binomial_price(S[k], K[k], 0.0, r[k], q[k], sigma[k], STEPS, option_type, american)
            m = _expired_market(S[k], r[k], q[k], sigma[k])
            if american:
                cls = AmericanCallOption if option_type == "call" else AmericanPutOption
                want = cls("X", K[k], 1.0, steps=STEPS).price(m)
            else:
                cls = EuropeanCallOption if option_type == "call" else EuropeanPutOption
                want = cls("X", K[k], 1.0).tree_price(m, STEPS)
        assert abs(got[k] - want) <= ATOL, f"row {k}: S={S[k]} K={K[k]} T={T[k]} batch={got[k]} trees={want}"


def test_binomial_price_batch_broadcasts_scalars():
    S = np.linspace(4000, 8000, 7)
    got = binomial_price_batch(S, 6000, 0.5, 0.04, 0.013, 0.18, STEPS, "put", True)
    want = [trees.binomial_price(s, 6000, 0.5, 0.04, 0.013, 0.18, STEPS, "put", True) for s in S]
    np.testing.assert_allclose(got, want, rtol=0, atol=ATOL)


@pytest.mark.filterwarnings("ignore::RuntimeWarning")  # trees.py at T = 0, checked on purpose
@pytest.mark.parametrize("conv_ratio", [20, 0, 1000])
def test_convertible_price_batch_matches_trees(conv_ratio):
    rng = np.random.default_rng(3 + conv_ratio)
    face = 1000
    S = 50 * np.exp(rng.uniform(-1.2, 1.2, ROWS))       # conversion deep out to deep in
    T = rng.uniform(0.05, 6.0, ROWS)
    T[rng.choice(ROWS, 20, replace=False)] = 0.0
    r = rng.uniform(0.0, 0.08, ROWS)
    q = rng.uniform(0.0, 0.03, ROWS)
    sigma = rng.uniform(0.1, 0.6, ROWS)
    cs = rng.uniform(0.0, 0.08, ROWS)
    got = convertible_price_batch(S, T, r, q, sigma, cs, face, conv_ratio, STEPS)

    for k in range(ROWS):
        if T[k] > 0:
            want = trees.convertible_price(S[k], T[k], r[k], q[k], sigma[k], cs[k], face, conv_ratio, STEPS)
        else:
            with pytest.raises(ValueError):
                trees.convertible_price(S[k], 0.0, r[k], q[k], sigma[k], cs[k], face, conv_ratio, STEPS)
            m = _expired_market(S[k], r[k], q[k], sigma[k], cs[k])
            want = Convertible("X", 1.0, conv_ratio, face, steps=STEPS).price(m)
        assert abs(got[k] - want) <= ATOL, f"row {k}: S={S[k]} T={T[k]} batch={got[k]} trees={want}"


# ---------------------------------------------------------------- price_many

def _markets(pid, d, seed):
    rng = np.random.default_rng(seed)
    base = base_market()
    und = d.underlying
    out = []
    for _ in range(25):
        m = base.set("rate", rng.uniform(0.0, 0.08)).set("time", rng.uniform(0.0, 0.9) * d.expiry)
        if und in base.spots:
            m = m.set("spots", base.spot(und) * np.exp(rng.uniform(-0.6, 0.6)), und)
        if und in base.vols:
            m = m.set("vols", rng.uniform(0.08, 0.7), und)
        if und in base.credit_spreads:
            m = m.set("credit_spreads", rng.uniform(0.0, 0.08), und)
        out.append(m)
    # expired: exactly at expiry and past it, in and out of the money
    for t in (d.expiry, d.expiry + 0.1):
        for f in (0.7, 1.0, 1.3):
            m = base.set("time", t)
            if und in base.spots:
                m = m.set("spots", base.spot(und) * f, und)
            out.append(m)
    return out


@pytest.mark.parametrize("pid", POSITION_IDS)
@pytest.mark.parametrize("steps", [None, STEPS], ids=["default-steps", "80-steps"])
@pytest.mark.filterwarnings("ignore::RuntimeWarning")  # Black-Scholes at T <= 0 divides by zero
def test_price_many_matches_price(pid, steps):
    d = base_derivatives(steps=steps)[pid]
    markets = _markets(pid, d, seed=POSITION_IDS.index(pid))
    got = price_many(d, markets)
    want = np.array([d.price(m) for m in markets], dtype=float)
    # European options return NaN at expiry from their own price(); NaN must match NaN
    np.testing.assert_allclose(got, want, rtol=0, atol=ATOL, equal_nan=True)


# ---------------------------------------------------------------- fitted Greeks

def test_fit_is_exact_on_a_quadratic():
    xs = np.linspace(80, 120, 41)
    ys = 3.0 + 0.5 * (xs - 100) + 0.02 * (xs - 100) ** 2
    d, g = fitted_delta_gamma(xs, ys, 103.0, 5.0)
    assert d == pytest.approx(0.5 + 0.04 * 3.0, abs=1e-9)
    assert g == pytest.approx(0.04, abs=1e-9)


def test_fit_needs_three_points():
    with pytest.raises(ValueError):
        fitted_delta_gamma([1.0, 2.0, 3.0], [1.0, 2.0, 3.0], 1.0, 0.5)


def test_fit_matches_black_scholes_call():
    K, T, r, q, s = 6000, 0.5, 0.04, 0.013, 0.18
    xs = 6000 * (1 + 0.0025 * np.arange(-80, 81))          # 0.25% grid
    ps = np.array([bs_call(x, K, T, r, q, s) for x in xs])
    for at in np.linspace(5400, 6600, 13):
        d, g = fitted_delta_gamma(xs, ps, at, 0.01 * 6000)  # +/-1% window
        assert d == pytest.approx(bs_delta(at, K, T, r, q, s, "call"), abs=5e-4)
        assert g == pytest.approx(bs_gamma(at, K, T, r, q, s), rel=0.02)


# The site's settings: 61 levels across the chart range, fit window around each
TREE_CASES = {
    # id: (chart range either side of base spot, fit window), both as a share of base spot
    "spx_amer_put": (0.30, 0.04),
    "xyz_convertible": (0.50, 0.25),
}


def _gamma_curves(pid):
    m = base_market()
    d = base_derivatives(steps=STEPS)[pid]
    und = d.underlying
    s0 = m.spot(und)
    rng, win = TREE_CASES[pid]
    h = 2 * rng * s0 / 60
    w = win * s0
    pad = int(np.ceil(w / h - 1e-9))
    xs = s0 * (1 - rng) + h * np.arange(-pad, 61 + pad)
    ps = price_many(d, [m.set("spots", x, und) for x in xs])
    grid = xs[pad:pad + 61]
    fitted = np.array([fitted_delta_gamma(xs, ps, x, w)[1] for x in grid])
    bumped = np.array([bump_gamma(d, m.set("spots", x, und)) for x in grid])
    return fitted, bumped


def _wobble(g):
    return np.abs(np.diff(g, 2)).sum()


@pytest.mark.parametrize("pid", list(TREE_CASES))
def test_fitted_gamma_curve_is_non_negative_and_smooth(pid):
    fitted, bumped = _gamma_curves(pid)
    # Non-negative; the American put's deep in-the-money region is exactly linear
    # (K - S), where the fit returns zero to floating-point precision
    assert fitted.min() >= -1e-12, fitted.min()
    assert _wobble(fitted) < _wobble(bumped) / 20, (_wobble(fitted), _wobble(bumped))
