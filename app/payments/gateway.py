"""Payment gateway seam.

The whole payment provider is a stub: a Protocol that the pay flow depends
on, plus a fake implementation with a success path and an explicit decline
path for tests. Swapping in a real gateway means implementing
`PaymentGateway` and setting `app.state.gateway` — no flow code changes.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from typing import Optional, Protocol


@dataclass(frozen=True)
class ChargeResult:
    ok: bool
    gateway_ref: Optional[str] = None
    decline_reason: Optional[str] = None


class PaymentGateway(Protocol):
    def charge(self, *, amount_cents: int, order_id: int) -> ChargeResult:
        """Charge the patient. Implementations must not raise on declines;
        they return a failed ChargeResult instead."""
        ...


class FakePaymentGateway:
    """Always succeeds unless started in decline mode.

    Decline mode is an explicit test-mode flag: pass `decline=True` or set
    PAYMENT_GATEWAY_MODE=decline. It exists so the decline path is
    reachable in tests, not just in prose.
    """

    def __init__(self, decline: Optional[bool] = None) -> None:
        if decline is None:
            decline = os.environ.get("PAYMENT_GATEWAY_MODE", "").lower() == "decline"
        self._decline = decline

    def charge(self, *, amount_cents: int, order_id: int) -> ChargeResult:
        if self._decline:
            return ChargeResult(ok=False, decline_reason="test-mode decline")
        return ChargeResult(ok=True, gateway_ref=f"fake_{uuid.uuid4().hex[:12]}")
