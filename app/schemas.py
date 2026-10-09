"""Request schemas. Money fields are StrictInt: floats are rejected at the
boundary, so no dollar-string or decimal confusion can enter the money path."""

from __future__ import annotations

from pydantic import BaseModel, Field, StrictInt

from app.auth import DEMO_PROVIDER


class OrderItemIn(BaseModel):
    supplement_id: int = Field(gt=0)
    qty: int = Field(ge=1)
    unit_price_cents: StrictInt = Field(ge=0)  # StrictInt rejects floats like 13.33


class OrderIn(BaseModel):
    patient_name: str = Field(min_length=1, max_length=120)
    provider_name: str = Field(default=DEMO_PROVIDER, max_length=120)
    items: list[OrderItemIn] = Field(min_length=1)  # at least one item required
