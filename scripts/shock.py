#   This is the shock engine
#   This script includes functions and classes that controls market and asset shocks
#   In other words, the backbone of the project and its purpose

#   David Smith

import pandas as pd
from dataclasses import dataclass
from enum import Enum

from market import Market
from book import Book, Position


class ShockType(Enum):
    ADD = "add"     # shift: value + amount
    PCT = "pct"     # percent: value * (1 + amount)

@dataclass
class Move:
    field: str
    amount: float
    key: str = None
    kind: ShockType = ShockType.ADD


@dataclass
class Scenario:
    name: str
    moves: list[Move]

def single(name, field, amount, key=None, kind=ShockType.ADD) -> Scenario:
    return Scenario(name, [Move(field, amount, key, kind)])

def apply_move(market: Market, move: Move) -> Market:
    if move.kind == ShockType.ADD:
        return market.bump(move.field, move.amount, move.key)
    elif move.kind == ShockType.PCT:
        return market.bump_pct(move.field, move.amount, move.key)
    raise ValueError(f"unknown shock kind: {move.kind}")


def apply_scenario(market: Market, scenario: Scenario) -> Market:
    for move in scenario.moves:
        market = apply_move(market, move)
    return market

SCENARIOS = [
    single("SPX -10%",          "spots",          -0.10,   "SPX", ShockType.PCT),
    single("SPX +10%",          "spots",           0.10,   "SPX", ShockType.PCT),
    single("SPX vol -5",        "vols",           -0.05,   "SPX"),
    single("SPX vol +5",        "vols",            0.05,   "SPX"),
    single("Rates -25bp",       "rate",           -0.0025),
    single("Rates +25bp",       "rate",            0.0025),
    single("XYZ -10%",          "spots",          -0.10,   "XYZ", ShockType.PCT),
    single("XYZ +10%",          "spots",           0.10,   "XYZ", ShockType.PCT),
    single("XYZ vol -5",        "vols",           -0.05,   "XYZ"),
    single("XYZ vol +5",        "vols",            0.05,   "XYZ"),
    single("XYZ credit -100bp", "credit_spreads", -0.01,   "XYZ"),
    single("XYZ credit +100bp", "credit_spreads",  0.01,   "XYZ"),
    single("1 day",             "time",            1/365),
]

JOINT_SCENARIOS = [
    Scenario("Equity crash", [
        Move("spots", -0.10,   "SPX", ShockType.PCT),
        Move("vols",   0.08,   "SPX"),
        Move("rate",  -0.0025),
    ]),
    Scenario("XYZ distress", [
        Move("spots",          -0.20, "XYZ", ShockType.PCT),
        Move("vols",            0.10, "XYZ"),
        Move("credit_spreads",  0.02, "XYZ"),
    ]),
]

def exposure_map(book: Book, market: Market, scenarios: list[Scenario]) -> pd.DataFrame:
    base_values = pd.Series(book.position_values(market))
    results = {}
    for s in scenarios:
        shocked_market = apply_scenario(market, s)
        shocked_values = pd.Series(book.position_values(shocked_market))
        results[s.name] = shocked_values - base_values
    df = pd.DataFrame(results)
    df.loc["Total"] = df.sum()
    return df


def _label(move: Move) -> str:
    who = f"{move.key} " if move.key else ""
    if move.kind == ShockType.PCT:
        return f"{who}{move.field} {move.amount:+.0%}"
    return f"{who}{move.field} {move.amount:+g}"


def interaction(book: Book, market: Market, scenario: Scenario) -> pd.DataFrame:
    singles = [Scenario(_label(m), [m]) for m in scenario.moves]
    df = exposure_map(book, market, singles)

    df["Sum of singles"] = df.sum(axis=1)

    df["Joint"] = exposure_map(book, market, [scenario])[scenario.name]

    df["Interaction"] = df["Joint"] - df["Sum of singles"]
    return df

if __name__ == "__main__":
    from derivatives import EuropeanCallOption, EuropeanPutOption, AmericanPutOption, Future, RatesFuture, Convertible

    pd.set_option("display.max_columns", None)
    pd.set_option("display.width", 250)

    base = Market(
        time=0.0,
        rate=0.04,
        spots={"SPX": 6000.0, "XYZ": 42.0},
        vols={"SPX": 0.18, "XYZ": 0.35},
        div_yields={"SPX": 0.013, "XYZ": 0.0},
        credit_spreads={"XYZ": 0.025},
    )

    book = Book([
        Position("SPX call",        EuropeanCallOption("SPX", 6000, 0.5), 1),
        Position("SPX put",         EuropeanPutOption("SPX", 6000, 0.5),  1),
        Position("SPX amer put",    AmericanPutOption("SPX", 6000, 0.5),  1),
        Position("SPX future",      Future("SPX", 0.5),                   1),
        Position("SOFR future",     RatesFuture("SOFR", 0.25),            1),
        Position("XYZ convertible", Convertible("XYZ", 5, 20, 1000),      1),
    ])

    # 1. single-shock map, same numbers as before the refactor
    print(exposure_map(book, base, SCENARIOS).round(2))

    # 2. joint scenarios side by side
    print(exposure_map(book, base, JOINT_SCENARIOS).round(2))

    # 3. interaction breakdown for each joint scenario
    for s in JOINT_SCENARIOS:
        print(f"\n{s.name}")
        print(interaction(book, base, s).round(2))

    # 4. sanity check: a one-move scenario has zero interaction everywhere
    check = interaction(book, base, SCENARIOS[0])
    print("\none-move interaction is zero:", (check["Interaction"].abs() < 1e-9).all())