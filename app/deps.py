"""FastAPI dependency wiring: session factory, request session, gateway."""

from __future__ import annotations

from collections.abc import Generator

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker

from app.payments.gateway import PaymentGateway


def get_session_factory(request: Request) -> sessionmaker:
    return request.app.state.session_factory


def get_session(
    session_factory: sessionmaker = Depends(get_session_factory),
) -> Generator[Session, None, None]:
    with session_factory() as session:
        yield session


def get_gateway(request: Request) -> PaymentGateway:
    return request.app.state.gateway
