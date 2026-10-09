"""Catalog seed: a small hardcoded supplement list, inserted at startup.

Seeding is idempotent — it only inserts when the catalog is empty, so
restarts and concurrent workers never duplicate rows. Real costs in cents;
stock counts are arbitrary but plausible for a clinic dispensary.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Supplement

# (name, sku, unit_cost_cents, stock_qty)
CATALOG: list[tuple[str, str, int, int]] = [
    ("Vitamin D3 1000 IU (60 caps)", "VIT-D3-60", 425, 120),
    ("Magnesium Glycinate 200 mg (90 caps)", "MAG-GLY-90", 890, 80),
    ("Omega-3 Fish Oil 1000 mg (120 softgels)", "OMEGA3-120", 1120, 150),
    ("B-Complex with Folate (60 caps)", "B-CPLX-60", 640, 100),
    ("Zinc Picolinate 25 mg (60 caps)", "ZINC-PIC-60", 310, 200),
    ("Probiotic 50 Billion CFU (30 caps)", "PROB-50B-30", 1895, 60),
]


def seed_catalog(session: Session) -> None:
    if session.scalars(select(Supplement).limit(1)).first() is not None:
        return
    for name, sku, cost_cents, stock in CATALOG:
        session.add(
            Supplement(name=name, sku=sku, unit_cost_cents=cost_cents, stock_qty=stock)
        )
    session.commit()
