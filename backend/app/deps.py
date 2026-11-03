"""FastAPI dependencies: give routes access to the shared app state."""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.metrics import Metrics
from app.processor import Processor


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_processor(request: Request) -> Processor:
    return request.app.state.processor


def get_metrics(request: Request) -> Metrics:
    return request.app.state.metrics


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.api_db.sessionmaker() as session:
        yield session
