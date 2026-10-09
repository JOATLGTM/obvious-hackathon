"""Pure money-split engine — the audited core of this slice.

No I/O, no ORM, no floats: integer cents only. The split identity

    cogs_cents + fee_cents + margin_cents == subtotal_cents

holds *by construction*: the platform fee is floored to the cent and the
provider margin absorbs the rounding remainder, so a paid order can never
fail reconciliation.

Fee basis: 75 basis points of the patient-paid order subtotal (the GMV).
If the business ever means bps of margin or of COGS instead, the change is
the single PLATFORM_FEE_BPS basis below.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

PLATFORM_FEE_BPS = 75  # 75 bps = 0.75% of the patient-paid subtotal
BPS_DENOMINATOR = 10_000


@dataclass(frozen=True)
class SplitLine:
    """One order line as the engine sees it: snapshot values in cents."""

    qty: int
    unit_cost_cents: int
    unit_price_cents: int


@dataclass(frozen=True)
class SplitResult:
    subtotal_cents: int
    cogs_cents: int
    fee_cents: int
    margin_cents: int

    @property
    def identity_holds(self) -> bool:
        """True iff cogs + fee + margin == subtotal (true by construction)."""
        return self.cogs_cents + self.fee_cents + self.margin_cents == self.subtotal_cents


def compute_split(lines: Sequence[SplitLine]) -> SplitResult:
    """Compute the order-level money split for a set of order lines.

    fee_cents    = floor(subtotal * PLATFORM_FEE_BPS / BPS_DENOMINATOR)
    margin_cents = subtotal - cogs - fee   (margin absorbs the remainder)

    Raises ValueError on an empty line set (orders require >= 1 item) or a
    negative qty.
    """
    if not lines:
        raise ValueError("compute_split requires at least one line")
    subtotal_cents = 0
    cogs_cents = 0
    for line in lines:
        if line.qty < 0:
            raise ValueError("qty must be non-negative")
        subtotal_cents += line.unit_price_cents * line.qty
        cogs_cents += line.unit_cost_cents * line.qty
    fee_cents = subtotal_cents * PLATFORM_FEE_BPS // BPS_DENOMINATOR  # floor
    margin_cents = subtotal_cents - cogs_cents - fee_cents
    return SplitResult(
        subtotal_cents=subtotal_cents,
        cogs_cents=cogs_cents,
        fee_cents=fee_cents,
        margin_cents=margin_cents,
    )
