#   This is the base setup
#   One definition of the base market and the base book, shared by api.py
#   (the website) and export.py (the exposure map). Copied from the test
#   blocks in book.py and shock.py; nothing here prices anything.

from market import Market
from book import Book, Position
from derivatives import (
    EuropeanCallOption,
    EuropeanPutOption,
    AmericanPutOption,
    Future,
    RatesFuture,
    Convertible,
)


def base_market() -> Market:
    # Same numbers as the test blocks in book.py, shock.py, derivatives.py and greeks.py
    return Market(
        time=0.0,
        rate=0.04,
        spots={"SPX": 6000.0, "XYZ": 42.0},
        vols={"SPX": 0.18, "XYZ": 0.35},
        div_yields={"SPX": 0.013, "XYZ": 0.0},
        credit_spreads={"XYZ": 0.025},
    )


# Position ids in book order. Each id is also the Position's name, so
# book.position_values() and shock.exposure_map() come back keyed by id.
POSITION_IDS = [
    "spx_call",
    "spx_put",
    "spx_amer_put",
    "spx_future",
    "sofr_future",
    "xyz_convertible",
]

# Display names and units. "name" is the short name the exposure map uses.
POSITION_LABELS = {
    "spx_call":        {"name": "SPX call",         "unit": "index points"},
    "spx_put":         {"name": "SPX put",          "unit": "index points"},
    "spx_amer_put":    {"name": "SPX American put", "unit": "index points"},
    "spx_future":      {"name": "SPX future",       "unit": "index points"},
    "sofr_future":     {"name": "SOFR future",      "unit": "price points"},
    "xyz_convertible": {"name": "XYZ convertible",  "unit": "dollars per bond"},
}


def base_derivatives(steps=None) -> dict:
    # The six instruments from the book in shock.py, keyed by id.
    # steps=None keeps each tree instrument's own default (500 in derivatives.py);
    # pass a number to build the same trees with fewer steps.
    tree = {} if steps is None else {"steps": steps}
    return {
        "spx_call":        EuropeanCallOption("SPX", 6000, 0.5),
        "spx_put":         EuropeanPutOption("SPX", 6000, 0.5),
        "spx_amer_put":    AmericanPutOption("SPX", 6000, 0.5, **tree),
        "spx_future":      Future("SPX", 0.5),
        "sofr_future":     RatesFuture("SOFR", 0.25),
        "xyz_convertible": Convertible("XYZ", 5, 20, 1000, **tree),
    }


def base_book() -> Book:
    # One of each, as in shock.py
    derivs = base_derivatives()
    return Book([Position(pid, derivs[pid], 1) for pid in POSITION_IDS])


if __name__ == "__main__":
    market = base_market()
    book = base_book()
    for pid, value in book.position_values(market).items():
        print(f"{pid:16s} {float(value):12.4f}")
