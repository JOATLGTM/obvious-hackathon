"""Engine/session wiring. SQLite for the slice; DATABASE_URL swaps cleanly
(e.g. to Postgres) without touching flow code — that is the seam."""

from __future__ import annotations

import os

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

DEFAULT_DB_URL = "sqlite:///./app.db"


def make_engine(db_url: str | None = None) -> Engine:
    url = db_url or os.environ.get("DATABASE_URL") or DEFAULT_DB_URL
    kwargs: dict = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if url == "sqlite://" or url.endswith(":memory:"):
            # one shared connection so every thread sees the same in-memory DB
            kwargs["poolclass"] = StaticPool
    return create_engine(url, **kwargs)


def make_session_factory(engine: Engine) -> sessionmaker:
    # expire_on_commit=False keeps snapshot objects readable after commit;
    # reads that matter for receipts re-query the DB explicitly.
    return sessionmaker(bind=engine, expire_on_commit=False)
