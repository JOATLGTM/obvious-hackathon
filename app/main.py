"""FastAPI application factory. Run locally:

    uvicorn app.main:app --reload

Environment: DATABASE_URL (default sqlite:///./app.db),
PAYMENT_GATEWAY_MODE=decline (explicit test-mode flag for the stub gateway).
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.database import make_engine, make_session_factory
from app.models import Base
from app.payments.gateway import FakePaymentGateway
from app.routers import dashboard, orders
from app.seed import seed_catalog


@asynccontextmanager
async def lifespan(app: FastAPI):
    with app.state.session_factory() as session:
        seed_catalog(session)
    yield


def create_app(db_url: str | None = None) -> FastAPI:
    app = FastAPI(title="Supplement Ordering — vertical slice", lifespan=lifespan)
    app.state.engine = make_engine(db_url or os.environ.get("DATABASE_URL") or None)
    Base.metadata.create_all(app.state.engine)
    app.state.session_factory = make_session_factory(app.state.engine)
    app.state.gateway = FakePaymentGateway()
    app.include_router(orders.router)
    app.include_router(dashboard.router)
    return app


app = create_app()
