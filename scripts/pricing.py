#   This is the pricing engine
#   This script includes helper functions for various pricing methods
#   Currently includes:
#       Black-Scholes (and greeks)
#       Futures Cost of Carry

#   David Smith

import numpy as np
from scipy.stats import norm

# Helper Functions

def _d1_d2(S, K, T, r, q, sigma):
    d1 = (np.log(S/K) + (r - q + (sigma ** 2)/2)*T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    return d1, d2

# Future Pricing Functions

def future_price(S, T, r, q):
    price = S * np.exp((r-q) * T)
    return price

def rates_future_price(r, tau=0.25):
    price = 100 - 100 * (np.exp(r * tau) - 1) / tau
    return price

# Black-Scholes Functions

def bs_call(S, K, T, r, q, sigma):
    d1, d2 = _d1_d2(S, K, T, r, q, sigma)
    price = S * np.exp(-q * T) * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    return price

def bs_put(S, K, T, r, q, sigma):
    d1, d2 = _d1_d2(S, K, T, r, q, sigma)
    price = K * np.exp(-r * T) * norm.cdf(-d2) - S * np.exp(-q * T) * norm.cdf(-d1)
    return price

def bs_delta(S, K, T, r, q, sigma, option_type):
    d1, _ = _d1_d2(S, K, T, r, q, sigma)
    delta: int
    if option_type == "call":
        delta = np.exp(-q*T) * norm.cdf(d1)
    else:
        delta = np.exp(-q*T) * (norm.cdf(d1) - 1)
    return delta

def bs_gamma(S, K, T, r, q, sigma):
    d1, _ = _d1_d2(S, K, T, r, q, sigma)
    gamma = np.exp(-q*T) * norm.pdf(d1) / (S * sigma * np.sqrt(T))
    return gamma

def bs_vega(S, K, T, r, q, sigma):
    d1, _ = _d1_d2(S, K, T, r, q, sigma)
    vega = S * np.exp(-q*T) * norm.pdf(d1) * np.sqrt(T)
    return vega

if __name__ == "__main__":

    # Simple set of tests

    S, K, T, r, q, sigma = 100, 100, 1, 0.05, 0, 0.20
    c = bs_call(S, K, T, r, q, sigma)
    p = bs_put(S, K, T, r, q, sigma)
    print("call", c)                                                  # ~10.4506
    print("put", p)                                                   # ~5.5735
    print("parity gap", c - p - (S*np.exp(-q*T) - K*np.exp(-r*T)))    # ~0.0
    print("future", future_price(S, T, r, q))                         # ~105.127
    print("delta", bs_delta(S, K, T, r, q, sigma, "call"))            # ~0.6368
    print("gamma", bs_gamma(S, K, T, r, q, sigma))                    # ~0.01876
    print("vega", bs_vega(S, K, T, r, q, sigma))                      # ~37.52