"""View builders: projections from ORM rows to plain dicts.

The receipt's money split is read back from the persisted LedgerEntry rows
when the order is paid — showing the audit trail, not recomputing it, is
the point. Drafts (and only drafts) get a computed projection, because
nothing is persisted before payment.
"""

from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LedgerEntry, Order, OrderItem, Payment
from app.split_engine import SplitLine, SplitResult, compute_split

LEDGER_ENTRY_TYPES = ("cogs", "platform_fee", "provider_margin")


def split_lines(items: Iterable[OrderItem]) -> list[SplitLine]:
    return [
        SplitLine(
            qty=item.qty,
            unit_cost_cents=item.unit_cost_cents,
            unit_price_cents=item.unit_price_cents,
        )
        for item in items
    ]


def ledger_entries_for(order_id: int, split: SplitResult) -> list[LedgerEntry]:
    """The three rows that make a paid order auditable."""
    return [
        LedgerEntry(
            order_id=order_id,
            entry_type="cogs",
            amount_cents=split.cogs_cents,
            description=f"Cost of goods sold for order #{order_id}",
        ),
        LedgerEntry(
            order_id=order_id,
            entry_type="platform_fee",
            amount_cents=split.fee_cents,
            description="Platform fee: 75 bps of the patient-paid subtotal, floored to the cent",
        ),
        LedgerEntry(
            order_id=order_id,
            entry_type="provider_margin",
            amount_cents=split.margin_cents,
            description=(
                "Provider margin: subtotal minus COGS minus fee; absorbs the rounding remainder"
            ),
        ),
    ]


def split_from_ledger(entries: Iterable[LedgerEntry]) -> SplitResult | None:
    """Rebuild the split from persisted rows; None unless exactly the three
    expected types are present (drafts, cancellations)."""
    by_type = {entry.entry_type: entry.amount_cents for entry in entries}
    if set(by_type) != set(LEDGER_ENTRY_TYPES):
        return None
    return SplitResult(
        subtotal_cents=by_type["cogs"] + by_type["platform_fee"] + by_type["provider_margin"],
        cogs_cents=by_type["cogs"],
        fee_cents=by_type["platform_fee"],
        margin_cents=by_type["provider_margin"],
    )


def line_view(item: OrderItem) -> dict[str, Any]:
    line_subtotal = item.qty * item.unit_price_cents
    line_cogs = item.qty * item.unit_cost_cents
    return {
        "supplement_id": item.supplement_id,
        "name": item.supplement.name,
        "qty": item.qty,
        "unit_cost_cents": item.unit_cost_cents,
        "unit_price_cents": item.unit_price_cents,
        "line_subtotal_cents": line_subtotal,
        "line_cogs_cents": line_cogs,
        "line_gross_margin_cents": line_subtotal - line_cogs,
    }


def load_receipt_view(session: Session, order: Order) -> dict[str, Any]:
    """One-query receipt: lines, split, payment, ledger entries."""
    payment = session.scalar(select(Payment).where(Payment.order_id == order.id))
    ledger = list(session.scalars(select(LedgerEntry).where(LedgerEntry.order_id == order.id)))
    # Paid orders show the persisted split; drafts show the projection.
    ledger_split = split_from_ledger(ledger) if order.status == "paid" else None
    split = ledger_split if ledger_split is not None else compute_split(split_lines(order.items))
    return {
        "id": order.id,
        "status": order.status,
        "patient_name": order.patient_name,
        "provider_name": order.provider_name,
        "created_at": order.created_at.isoformat(),
        "paid_at": order.paid_at.isoformat() if order.paid_at else None,
        "lines": [line_view(item) for item in order.items],
        "split": {
            "subtotal_cents": split.subtotal_cents,
            "cogs_cents": split.cogs_cents,
            "fee_cents": split.fee_cents,
            "margin_cents": split.margin_cents,
        },
        "negative_margin": split.margin_cents < 0,
        "payment": {
            "amount_cents": payment.amount_cents,
            "status": payment.status,
            "gateway_ref": payment.gateway_ref,
            "created_at": payment.created_at.isoformat(),
        }
        if payment
        else None,
        "ledger": [
            {"entry_type": e.entry_type, "amount_cents": e.amount_cents, "description": e.description}
            for e in ledger
        ],
    }
