"""Provider dashboard: aggregates over the persisted ledger, paid-order
splits, and the inventory table with a restock form."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import get_session
from app.models import LedgerEntry, Order, Payment, Supplement
from app.render import templates
from app.views import load_receipt_view

router = APIRouter(tags=["dashboard"])


@router.get("/")
def home():
    return RedirectResponse("/dashboard", status_code=303)


@router.get("/dashboard")
def dashboard(request: Request, session: Session = Depends(get_session)):
    paid_orders = session.scalars(
        select(Order).where(Order.status == "paid").order_by(Order.paid_at)
    ).all()
    rows = []
    for order in paid_orders:
        view = load_receipt_view(session, order)
        rows.append(
            {
                "id": order.id,
                "patient_name": order.patient_name,
                "paid_at": order.paid_at.isoformat() if order.paid_at else None,
                "split": view["split"],
                "negative_margin": view["negative_margin"],
            }
        )

    # Aggregates come from the persisted money tables, not recomputation.
    gmv_cents = (
        session.scalar(select(func.coalesce(func.sum(Payment.amount_cents), 0))) or 0
    )
    fees_cents = (
        session.scalar(
            select(func.coalesce(func.sum(LedgerEntry.amount_cents), 0)).where(
                LedgerEntry.entry_type == "platform_fee"
            )
        )
        or 0
    )
    margins_cents = (
        session.scalar(
            select(func.coalesce(func.sum(LedgerEntry.amount_cents), 0)).where(
                LedgerEntry.entry_type == "provider_margin"
            )
        )
        or 0
    )

    supplements = session.scalars(select(Supplement).order_by(Supplement.name)).all()
    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "paid_orders": rows,
            "aggregates": {
                "gmv_cents": gmv_cents,
                "fees_cents": fees_cents,
                "margins_cents": margins_cents,
            },
            "supplements": supplements,
        },
    )


@router.post("/inventory/{supplement_id}/restock")
def restock(supplement_id: int, qty: int = Form(...), session: Session = Depends(get_session)):
    if qty < 1:
        raise HTTPException(status_code=422, detail="qty must be at least 1")
    supplement = session.get(Supplement, supplement_id)
    if supplement is None:
        raise HTTPException(status_code=404, detail=f"supplement #{supplement_id} not found")
    supplement.stock_qty += qty
    session.commit()
    return RedirectResponse("/dashboard", status_code=303)
