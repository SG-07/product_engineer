"""GET /dashboard - redirect to the frontend dashboard.

Only a path on the API. GET / keeps returning the health JSON (required by the spec,
used by Render's health check). Returns 404 when FRONTEND_URL is not configured.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.exceptions import HTTPException
from fastapi.responses import RedirectResponse

from app.config import Settings
from app.deps import get_settings_dep

router = APIRouter(tags=["dashboard"])


@router.get(
    "/dashboard",
    status_code=307,
    summary="Redirect to the frontend dashboard",
    responses={307: {"description": "Redirect to FRONTEND_URL"}, 404: {"description": "FRONTEND_URL not configured"}},
)
async def dashboard(settings: Settings = Depends(get_settings_dep)):
    if not settings.frontend_url:
        raise HTTPException(status_code=404, detail="FRONTEND_URL is not configured")
    return RedirectResponse(settings.frontend_url, status_code=307)
