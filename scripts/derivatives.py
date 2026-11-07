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
from trees import binomial_price, convertible_price
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

class EuropeanCallOption(Option):

    def payoff(self, spot_at_expiry):
        return max(spot_at_expiry - self.strike, 0)
    
    def price(self, market):
        return bs_call(*self._get_inputs(market))

    def tree_price(self, market, steps):
        if self.time_to_expiry(market) <= 0:
            return max(market.spot(self.underlying) - self.strike, 0)
        return binomial_price(*self._get_inputs(market), steps, "call", False)

class EuropeanPutOption(Option):

    def payoff(self, spot_at_expiry):
        return max(self.strike - spot_at_expiry, 0)
    
    def price(self, market):
        return bs_put(*self._get_inputs(market))

    def tree_price(self, market, steps):
        if self.time_to_expiry(market) <= 0:
            return max(self.strike - market.spot(self.underlying), 0)
        return binomial_price(*self._get_inputs(market), steps, "put", False)

class AmericanCallOption(Option):
    steps: int

    def __init__(self, underlying, strike, expiry, steps=500):
        super().__init__(underlying, strike, expiry)
        self.steps = steps

    def payoff(self, spot_at_expiry):
        return max(spot_at_expiry - self.strike, 0)

    def price(self, market):
        if self.time_to_expiry(market) <= 0:
            return max(market.spot(self.underlying) - self.strike, 0)
        return binomial_price(*self._get_inputs(market), self.steps, "call", True)

class AmericanPutOption(Option):
    steps: int

    def __init__(self, underlying, strike, expiry, steps=500):
        super().__init__(underlying, strike, expiry)
        self.steps = steps

    def payoff(self, spot_at_expiry):
        return max(self.strike - spot_at_expiry, 0)

    def price(self, market):
        if self.time_to_expiry(market) <= 0:
            return max(self.strike - market.spot(self.underlying), 0)
        return binomial_price(*self._get_inputs(market), self.steps, "put", True)

# Basic future
class Future(Derivative):

    def price(self, market):
        return future_price(market.spot(self.underlying), self.time_to_expiry(market), market.rate, market.div_yield(self.underlying))

class Convertible(Derivative):
    conversion_ratio: float
    face: float
    steps: int

    def __init__(self, underlying, expiry, conversion_ratio, face, steps=500):
        super().__init__(underlying, expiry)
        self.conversion_ratio, self.face, self.steps = conversion_ratio, face, steps

    def price(self, market: Market):
        
        S = market.spot(self.underlying)
        T = self.time_to_expiry(market)
        if T <= 0:
            return max(self.face, self.conversion_ratio * S)
        r = market.rate
        q = market.div_yield(self.underlying)
        sigma = market.vol(self.underlying)
        credit_spread = market.credit_spread(self.underlying)
        return convertible_price(S, T, r, q, sigma, credit_spread, self.face, self.conversion_ratio, self.steps)

if __name__ == "__main__":

    # Need import line here to avoid circular imports
    from greeks import delta, gamma, vega, rho

    # local test block

    base = Market(
        time=0.0,
        rate=0.04,
        spots={"SPX": 6000.0, "XYZ": 42.0},
        vols={"SPX": 0.18, "XYZ": 0.35},
        div_yields={"SPX": 0.013, "XYZ": 0.0},
        credit_spreads={"XYZ": 0.025},
    )

    call = EuropeanCallOption("SPX", 6000, 0.5)
    put = EuropeanPutOption("SPX", 6000, 0.5)
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

    # 5. American put worth more than European put (compare on the same tree)
    amer_put = AmericanPutOption("SPX", 6000, 0.5)
    print("euro put, BS:  ", put.price(base))              # 262.18
    print("euro put, tree:", put.tree_price(base, 500))    # within ~0.25 of BS
    print("amer put, tree:", amer_put.price(base))         # above the euro tree price

    # 6. American call about equal to European call, since SPX dividend < rate
    amer_call = AmericanCallOption("SPX", 6000, 0.5)
    print("euro call, tree:", call.tree_price(base, 500))
    print("amer call, tree:", amer_call.price(base))       # same or a hair above

    # 7. at expiry: price equals payoff, no crash
    expired = base.bump("time", 0.5).bump("spots", -100, key="SPX")
    print("amer put at expiry: ", amer_put.price(expired))   # 100 (strike 6000, spot 5900)
    print("amer call at expiry:", amer_call.price(expired))  # 0

    # 8. Greeks on an instrument with no Greek formulas
    print("amer put delta:", delta(amer_put, base))        # between -1 and 0
    print("amer put gamma:", gamma(amer_put, base))        # may look jumpy

        # 9. convertible through the class
    cb = Convertible("XYZ", 5, 20, 1000)
    print("cb price:", cb.price(base))                     # same as check 10 in trees.py

    # 10. Greeks: all four drivers
    print("cb delta:", delta(cb, base))                    # between 0 and 20
    print("cb vega: ", vega(cb, base))                     # positive
    print("cb rho:  ", rho(cb, base))                      # negative

    # 11. credit: the sensitivity nothing else in the book has
    wider = base.bump("credit_spreads", 0.01, key="XYZ")
    print("cb, spread +1%:", cb.price(base), "->", cb.price(wider))   # falls

    # 12. at maturity: larger of face and conversion value
    matured = base.bump("time", 5)
    print("cb at maturity:", cb.price(matured))            # 1000 (face beats 20 x 42 = 840)