"""Курсы валют. POST — admin. GET /current — любая авторизованная роль."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin
from database import get_db
from models import ExchangeRate, User
from schemas import (
    CurrentRateOut,
    ExchangeRateCreate,
    ExchangeRateOut,
)
from services.exchange import fetch_nbkr_rate, fetch_nbkr_rates, get_current_rate


router = APIRouter(prefix="/api/exchange-rates", tags=["exchange-rates"])


@router.post("", response_model=ExchangeRateOut, status_code=status.HTTP_201_CREATED)
def create_rate(
    payload: ExchangeRateCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Установить новый курс. Старые записи не трогаем — храним историю."""
    r = ExchangeRate(
        org_id=admin.org_id,
        from_currency=payload.from_currency,
        to_currency=payload.to_currency,
        rate=payload.rate,
        created_by_id=admin.id,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return ExchangeRateOut.model_validate(r)


@router.post(
    "/refresh-from-nbkr",
    response_model=list[ExchangeRateOut],
    status_code=status.HTTP_201_CREATED,
)
def refresh_from_nbkr(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Тянет курсы USD/KGS, RUB/KGS, EUR/KGS с https://www.nbkr.kg/XML/daily.xml.
    Если ни одной валюты не получено — 502. Если получена только часть — сохраняет полученные."""
    rates = fetch_nbkr_rates(["USD", "RUB", "EUR"])
    if not rates:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Не удалось получить курсы с НБКР. Введите вручную.",
        )
    saved: list[ExchangeRateOut] = []
    for iso, rate in rates.items():
        r = ExchangeRate(
            org_id=admin.org_id,
            from_currency=iso,
            to_currency="KGS",
            rate=rate,
            created_by_id=admin.id,
        )
        db.add(r)
        db.flush()
        saved.append(ExchangeRateOut.model_validate(r))
    db.commit()
    return saved


@router.get("/current", response_model=CurrentRateOut)
def current_rate(
    from_currency: str = Query(default="USD", alias="from"),
    to_currency: str = Query(default="KGS", alias="to"),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Последний установленный курс пары. Если ничего не установлено — rate=null."""
    from_currency = from_currency.upper()
    to_currency = to_currency.upper()
    rate = get_current_rate(db, me.org_id, from_currency, to_currency)
    if rate is None:
        return CurrentRateOut(from_currency=from_currency, to_currency=to_currency, rate=None, date=None)
    # Для date — отдельный запрос (мы вернули только rate из service)
    row = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.org_id == me.org_id,
            ExchangeRate.from_currency == from_currency,
            ExchangeRate.to_currency == to_currency,
        )
        .order_by(ExchangeRate.date.desc())
        .first()
    )
    return CurrentRateOut(
        from_currency=from_currency,
        to_currency=to_currency,
        rate=rate,
        date=row.date if row else None,
    )
