"""Async database engines.

Two separate connection pools are used on purpose:
  * `api`    - serves HTTP requests (webhook insert, reads)
  * `worker` - used by background processing and the recovery sweeper
so a burst of background work can never starve the webhook endpoint of
connections (which would break the 500 ms response requirement).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.models import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def as_utc(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; we always store UTC, so tag them as such."""
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def normalize_database_url(raw: str) -> tuple[str, dict]:
    """Accept the plain URLs that Supabase/Render show and adapt them for asyncpg.

    - postgres:// or postgresql://  -> postgresql+asyncpg://
    - ?sslmode=require               -> asyncpg `ssl` connect arg (asyncpg rejects sslmode)
    - port 6543 (transaction pooler) -> disable prepared statement caches
    """
    url = make_url(raw)
    connect_args: dict = {}
    if url.drivername in ("postgres", "postgresql", "postgresql+psycopg2"):
        url = url.set(drivername="postgresql+asyncpg")
    if url.drivername.startswith("postgresql"):
        query = dict(url.query)
        sslmode = query.pop("sslmode", None)
        if sslmode and sslmode != "disable":
            connect_args["ssl"] = "require" if sslmode in ("require", "prefer", "allow") else sslmode
        url = url.set(query=query)
        if url.port == 6543:
            connect_args["statement_cache_size"] = 0
            url = url.update_query_dict({"prepared_statement_cache_size": "0"})
    return url.render_as_string(hide_password=False), connect_args


class Database:
    def __init__(self, raw_url: str, *, pool_size: int, max_overflow: int) -> None:
        url, connect_args = normalize_database_url(raw_url)
        self.dialect = make_url(url).get_backend_name()
        kwargs: dict = {"pool_pre_ping": True, "connect_args": connect_args}
        if self.dialect != "sqlite":
            kwargs.update(pool_size=pool_size, max_overflow=max_overflow, pool_recycle=300)
        else:
            connect_args.setdefault("timeout", 15)  # wait on SQLite write locks instead of failing
        self.engine: AsyncEngine = create_async_engine(url, **kwargs)
        self.sessionmaker: async_sessionmaker[AsyncSession] = async_sessionmaker(
            self.engine, expire_on_commit=False
        )

    async def create_schema(self) -> None:
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def dispose(self) -> None:
        await self.engine.dispose()
