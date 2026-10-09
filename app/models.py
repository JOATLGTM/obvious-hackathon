"""ORM models. Money is Integer cents everywhere — never floats.

Audit shape: an Order holds OrderItem lines whose unit cost and price are
snapshotted at creation. Paying writes one Payment and exactly three
LedgerEntry rows (cogs, platform_fee, provider_margin) in the same DB
transaction. The unique index on payments.order_id is a DB-level guard
against double-payment.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    """Naive UTC timestamp (SQLite stores naive anyway); UTC by convention."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Supplement(Base):
    __tablename__ = "supplements"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    sku: Mapped[str] = mapped_column(String(64), unique=True)
    unit_cost_cents: Mapped[int] = mapped_column(Integer)
    stock_qty: Mapped[int] = mapped_column(Integer)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_name: Mapped[str] = mapped_column(String(120))
    provider_name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|paid|cancelled
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    supplement_id: Mapped[int] = mapped_column(ForeignKey("supplements.id"))
    qty: Mapped[int] = mapped_column(Integer)
    unit_cost_cents: Mapped[int] = mapped_column(Integer)  # snapshot at creation
    unit_price_cents: Mapped[int] = mapped_column(Integer)  # snapshot at creation

    order: Mapped[Order] = relationship(back_populates="items")
    supplement: Mapped[Supplement] = relationship()  # display name only; money is snapshotted


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    # unique: a second successful payment row for the same order is a bug;
    # the DB enforces what the flow checks (defense in depth for races).
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="succeeded")
    gateway_ref: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    entry_type: Mapped[str] = mapped_column(String(24))  # cogs|platform_fee|provider_margin
    amount_cents: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(String(255))
