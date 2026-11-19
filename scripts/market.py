# This is the market engine
# This script defines the market dataclass that governs
#   simulation conditions and current state.
# Also includes helper functions to get values from market state

# David Smith

from dataclasses import dataclass, replace, FrozenInstanceError

@dataclass(frozen = True)
class Market:
    time: float
    rate: float
    spots: dict
    vols: dict
    div_yields: dict
    credit_spreads: dict

    def set(self, field: str, val: float, key: str = None):
        if key is None:
            return replace(self, **{field: val})
        else:
            old_dict = getattr(self, field)
            new_dict = {**old_dict, key: val}
            return replace(self, **{field: new_dict})

    def bump(self, field: str, amt: float, key: str = None):
        if key is None:
            val = getattr(self, field)
            return replace(self, **{field: val+amt})
        else:
            old_dict = getattr(self, field)
            val = old_dict[key]
            new_dict = {**old_dict, key: val+amt}
            return replace(self, **{field: new_dict})

    def spot(self, key):
        if key not in self.spots:
            raise KeyError(f"no spot for {key}")
        return self.spots[key]

    def vol(self, key):
        if key not in self.vols:
            raise KeyError(f"no spot for {key}")
        return self.vols[key]

    def div_yield(self, key):
        if key not in self.div_yields:
            raise KeyError(f"no spot for {key}")
        return self.div_yields[key]

    def credit_spread(self, key):
        if key not in self.credit_spreads:
            raise KeyError(f"no spot for {key}")
        return self.credit_spreads[key]

    def bump_pct(self, field: str, pct: float, key: str = None):
        if key is None:
            val = getattr(self, field)
            return replace(self, **{field: val+val*pct})
        else:
            old_dict = getattr(self, field)
            val = old_dict[key]
            new_dict = {**old_dict, key: val+val*pct}
            return replace(self, **{field: new_dict})
    
if __name__ == "__main__":

    # local test block

    time=0.0
    rate=0.0375
    spots={"SPX": 6000.0, "XYZ": 42.0}
    vols={"SPX": 0.18, "XYZ": 0.35}
    div_yields={"SPX": 0.013, "XYZ": 0.0}
    credit_spreads={"XYZ": 0.025}

    base = Market(time, rate, spots, vols, div_yields, credit_spreads)

    # print out test values

    print(base.bump("spots", 50, key="SPX")) # 6050
    print(base.bump("rate", 0.0025))         # 0.040
    print(base.bump("time", 1/365))          # 1/365 (one day)
    print(base.set("vols", 0.30, key="SPX")) # 0.48

    try:
        base.rate = 0.05
        print("frozen FAILED")
    except FrozenInstanceError:
        print("frozen works")