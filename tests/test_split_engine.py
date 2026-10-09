"""Table tests + invariant property for the pure split engine (AC3).

The identity cogs + fee + margin == subtotal must hold by construction on
every input; the fee must be exactly floor(subtotal * 75 / 10000).
"""

from __future__ import annotations

import random

import pytest

from app.split_engine import BPS_DENOMINATOR, PLATFORM_FEE_BPS, SplitLine, compute_split


def line(cost: int, price: int, qty: int = 1) -> SplitLine:
    return SplitLine(qty=qty, unit_cost_cents=cost, unit_price_cents=price)


def test_worked_example_from_design_doc():
    # subtotal 1333c, COGS 500c -> fee floor(1333 * 75 / 10000) = 9c, margin absorbs remainder
    result = compute_split([line(500, 1333)])
    assert result.subtotal_cents == 1333
    assert result.cogs_cents == 500
    assert result.fee_cents == 9
    assert result.margin_cents == 824
    assert result.identity_holds


def test_one_cent_subtotal_no_cogs():
    result = compute_split([line(0, 1)])
    assert (result.fee_cents, result.margin_cents) == (0, 1)
    assert result.identity_holds


def test_one_cent_subtotal_full_cogs():
    result = compute_split([line(1, 1)])
    assert (result.fee_cents, result.margin_cents) == (0, 0)
    assert result.identity_holds


def test_fee_is_floored_not_rounded():
    # 133c * 0.75% = 0.9975c -> floored to 0, not 1
    assert compute_split([line(0, 133)]).fee_cents == 0
    # 9999c * 0.75% = 74.9925c -> 74
    assert compute_split([line(0, 9999)]).fee_cents == 74
    # exact boundary: 10000c * 0.75% = 75.00c -> 75
    assert compute_split([line(0, 10000)]).fee_cents == 75
    # 10001c * 0.75% = 75.0075c -> still 75
    assert compute_split([line(0, 10001)]).fee_cents == 75


def test_negative_margin_is_allowed_and_balances():
    result = compute_split([line(900, 500)])
    assert result.fee_cents == 3  # floor(500 * 75 / 10000) = 3.75 -> 3
    assert result.margin_cents == -403
    assert result.identity_holds


def test_zero_price_line_is_allowed():
    result = compute_split([line(250, 0, qty=3)])
    assert result.subtotal_cents == 0
    assert result.cogs_cents == 750
    assert result.fee_cents == 0
    assert result.margin_cents == -750
    assert result.identity_holds


def test_multi_line_order_sums_lines():
    result = compute_split([line(500, 1333, qty=2), line(0, 1, qty=1)])
    assert result.subtotal_cents == 2667
    assert result.cogs_cents == 1000
    assert result.fee_cents == 2667 * PLATFORM_FEE_BPS // BPS_DENOMINATOR  # 20
    assert result.margin_cents == 2667 - 1000 - 20
    assert result.identity_holds


def test_empty_lines_rejected():
    with pytest.raises(ValueError):
        compute_split([])


def test_negative_qty_rejected():
    with pytest.raises(ValueError):
        compute_split([line(100, 100, qty=-1)])


def test_identity_holds_across_a_sample_of_subtotals():
    """Invariant property across a deterministic sample of orders."""
    rng = random.Random(20261009)
    for _ in range(500):
        qty = rng.randint(1, 5)
        price = rng.randint(0, 50_000)
        cost = rng.randint(0, price + 10_000)
        result = compute_split([line(cost, price, qty=qty)])
        subtotal = price * qty
        assert result.subtotal_cents == subtotal
        assert result.cogs_cents == cost * qty
        assert result.fee_cents == subtotal * PLATFORM_FEE_BPS // BPS_DENOMINATOR
        assert result.identity_holds
