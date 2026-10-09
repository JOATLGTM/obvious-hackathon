"""Shared Jinja environment. The `cents` filter formats integer cents as
dollars — display-only; the stored and computed values stay in cents."""

from pathlib import Path

from fastapi.templating import Jinja2Templates

from app.money_format import fmt_cents

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
templates.env.filters["cents"] = fmt_cents
