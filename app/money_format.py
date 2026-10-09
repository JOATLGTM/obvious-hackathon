"""Display-only formatting. Storage and math are integer cents everywhere;
this converts once, at the template boundary, and never the other way."""

from __future__ import annotations


def fmt_cents(cents: int) -> str:
    """Format integer cents as a dollar string, e.g. 1333 -> '$13.33',
    -403 -> '-$4.03'. Purely presentational."""
    value = int(cents)
    sign = "-" if value < 0 else ""
    abs_cents = abs(value)
    return f"{sign}${abs_cents // 100}.{abs_cents % 100:02d}"
