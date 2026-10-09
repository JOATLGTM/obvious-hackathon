"""Stock decrement + stock-out atomicity: on any failure nothing is
written (AC2)."""

from __future__ import annotations

from conftest import create_order, pay, supplement_by_id


def test_stock_decremented_after_pay(client, supplements):
    supp = supplements[0]
    view = create_order(
        client, items=[{"supplement_id": supp["id"], "qty": 3, "unit_price_cents": 999}]
    )
    assert pay(client, view["id"]).status_code == 200
    assert supplement_by_id(client, supp["id"])["stock_qty"] == supp["stock_qty"] - 3


def test_stock_out_rejects_payment_and_writes_nothing(client, supplements):
    supp = supplements[0]
    view = create_order(
        client,
        items=[
            {"supplement_id": supp["id"], "qty": supp["stock_qty"] + 1, "unit_price_cents": 999}
        ],
    )
    response = pay(client, view["id"])
    assert response.status_code == 409
    receipt = client.get(f"/orders/{view['id']}").json()
    assert receipt["status"] == "draft"
    assert receipt["ledger"] == []
    assert receipt["payment"] is None
    assert supplement_by_id(client, supp["id"])["stock_qty"] == supp["stock_qty"]


def test_partial_stockout_leaves_no_partial_writes(client, supplements):
    a, b = supplements[0], supplements[1]
    items = [
        # line 1 is in stock; line 2 is not — the whole payment must fail
        {"supplement_id": a["id"], "qty": 1, "unit_price_cents": 1000},
        {"supplement_id": b["id"], "qty": b["stock_qty"] + 5, "unit_price_cents": 1000},
    ]
    view = create_order(client, items=items)
    assert pay(client, view["id"]).status_code == 409
    assert supplement_by_id(client, a["id"])["stock_qty"] == a["stock_qty"]
    assert supplement_by_id(client, b["id"])["stock_qty"] == b["stock_qty"]


def test_last_unit_sellable_then_stock_out(client, supplements):
    supp = supplements[0]
    items = [
        {"supplement_id": supp["id"], "qty": supp["stock_qty"], "unit_price_cents": 500}
    ]
    view = create_order(client, items=items)
    assert pay(client, view["id"]).status_code == 200
    assert supplement_by_id(client, supp["id"])["stock_qty"] == 0
    second = create_order(client, items=items)
    assert pay(client, second["id"]).status_code == 409
