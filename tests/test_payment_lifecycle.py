"""Draft -> paid lifecycle, double-pay guard, cancel, decline path (AC2)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from conftest import create_order, make_order_payload, pay


def test_pay_moves_draft_to_paid(client, supplements):
    supp = supplements[0]
    view = create_order(
        client, items=[{"supplement_id": supp["id"], "qty": 1, "unit_price_cents": 1333}]
    )
    response = pay(client, view["id"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "paid"
    assert body["paid_at"] is not None
    assert body["payment"]["gateway_ref"].startswith("fake_")
    assert body["payment"]["amount_cents"] == 1333


def test_double_pay_is_rejected_with_no_partial_writes(client, supplements):
    supp = supplements[0]
    view = create_order(
        client, items=[{"supplement_id": supp["id"], "qty": 1, "unit_price_cents": 1333}]
    )
    assert pay(client, view["id"]).status_code == 200
    second = pay(client, view["id"])
    assert second.status_code == 409
    receipt = client.get(f"/orders/{view['id']}").json()
    assert receipt["status"] == "paid"
    assert len(receipt["ledger"]) == 3  # still exactly one split, not doubled


def test_pay_unknown_order_404(client):
    assert pay(client, 424242).status_code == 404


def test_cancelled_order_cannot_be_paid(client, supplements):
    supp = supplements[0]
    view = create_order(
        client, items=[{"supplement_id": supp["id"], "qty": 1, "unit_price_cents": 1333}]
    )
    assert client.post(f"/orders/{view['id']}/cancel").status_code == 200
    assert client.get(f"/orders/{view['id']}").json()["status"] == "cancelled"
    assert pay(client, view["id"]).status_code == 409


def test_paid_order_cannot_be_cancelled(client, supplements):
    supp = supplements[0]
    view = create_order(
        client, items=[{"supplement_id": supp["id"], "qty": 1, "unit_price_cents": 1333}]
    )
    assert pay(client, view["id"]).status_code == 200
    assert client.post(f"/orders/{view['id']}/cancel").status_code == 409


def test_gateway_decline_writes_nothing(declining_client):
    supp = declining_client.get("/api/supplements").json()[0]
    view = create_order(
        declining_client,
        items=[{"supplement_id": supp["id"], "qty": 1, "unit_price_cents": 1333}],
    )
    response = declining_client.post(f"/orders/{view['id']}/pay")
    assert response.status_code == 402
    receipt = declining_client.get(f"/orders/{view['id']}").json()
    assert receipt["status"] == "draft"
    assert receipt["ledger"] == []
    assert receipt["payment"] is None


def test_env_decline_mode_reaches_the_decline_path(monkeypatch):
    """The explicit test-mode flag: PAYMENT_GATEWAY_MODE=decline."""
    monkeypatch.setenv("PAYMENT_GATEWAY_MODE", "decline")
    app = create_app(db_url="sqlite://")
    with TestClient(app) as dc:
        supp = dc.get("/api/supplements").json()[0]
        view = dc.post(
            "/orders",
            json=make_order_payload(
                items=[{"supplement_id": supp["id"], "qty": 1, "unit_price_cents": 1000}]
            ),
        ).json()
        assert dc.post(f"/orders/{view['id']}/pay").status_code == 402
        assert dc.get(f"/orders/{view['id']}").json()["status"] == "draft"


def test_full_happy_path_create_pay_receipt(client, supplements):
    """End-to-end API happy path via TestClient."""
    supp = supplements[0]
    created = create_order(
        client, items=[{"supplement_id": supp["id"], "qty": 2, "unit_price_cents": 1333}]
    )
    paid = pay(client, created["id"])
    assert paid.status_code == 200
    receipt = client.get(f"/orders/{created['id']}").json()
    assert receipt["status"] == "paid"
    assert receipt["split"]["subtotal_cents"] == 2666
    assert receipt["split"]["cogs_cents"] == 2 * supp["unit_cost_cents"]
