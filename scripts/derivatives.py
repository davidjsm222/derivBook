# This is the derivatives engine
# This script outlines definitions for various derivatives
# Currently Includes:
#   Derivative (Abstract)
#   Option (Put, Call)
#   Future

# David Smith

from abc import ABC, abstractmethod
import numpy as np

from market import Market
from pricing import bs_call, bs_put, future_price

#Base class, every derivative stems from this
class Derivative(ABC):
    underlying: str
    expiry: float

    def __init__(self, underlying, expiry):
        self.underlying = underlying
        self.expiry = expiry

    def time_to_expiry(self, market):
        return self.expiry - market.time

    @abstractmethod
    def price(self, market):
        pass

# Intermediate Option Class, put and call stem from this
class Option(Derivative):
    strike: float

    def __init__(self, underlying, strike, expiry):
        super().__init__(underlying, expiry)
        self.strike = strike

    def _get_inputs(self, market):
        S = market.spot(self.underlying)
        K = self.strike
        T = self.time_to_expiry(market)
        r = market.rate
        q = market.div_yield(self.underlying)
        sigma = market.vol(self.underlying)
        return S, K, T, r, q, sigma

class CallOption(Option):

    def payoff(self, spot_at_expiry):
        return max(spot_at_expiry - self.strike, 0)
    
    def price(self, market):
        return bs_call(*self._get_inputs(market))

class PutOption(Option):

    def payoff(self, spot_at_expiry):
        return max(self.strike - spot_at_expiry, 0)
    
    def price(self, market):
        return bs_put(*self._get_inputs(market))

# Basic future
class Future(Derivative):

    def price(self, market):
        return future_price(market.spot(self.underlying), self.time_to_expiry(market), market.rate, market.div_yield(self.underlying))

if __name__ == "__main__":

    # local test block

    base = Market(
        time=0.0,
        rate=0.04,
        spots={"SPX": 6000.0, "XYZ": 42.0},
        vols={"SPX": 0.18, "XYZ": 0.35},
        div_yields={"SPX": 0.013, "XYZ": 0.0},
        credit_spreads={"XYZ": 0.025},
    )

    call = CallOption("SPX", 6000, 0.5)
    put = PutOption("SPX", 6000, 0.5)
    fut = Future("SPX", 0.5)

    # 1. class price should match calling bs_call directly
    print("call via class:", call.price(base))                          # 342.1096
    print("call direct:   ", bs_call(6000, 6000, 0.5, 0.04, 0.013, 0.18))  # 342.1096

    # 2. put-call parity, gap should be ~0
    S = 6000
    K = 6000
    T = 0.5
    r = 0.04
    q = 0.013
    gap = call.price(base) - put.price(base) - (S * np.exp(-q * T) - K * np.exp(-r * T))
    print("parity gap:", gap)                                           # 0.0

    # 3. abstract classes should refuse to be created
    try:
        Derivative("SPX", 0.5)
        print("Derivative FAILED, was created")
    except TypeError:
        print("Derivative correctly refused")                           # expected

    try:
        Option("SPX", 6000, 0.5)
        print("Option FAILED, was created")
    except TypeError:
        print("Option correctly refused")                               # expected

    # 4. vol shock (+0.05 SPX vol): options rise, future doesn't move
    shocked = base.bump("vols", 0.05, key="SPX")

    print("call:  ", call.price(base), "->", call.price(shocked))     # 342.1096 -> 425.0381 (+82.93)
    print("put:   ", put.price(base), "->", put.price(shocked))       # 262.1752 -> 345.1037 (+82.93)
    print("future:", fut.price(base), "->", fut.price(shocked))       # 6081.5492 -> 6081.5492 (no change)