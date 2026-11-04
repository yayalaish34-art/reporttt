from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings


class Base(DeclarativeBase):
    pass


def _engine_options() -> dict:
    if settings.sqlalchemy_url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    # Every function instance would otherwise keep its own pool open against a small database,
    # and the pooler in front of it runs in transaction mode, which cannot hold prepared statements.
    return {"poolclass": NullPool, "connect_args": {"prepare_threshold": None}}


engine = create_engine(settings.sqlalchemy_url, **_engine_options())
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
