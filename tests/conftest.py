"""Shared fixtures: a fresh in-memory app per test, seeded by the lifespan
hook. Helpers create orders and pay them so tests read like the flows they
exercise."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.payments.gateway import FakePaymentGateway


@pytest.fixture()
def client():
    app = create_app(db_url="sqlite://")
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def declining_client():
    app = create_app(db_url="sqlite://")
    app.state.gateway = FakePaymentGateway(decline=True)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def supplements(client):
    listing = client.get("/api/supplements").json()
    assert listing, "catalog must be seeded at startup"
    return listing


def make_order_payload(items=None, **fields):
    if items is None:
        items = [{"supplement_id": 1, "qty": 2, "unit_price_cents": 1333}]
    payload = {
        "patient_name": "Demo Patient",
        "provider_name": "Dr. Dana Demo, MD",
        "items": items,
    }
    payload.update(fields)
    return payload


def create_order(client, items=None, **fields):
    response = client.post("/orders", json=make_order_payload(items=items, **fields))
    assert response.status_code == 201, response.text
    return response.json()


def pay(client, order_id):
    return client.post(f"/orders/{order_id}/pay")


def supplement_by_id(client, supplement_id):
    return next(
        s for s in client.get("/api/supplements").json() if s["id"] == supplement_id
    )
