#   This is the exposure-map export
#   Runs locally (it needs pandas, which the browser never loads) and writes
#   web/src/data/exposure.json from shock.py, so the website's exposure map
#   shows the engine's numbers without starting Python.
#   (Since the v6 "build your own book" site, the web app prices books live and
#   no longer reads this file; it stays as the report on base.py's fixed book.)
#
#   Usage, from the repo root:  .venv/bin/python scripts/export.py

#   David Smith

import json
import math
from pathlib import Path

from shock import SCENARIOS, JOINT_SCENARIOS, exposure_map, interaction
from base import base_market, base_book, POSITION_IDS, POSITION_LABELS

DATA = Path(__file__).resolve().parents[1] / "web" / "src" / "data"
OUT = DATA / "exposure.json"


def dump(data):
    return json.dumps(data, indent=2, allow_nan=False) + "\n"


def _num(x):
    f = float(x)
    if not math.isfinite(f):
        raise ValueError(f"non-finite value in export: {x}")
    return f


def _move(m):
    return {"field": m.field, "key": m.key, "amount": _num(m.amount), "kind": m.kind.value}


def build():
    market = base_market()
    book = base_book()
    base_values = book.position_values(market)

    positions = [
        {
            "id": pid,
            "name": POSITION_LABELS[pid]["name"],
            "unit": POSITION_LABELS[pid]["unit"],
            "base_price": _num(base_values[pid]),
        }
        for pid in POSITION_IDS
    ]

    # Single shocks: one column per scenario, rows in book order, Total row dropped
    singles = exposure_map(book, market, SCENARIOS)
    columns = [{"label": s.name, "moves": [_move(m) for m in s.moves]} for s in SCENARIOS]
    values = [[_num(singles.loc[pid, s.name]) for s in SCENARIOS] for pid in POSITION_IDS]
    pct_of_price = [
        [v / positions[i]["base_price"] * 100 for v in row] for i, row in enumerate(values)
    ]

    # Joint scenarios: each move alone, their sum, all together, and the gap
    joint = []
    for s in JOINT_SCENARIOS:
        df = interaction(book, market, s)
        move_cols = list(df.columns[: len(s.moves)])
        joint.append({
            "name": s.name,
            "moves": [{"label": col, **_move(m)} for col, m in zip(move_cols, s.moves)],
            "positions": [
                {
                    "id": pid,
                    "singles": [_num(df.loc[pid, c]) for c in move_cols],
                    "sum": _num(df.loc[pid, "Sum of singles"]),
                    "joint": _num(df.loc[pid, "Joint"]),
                    "interaction": _num(df.loc[pid, "Interaction"]),
                }
                for pid in POSITION_IDS
            ],
        })

    return {
        "source": "scripts/export.py (shock.py on the base book and base market)",
        "base_market": {
            "time": market.time,
            "rate": market.rate,
            "spots": dict(market.spots),
            "vols": dict(market.vols),
            "div_yields": dict(market.div_yields),
            "credit_spreads": dict(market.credit_spreads),
        },
        "positions": positions,
        "columns": columns,
        "values": values,
        "pct_of_price": pct_of_price,
        "joint": joint,
    }


if __name__ == "__main__":
    data = build()
    DATA.mkdir(parents=True, exist_ok=True)
    OUT.write_text(dump(data))
    print(f"wrote {OUT}")
    for p, row in zip(data["positions"], data["values"]):
        print(f"{p['name']:18s}", " ".join(f"{v:8.2f}" for v in row))
