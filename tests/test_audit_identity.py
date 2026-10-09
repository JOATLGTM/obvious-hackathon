"""The audit story: exactly three persisted ledger rows per paid order whose
sum is the amount paid (AC3), and the receipt surfaces the persisted split."""

from __future__ import annotations

from conftest import create_order, pay


def _paid_receipt(client, supplements, items):
    view = create_order(client, items=items)
    assert pay(client, view["id"]).status_code == 200
    return client.get(f"/orders/{view['id']}").json()


def test_paid_order_has_exactly_three_ledger_entries(client, supplements):
    supp = supplements[0]
    receipt = _paid_receipt(
        client,
        supplements,
        [{"supplement_id": supp["id"], "qty": 2, "unit_price_cents": 1333}],
    )
    types = [e["entry_type"] for e in receipt["ledger"]]
    assert sorted(types) == ["cogs", "platform_fee", "provider_margin"]
    total = sum(e["amount_cents"] for e in receipt["ledger"])
    assert total == receipt["payment"]["amount_cents"]
    assert total == receipt["split"]["subtotal_cents"]


def test_fee_matches_bps_formula_on_paid_order(client, supplements):
    supp = supplements[0]
    receipt = _paid_receipt(
        client,
        supplements,
        [{"supplement_id": supp["id"], "qty": 3, "unit_price_cents": 1999}],
    )
    subtotal = 3 * 1999
    assert receipt["split"]["fee_cents"] == subtotal * 75 // 10_000
    assert (
        receipt["split"]["margin_cents"]
        == subtotal - receipt["split"]["cogs_cents"] - receipt["split"]["fee_cents"]
    )


def test_ledger_backed_split_matches_snapshot_math(client, supplements):
    """The persisted split equals what the line snapshots imply — no drift."""
    a, b = supplements[0], supplements[1]
    items = [
        {"supplement_id": a["id"], "qty": 2, "unit_price_cents": 1333},
        {"supplement_id": b["id"], "qty": 1, "unit_price_cents": 500},
    ]
    receipt = _paid_receipt(client, supplements, items)
    subtotal = 2 * 1333 + 500
    cogs = 2 * a["unit_cost_cents"] + b["unit_cost_cents"]
    fee = subtotal * 75 // 10_000
    assert receipt["split"] == {
        "subtotal_cents": subtotal,
        "cogs_cents": cogs,
        "fee_cents": fee,
        "margin_cents": subtotal - cogs - fee,
    }


def test_negative_margin_is_persisted_and_flagged(client, supplements):
    supp = next(s for s in supplements if s["unit_cost_cents"] > 100)
    receipt = _paid_receipt(
        client,
        supplements,
        [{"supplement_id": supp["id"], "qty": 1, "unit_price_cents": 100}],
    )
    assert receipt["negative_margin"] is True
    assert receipt["split"]["margin_cents"] < 0
    total = sum(e["amount_cents"] for e in receipt["ledger"])
    assert total == receipt["payment"]["amount_cents"]  # identity holds even here
