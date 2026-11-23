"""Batch pricing for the web app: many trees in one backward pass, plus fitted Greeks.

Sits beside the engine and only reads from it. Nothing in trees.py, derivatives.py
or greeks.py changes. Each batch function gives the same result as the engine's
own function, row by row; it just does every row at once.
"""
import numpy as np
from derivatives import AmericanPutOption, AmericanCallOption, Convertible


# ---------------------------------------------------------------------------
# Batch trees
# ---------------------------------------------------------------------------

def _rows(*args):
    """Turn each input into a 1-D float array, all the same length.
    A plain number is repeated to match the longest array."""
    return np.broadcast_arrays(*[np.atleast_1d(np.asarray(a, dtype=float)) for a in args])


def _tree_params_batch(T, r, q, sigma, N):
    """Same as trees._tree_params, with one value per row. Every output is a
    column (shape R x 1), so it multiplies across each row of an (R, nodes) array."""
    dt = T / N
    u = np.exp(sigma * np.sqrt(dt))
    d = 1 / u
    p = (np.exp((r - q) * dt) - d) / (u - d)
    if not np.all((p > 0) & (p < 1)):
        raise ValueError("P not between 0 and 1, invalid values")
    discount = np.exp(-r * dt)
    return dt[:, None], u[:, None], d[:, None], p[:, None], discount[:, None]


def _node_spots_batch(S, u, d, i):
    """Spots at step i for every row: row k holds S_k * u_k^j * d_k^(i-j), j = 0..i."""
    j = np.arange(i + 1)
    return S * u**j * d**(i - j)


def binomial_price_batch(S, K, T, r, q, sigma, N, option_type, american=False):
    """trees.binomial_price for many rows at once. S, K, T, r, q, sigma can each be
    a number or a 1-D array; row k is priced with the k-th value of each.
    Rows with T <= 0 return the payoff. Returns a 1-D array of prices."""
    S, K, T, r, q, sigma = _rows(S, K, T, r, q, sigma)
    if option_type == "call":
        payoff = lambda spot, strike: np.maximum(spot - strike, 0)
    elif option_type == "put":
        payoff = lambda spot, strike: np.maximum(strike - spot, 0)
    else:
        raise ValueError("bad type")

    out = payoff(S, K)                      # expired rows keep this
    live = T > 0
    if not live.any():
        return out

    # Work only on the live rows, each one a row of the tree arrays
    Sl, Kl = S[live][:, None], K[live][:, None]
    dt, u, d, p, discount = _tree_params_batch(T[live], r[live], q[live], sigma[live], N)

    values = payoff(_node_spots_batch(Sl, u, d, N), Kl)       # (R, N+1) terminal payoffs
    for i in range(N - 1, -1, -1):
        # Same step as binomial_price, done to every row at once:
        # each node's value is the discounted, probability-weighted average of its two children.
        values = discount * (p * values[:, 1:] + (1 - p) * values[:, :-1])
        if american:
            # Exercise wherever exercising now beats holding
            values = np.maximum(values, payoff(_node_spots_batch(Sl, u, d, i), Kl))
    out[live] = values[:, 0]
    return out


def convertible_price_batch(S, T, r, q, sigma, credit_spread, face, conv_ratio, N):
    """trees.convertible_price for many rows at once. S, T, r, q, sigma, credit_spread
    can each be a number or a 1-D array. Rows with T <= 0 return max(face, ratio * S).
    Returns a 1-D array of prices."""
    S, T, r, q, sigma, cs = _rows(S, T, r, q, sigma, credit_spread)
    out = np.maximum(face, conv_ratio * S)  # expired rows keep this
    live = T > 0
    if not live.any():
        return out

    Sl = S[live][:, None]
    dt, u, d, p, discount = _tree_params_batch(T[live], r[live], q[live], sigma[live], N)
    debt_discount = np.exp(-(r[live][:, None] + cs[live][:, None]) * dt)

    conv_value = _node_spots_batch(Sl, u, d, N) * conv_ratio
    converts = conv_value > face
    E = np.where(converts, conv_value, 0)    # equity bucket, discounted at r
    B = np.where(converts, 0, face)          # debt bucket, discounted at r + credit spread
    for i in range(N - 1, -1, -1):
        E = discount * (p * E[:, 1:] + (1 - p) * E[:, :-1])
        B = debt_discount * (p * B[:, 1:] + (1 - p) * B[:, :-1])
        cv = conv_ratio * _node_spots_batch(Sl, u, d, i)
        c = cv > (E + B)                     # converting now beats holding
        E = np.where(c, cv, E)
        B = np.where(c, 0, B)
    out[live] = (E + B)[:, 0]
    return out


# ---------------------------------------------------------------------------
# One derivative, many markets
# ---------------------------------------------------------------------------

def price_many(derivative, markets):
    """Price one derivative in many markets. Returns an array, one price per market.
    Tree instruments go through the batch functions in one pass;
    everything else is priced one market at a time with its own price()."""
    if isinstance(derivative, (AmericanPutOption, AmericanCallOption)):
        option_type = "put" if isinstance(derivative, AmericanPutOption) else "call"
        rows = np.array([derivative._get_inputs(m) for m in markets], dtype=float)
        S, K, T, r, q, sigma = rows.T
        return binomial_price_batch(S, K, T, r, q, sigma, derivative.steps, option_type, american=True)

    if isinstance(derivative, Convertible):
        u = derivative.underlying
        rows = np.array([(m.spot(u), derivative.time_to_expiry(m), m.rate, m.div_yield(u),
                          m.vol(u), m.credit_spread(u)) for m in markets], dtype=float)
        S, T, r, q, sigma, cs = rows.T
        return convertible_price_batch(S, T, r, q, sigma, cs, derivative.face,
                                       derivative.conversion_ratio, derivative.steps)

    return np.array([derivative.price(m) for m in markets], dtype=float)


# ---------------------------------------------------------------------------
# Fitted Greeks
# ---------------------------------------------------------------------------

def fitted_delta_gamma(spots, prices, at, window):
    """Delta and gamma at spot `at`, read off a smooth curve fitted through nearby prices.

    Tree prices wobble slightly as spot moves, because the tree's nodes shift
    relative to the strike (or the conversion point). Bump-and-reprice gamma
    divides that wobble by a tiny bump squared, so it turns into noise.
    Fitting one quadratic through every price within `window` of `at` averages
    the wobble out, and delta and gamma come from the fitted curve instead.

    spots, prices: matching 1-D sequences (a price curve)
    at:            the spot to measure at
    window:        how far either side of `at` to include, in spot units
    Returns (delta, gamma).
    """
    spots = np.asarray(spots, dtype=float)
    prices = np.asarray(prices, dtype=float)
    near = np.abs(spots - at) <= window
    if near.sum() < 3:
        raise ValueError("Need at least 3 prices inside the window")
    x = spots[near] - at                        # distance from `at`, so the fit reads directly as Greeks
    a, b, c = np.polyfit(x, prices[near], 2)    # price ≈ a*x^2 + b*x + c
    return b, 2 * a                             # slope at `at` is delta, curvature is gamma