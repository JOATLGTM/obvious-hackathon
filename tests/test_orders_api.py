"""API contract for order creation and the receipt endpoint (AC1, AC4)."""

from __future__ import annotations

from conftest import create_order, make_order_payload


def test_create_order_persists_draft_with_snapshots(client, supplements):
    supp = supplements[0]
    response = client.post(
        "/orders",
        json=make_order_payload(
            items=[{"supplement_id": supp["id"], "qty": 2, "unit_price_cents": 1333}]
        ),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "draft"
    assert body["lines"][0]["unit_cost_cents"] == supp["unit_cost_cents"]  # cost snapshot
    assert body["lines"][0]["unit_price_cents"] == 1333  # price snapshot


def test_create_order_requires_at_least_one_item(client):
    response = client.post("/orders", json=make_order_payload(items=[]))
    assert response.status_code == 422


def test_create_order_rejects_negative_price(client, supplements):
    items = [{"supplement_id": supplements[0]["id"], "qty": 1, "unit_price_cents": -1}]
    response = client.post("/orders", json=make_order_payload(items=items))
    assert response.status_code == 422


def test_create_order_rejects_float_money(client, supplements):
    # a JSON float must never reach the money path
    items = [{"supplement_id": supplements[0]["id"], "qty": 1, "unit_price_cents": 13.33}]
    response = client.post("/orders", json=make_order_payload(items=items))
    assert response.status_code == 422


def test_create_order_rejects_zero_qty(client, supplements):
    items = [{"supplement_id": supplements[0]["id"], "qty": 0, "unit_price_cents": 100}]
    response = client.post("/orders", json=make_order_payload(items=items))
    assert response.status_code == 422


def test_create_order_rejects_unknown_supplement(client):
    items = [{"supplement_id": 999_999, "qty": 1, "unit_price_cents": 100}]
    response = client.post("/orders", json=make_order_payload(items=items))
    assert response.status_code == 422


def test_receipt_json_and_html(client, supplements):
    supp = supplements[0]
    view = create_order(
        client,
        items=[{"supplement_id": supp["id"], "qty": 2, "unit_price_cents": 1333}],
    )
    json_receipt = client.get(
        f"/orders/{view['id']}", headers={"Accept": "application/json"}
    ).json()
    assert json_receipt["split"]["subtotal_cents"] == 2666
    assert json_receipt["split"]["fee_cents"] == 2666 * 75 // 10_000  # 19
    html = client.get(
        f"/orders/{view['id']}", headers={"Accept": "text/html"}
    ).text
    assert "13.33" in html  # per-line unit price, formatted to the cent
    assert "draft" in html


def test_receipt_404_for_unknown_order(client):
    assert client.get("/orders/424242").status_code == 404
