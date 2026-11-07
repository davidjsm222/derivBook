#   This is the binomial tree pricing engine
#   This is used primarily for American options, which can't be priced with just BS

#   David Smith

import numpy as np
from pricing import bs_call, bs_put

def _tree_params(T, r, q, sigma, N):

    # Helper function used below
    dt = T / N 
    u = np.exp(sigma * np.sqrt(dt))
    d = 1/u
    p = (np.exp((r-q)*dt)-d) / (u-d)

    if not (0 < p < 1):
        raise ValueError("P not between 0 and 1, invalid values")

    discount = np.exp(-r * dt)
    return dt, u, d, p, discount

def _terminal_spots(S, u, d, N):

    # God bless NumPy arrays
    tspots = np.arange(N + 1)
    tspots = u**tspots * d**(N-tspots)
    return tspots*S

def binomial_price(S, K, T, r, q, sigma, N, option_type, american=False):

    # Get tree parameters
    _, u, d, p, discount = _tree_params(T, r, q, sigma, N)

    # Check option type (call or put) and get payoffs
    tspots = _terminal_spots(S, u, d, N)
    if option_type == "call":
        values = np.maximum(tspots - K, 0)
    elif option_type == "put":
        values = np.maximum(K-tspots, 0)
    else:
        raise ValueError("Option type is invalid (must be call or put)")

    # Now, walk backwards through the tree and discount
    for i in range(N-1, -1, -1):
        values = discount * (p * values[1:] + (1-p) * values[:-1])
        if american:
            temp_spots = _terminal_spots(S, u, d, i)

            if option_type == "call":
                temp_spots = np.maximum(temp_spots - K, 0)
            elif option_type == "put":
                temp_spots = np.maximum(K-temp_spots, 0)

            values = np.maximum(values, temp_spots)

    return values[0]

def convertible_price(S, T, r, q, sigma, credit_spread, face, conv_ratio, N):

    # Get tree params
    dt, u, d, p, discount = _tree_params(T, r, q, sigma, N)

    # Get debt discount
    debt_discount = np.exp(-(r + credit_spread) * dt)

    # Get terminal spots
    tspots = _terminal_spots(S, u, d, N)
    conv_value = tspots * conv_ratio

    # Get true/false for whether convert or not 
    converts = conv_value > face
    E = np.where(conv_value > face, conv_value, 0)
    B = np.where(converts, 0, face)

    # Now, walk backwards through tree and discount
    for i in range(N-1, -1, -1):
        E = discount * (p * E[1:] + (1-p) * E[:-1])
        B = debt_discount * (p * B[1:] + (1-p) * B[:-1])

        temp_spots = _terminal_spots(S, u, d, i)
        temp_conv_value = conv_ratio * temp_spots
        temp_converts = temp_conv_value > (E+B)
        E = np.where(temp_converts, temp_conv_value, E)
        B = np.where(temp_converts, 0, B)

    return E[0] + B[0]

if __name__ == "__main__":
    S, K, T, r, q, sigma = 100, 100, 1, 0.05, 0, 0.20

    # 1. convergence: European call should approach Black-Scholes as N grows
    print("BS call:", bs_call(S, K, T, r, q, sigma))                 # 10.4506
    for N in [10, 50, 100, 500, 1000]:
        tree = binomial_price(S, K, T, r, q, sigma, N, "call")
        print("N =", N, "tree:", tree, "error:", tree - bs_call(S, K, T, r, q, sigma))
        # error shrinks as N grows, zig-zagging between odd and even N

    # 2. European put should also converge
    print("BS put:  ", bs_put(S, K, T, r, q, sigma))                  # 5.5735
    print("tree put:", binomial_price(S, K, T, r, q, sigma, 500, "put"))  # within a few cents

    # 3. American call with no dividends = European call
    euro_call = binomial_price(S, K, T, r, q, sigma, 500, "call")
    amer_call = binomial_price(S, K, T, r, q, sigma, 500, "call", american=True)
    print("euro call:", euro_call)
    print("amer call:", amer_call)                                    # identical

    # 4. American put is worth more than European put
    euro_put = binomial_price(S, K, T, r, q, sigma, 500, "put")
    amer_put = binomial_price(S, K, T, r, q, sigma, 500, "put", american=True)
    print("euro put:", euro_put)                                      # ~5.57
    print("amer put:", amer_put)                                      # ~6.09
    print("early exercise premium:", amer_put - euro_put)             # ~0.52

    # 5. with dividends, American call can be worth more than European
    euro_call_div = binomial_price(S, K, T, r, 0.03, sigma, 500, "call")
    amer_call_div = binomial_price(S, K, T, r, 0.03, sigma, 500, "call", american=True)
    print("euro call, q=3%:", euro_call_div)
    print("amer call, q=3%:", amer_call_div)                          # >= euro

    # 6. guards
    try:
        binomial_price(100, 100, 1, 0.5, 0, 0.01, 1, "call")
        print("p guard FAILED")
    except ValueError:
        print("p guard works")

    try:
        binomial_price(S, K, T, r, q, sigma, 100, "cal")
        print("option type guard FAILED")
    except ValueError:
        print("option type guard works")

        # convertible: XYZ at 42, 5 years, face 1000, 20 shares, 2.5% credit spread
    S, T, r, q, sigma, cs = 42, 5, 0.04, 0, 0.35, 0.025

    # 7. huge conversion ratio: always converts, worth the shares
    print("cb, 1000 shares:", convertible_price(S, T, r, q, sigma, cs, 1000, 1000, 500))  # ~42000

    # 8. zero conversion ratio: never converts, worth the bond floor
    print("cb, 0 shares:", convertible_price(S, T, r, q, sigma, cs, 1000, 0, 500))
    print("bond floor:  ", 1000 * np.exp(-(r + cs) * T))                                  # 722.53, should match

    # 9. no credit risk: risk-free bond plus 20 calls struck at 50
    print("cb, no credit:", convertible_price(S, T, r, q, sigma, 0, 1000, 20, 500))
    print("bond + calls: ", 1000 * np.exp(-r * T) + 20 * bs_call(S, 50, T, r, q, sigma))   # ~1082.0

    # 10. normal terms: above bond floor and conversion value
    cb = convertible_price(S, T, r, q, sigma, cs, 1000, 20, 500)
    print("cb:", cb, "| bond floor: 722.53 | conversion value: 840")