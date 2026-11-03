from __future__ import annotations

from fastapi import APIRouter, Depends

from app.config import BASE_CURRENCY, SUPPORTED_CURRENCIES, Settings
from app.deps import get_settings_dep
from app.schemas import CurrenciesOut

router = APIRouter(prefix="/v1/currencies", tags=["currencies"])


@router.get("", response_model=CurrenciesOut, summary="Supported currencies and the fixed rates in use")
async def list_currencies(settings: Settings = Depends(get_settings_dep)) -> CurrenciesOut:
    return CurrenciesOut(
        base=BASE_CURRENCY,
        supported=list(SUPPORTED_CURRENCIES),
        rates_to_inr=settings.fx_rates_to_inr,
        as_of=settings.fx_rates_as_of,
        display_decimals=2,
        rounding="ROUND_HALF_EVEN",
    )
