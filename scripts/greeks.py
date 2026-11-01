#   This is the greeks engine
#   This script includes functions that calculate greeks for a derivative

#   David Smith

from market import Market
from derivatives import Derivative, Future
from pricing import bs_delta, bs_gamma, bs_vega

def delta(derivative: Derivative, market: Market, pct=0.001):
    if pct <= 0:
        raise ValueError(f"pct must be positive, got {pct}")

    # Get underlying values, spot
    underlying = derivative.underlying
    S = market.spot(underlying)

    # Build new markets, bump spot
    bump_size = S*pct
    market_plus = market.bump("spots", bump_size, underlying)
    market_minus = market.bump("spots", -bump_size, underlying)

    # Price derivative in bumped markets
    price_plus = derivative.price(market_plus)   
    price_minus = derivative.price(market_minus)

    # Calculate delta
    delta = (price_plus - price_minus) / (2*bump_size)
    return delta

def gamma(derivative: Derivative, market: Market, pct=0.001):
    if pct <= 0:
        raise ValueError(f"pct must be positive, got {pct}")

    # Get underlying values, spot
    underlying = derivative.underlying
    S = market.spot(underlying)

    # Build new markets, bump spot
    bump_size = S*pct
    market_plus = market.bump("spots", bump_size, underlying)
    market_minus = market.bump("spots", -bump_size, underlying)

    # Price derivative in bumped markets
    price_plus = derivative.price(market_plus)   
    price_minus = derivative.price(market_minus)

    # Calculate gamma
    gamma = (price_plus - 2 * derivative.price(market) + price_minus) / (bump_size**2)
    return gamma

def vega(derivative: Derivative, market: Market, pct=0.01):
    if pct <= 0:
        raise ValueError(f"pct must be positive, got {pct}")

    # Get underlying values, vol
    underlying = derivative.underlying
    sigma = market.vol(underlying)

    # Build new markets, bump vol
    bump_size = sigma*pct

    if bump_size == 0:
        raise ValueError(f"can't bump vol for {underlying}, it's zero")

    market_plus = market.bump("vols", bump_size, underlying)
    market_minus = market.bump("vols", -bump_size, underlying)

    # Price derivative in bumped markets
    price_plus = derivative.price(market_plus)   
    price_minus = derivative.price(market_minus)

    # Calculate vega
    vega = (price_plus - price_minus) / (2*bump_size)
    return vega

def rho(derivative: Derivative, market: Market, pct=0.01):
    if pct <= 0:
        raise ValueError(f"pct must be positive, got {pct}")

    # Get values, rate
    r = market.rate

    # Build new markets, bump rates
    bump_size = r*pct

    if bump_size == 0:
        raise ValueError(f"can't bump rate for, it's zero")

    market_plus = market.bump("rate", bump_size)
    market_minus = market.bump("rate", -bump_size)

    # Price derivative in bumped markets
    price_plus = derivative.price(market_plus)   
    price_minus = derivative.price(market_minus)

    # Calculate rho
    rho = (price_plus - price_minus) / (2*bump_size)
    return rho

def theta(derivative: Derivative, market: Market):
    
    # Build new markets, bump time by one day
    bump_size = 1/365
    market_plus = market.bump("time", bump_size)

    # Price derivative in bumped markets
    price_plus = derivative.price(market_plus)   

    # Calculate theta
    theta = price_plus - derivative.price(market)
    return theta

if __name__ == "__main__":

    base = Market(
        time=0.0,
        rate=0.04,
        spots={"SPX": 6000.0, "XYZ": 42.0},
        vols={"SPX": 0.18, "XYZ": 0.35},
        div_yields={"SPX": 0.013, "XYZ": 0.0},
        credit_spreads={"XYZ": 0.025},
    )

    call = CallOption("SPX", 6000, 0.5)
    fut = Future("SPX", 0.5)

    # 1. bump Greeks vs analytic Greeks on the call
    print("delta bump:    ", delta(call, base))                                     # ~0.5637
    print("delta analytic:", bs_delta(6000, 6000, 0.5, 0.04, 0.013, 0.18, "call"))  # ~0.5637
    print("gamma bump:    ", gamma(call, base))                                     # ~0.000512
    print("gamma analytic:", bs_gamma(6000, 6000, 0.5, 0.04, 0.013, 0.18))          # ~0.000512
    print("vega bump:     ", vega(call, base))                                      # ~1657.6
    print("vega analytic: ", bs_vega(6000, 6000, 0.5, 0.04, 0.013, 0.18))           # ~1657.6

    # 2. gamma bump-size tradeoff: middle should be closest to analytic
    print("gamma pct=0.01:      ", gamma(call, base, pct=0.01))
    print("gamma pct=0.0001:    ", gamma(call, base, pct=0.0001))
    print("gamma pct=0.00000001:", gamma(call, base, pct=0.00000001))  # rounding noise takes over

    # 3. future: never wrote analytic Greeks for it
    print("future delta:", delta(fut, base))   # ~1.0136
    print("future gamma:", gamma(fut, base))   # ~0
    print("future vega: ", vega(fut, base))    # 0.0

    # 4. theta on the call
    print("call theta:", theta(call, base))    # negative

    # 5. guards
    try:
        delta(call, base, pct=0)
        print("pct guard FAILED")
    except ValueError:
        print("pct guard works")

    zero_rate = base.set("rate", 0.0)
    try:
        rho(call, zero_rate)
        print("zero guard FAILED")
    except ValueError:
        print("zero guard works")