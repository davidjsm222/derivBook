import json
import math

import pytest

import api
from book import Book, Position
from market import Market
from shock import Move, Scenario, ShockType, exposure_map, interaction

# The example book from design/v6/Book6.dc.html, in book_report's input shape
MARKET = {
    "rate": 0.04,
    "underlyings": [
        {"id": "u1", "name": "SPX", "spot": 6000, "vol": 0.18, "div_yield": 0.013, "credit_spread": 0.0},
        {"id": "u2", "name": "XYZ", "spot": 42, "vol": 0.35, "div_yield": 0.0, "credit_spread": 0.025},
    ],
}
POSITIONS = [
    {"id": "p1", "spec": {"type": "european_call", "underlying": "u1", "strike": 6000, "expiry_years": 0.5}, "quantity": 10, "multiplier": 100},
    {"id": "p2", "spec": {"type": "european_put", "underlying": "u1", "strike": 5700, "expiry_years": 0.25}, "quantity": 20, "multiplier": 100},
    {"id": "p3", "spec": {"type": "american_put", "underlying": "u1", "strike": 5800, "expiry_years": 1}, "quantity": -5, "multiplier": 100},
    {"id": "p4", "spec": {"type": "future", "underlying": "u1", "expiry_years": 0.5}, "quantity": -4, "multiplier": 50},
    {"id": "p5", "spec": {"type": "sofr_future", "underlying": "", "expiry_years": 0.25}, "quantity": -10, "multiplier": 2500},
    {"id": "p6", "spec": {"type": "convertible", "underlying": "u2", "expiry_years": 5, "face": 1000, "conversion_ratio": 20}, "quantity": 50, "multiplier": 1},
]


def mv(field, amount, key=None, kind="add"):
    return {"field": field, "key": key, "amount": amount, "kind": kind}


# The presets the design builds for this book, then its custom scenario. The UI
# maps spot % -> spots PCT, vol points -> vols ADD /100, credit bp -> /10,000,
# rate bp -> /10,000, days -> time /365.
SCENARIOS = [
    {"id": "spot:u1:-10", "moves": [mv("spots", -0.10, "u1", "pct")]},
    {"id": "spot:u1:10", "moves": [mv("spots", 0.10, "u1", "pct")]},
    {"id": "vol:u1:-5", "moves": [mv("vols", -0.05, "u1")]},
    {"id": "vol:u1:5", "moves": [mv("vols", 0.05, "u1")]},
    {"id": "spot:u2:-10", "moves": [mv("spots", -0.10, "u2", "pct")]},
    {"id": "spot:u2:10", "moves": [mv("spots", 0.10, "u2", "pct")]},
    {"id": "vol:u2:-5", "moves": [mv("vols", -0.05, "u2")]},
    {"id": "vol:u2:5", "moves": [mv("vols", 0.05, "u2")]},
    {"id": "cs:u2:-100", "moves": [mv("credit_spreads", -0.01, "u2")]},
    {"id": "cs:u2:100", "moves": [mv("credit_spreads", 0.01, "u2")]},
    {"id": "rate:-25", "moves": [mv("rate", -0.0025)]},
    {"id": "rate:25", "moves": [mv("rate", 0.0025)]},
    {"id": "time:1", "moves": [mv("time", 1 / 365)]},
    {"id": "combo:selloff", "moves": [mv("spots", -0.10, "u1", "pct"), mv("spots", -0.10, "u2", "pct"),
                                      mv("vols", 0.08, "u1"), mv("vols", 0.08, "u2"), mv("rate", -0.0025)]},
    {"id": "combo:credit:u2", "moves": [mv("spots", -0.20, "u2", "pct"), mv("vols", 0.10, "u2"), mv("credit_spreads", 0.02, "u2")]},
    {"id": "c1", "moves": [mv("rate", 0.0050), mv("spots", -0.05, "u1", "pct")]},
]


def _direct():
    # The same book built straight from the engine, without api.py
    m = Market(0.0, 0.04, {"u1": 6000.0, "u2": 42.0}, {"u1": 0.18, "u2": 0.35},
               {"u1": 0.013, "u2": 0.0}, {"u1": 0.0, "u2": 0.025})
    book = Book([Position(p["id"], api.make_derivative(p["spec"]), p["quantity"] * p["multiplier"]) for p in POSITIONS])
    scen = [Scenario(s["id"], [Move(x["field"], x["amount"], x["key"], ShockType(x["kind"])) for x in s["moves"]]) for s in SCENARIOS]
    return m, book, scen


@pytest.fixture(scope="module")
def report():
    return api.book_report(MARKET, POSITIONS, SCENARIOS)


def test_report_is_plain_json(report):
    json.dumps(report, allow_nan=False)


def test_positions_and_book_value(report):
    m, book, _ = _direct()
    by_id = {p["id"]: p for p in report["positions"]}
    for p in POSITIONS:
        d = api.make_derivative(p["spec"])
        r = by_id[p["id"]]
        size = p["quantity"] * p["multiplier"]
        assert r["size"] == size
        assert r["price"] == pytest.approx(float(d.price(m)), rel=1e-12)
        assert r["notional"] == pytest.approx(float(d.price(m)) * size, rel=1e-12)
        if p["spec"]["type"] in ("future", "sofr_future"):
            assert r["value"] == 0
        else:
            assert r["value"] == pytest.approx(r["notional"], rel=1e-12)
    assert report["book"]["value"] == pytest.approx(sum(p["value"] for p in report["positions"]))
    assert report["book"]["gross"] == pytest.approx(sum(abs(p["notional"]) for p in report["positions"]))
    # position_values agrees: price × size for every position
    for pid, v in book.position_values(m).items():
        assert by_id[pid]["notional"] == pytest.approx(float(v), rel=1e-12)


def test_scenarios_match_exposure_map(report):
    m, book, scen = _direct()
    df = exposure_map(book, m, scen)
    assert [s["id"] for s in report["scenarios"]] == [s.name for s in scen]
    for s in report["scenarios"]:
        for pid, v in s["changes"].items():
            assert v == pytest.approx(float(df.loc[pid, s["id"]]), abs=1e-9)
        assert s["total"] == pytest.approx(float(df.loc["Total", s["id"]]), abs=1e-9)
        assert s["total"] == pytest.approx(sum(s["changes"].values()), abs=1e-6)


def test_interactions_match_interaction(report):
    m, book, scen = _direct()
    multi = [s for s in scen if len(s.moves) > 1]
    assert [i["id"] for i in report["interactions"]] == [s.name for s in multi]
    for s, got in zip(multi, report["interactions"]):
        it = interaction(book, m, s)
        cols = list(it.columns[:-3])
        assert got["moves"] == cols
        for pid in [p["id"] for p in POSITIONS]:
            r = got["positions"][pid]
            assert r["singles"] == pytest.approx([float(it.loc[pid, c]) for c in cols], abs=1e-9)
            assert r["sum"] == pytest.approx(float(it.loc[pid, "Sum of singles"]), abs=1e-9)
            assert r["joint"] == pytest.approx(float(it.loc[pid, "Joint"]), abs=1e-9)
            assert r["interaction"] == pytest.approx(float(it.loc[pid, "Interaction"]), abs=1e-9)
        # the book row is the sum of the positions
        for k in ("sum", "joint", "interaction"):
            assert got["book"][k] == pytest.approx(sum(got["positions"][p][k] for p in got["positions"]), abs=1e-6)
        for i in range(len(cols)):
            assert got["book"]["singles"][i] == pytest.approx(sum(got["positions"][p]["singles"][i] for p in got["positions"]), abs=1e-6)


def test_pct_of_size(report):
    by_id = {p["id"]: p for p in report["positions"]}
    for s in report["scenarios"]:
        for pid, v in s["changes"].items():
            assert s["pct_of_size"][pid] == pytest.approx(v / abs(by_id[pid]["notional"]) * 100)
        assert s["total_pct_of_gross"] == pytest.approx(s["total"] / report["book"]["gross"] * 100)


def test_selloff_moves_the_book(report):
    s = {x["id"]: x for x in report["scenarios"]}["combo:selloff"]
    assert all(math.isfinite(v) for v in s["changes"].values())
    assert s["changes"]["p5"] != 0  # the SOFR future reads the rate move


def test_bad_books_are_refused():
    with pytest.raises(ValueError):  # position on an underlying the market doesn't have
        api.book_report(MARKET, [{**POSITIONS[0], "spec": {**POSITIONS[0]["spec"], "underlying": "u9"}}], [])
    with pytest.raises(ValueError):  # a scenario moving the same input twice can't be split by interaction()
        api.book_report(MARKET, POSITIONS[:1], [{"id": "x", "moves": [mv("rate", 0.01), mv("rate", 0.01)]}])
    with pytest.raises(ValueError):  # "Total" is exposure_map's own row
        api.book_report(MARKET, [{**POSITIONS[0], "id": "Total"}], [])


def test_empty_pieces():
    r = api.book_report(MARKET, [], SCENARIOS)
    assert r["positions"] == [] and r["scenarios"] == [] and r["book"] == {"value": 0, "gross": 0}
    r = api.book_report(MARKET, POSITIONS, [])
    assert r["scenarios"] == [] and len(r["positions"]) == len(POSITIONS)
