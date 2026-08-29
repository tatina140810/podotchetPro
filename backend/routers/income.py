"""Income — поступление денег в организацию извне.
POST/DELETE — admin + gen_director. GET — admin/gen_director/auditor."""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from auth import (
    get_current_user,
    is_director_level,
    is_director_or_auditor,
    require_admin,
    require_director_level,
    require_director_or_auditor,
)
from database import get_db
from models import Income, IncomeSource, User
from schemas import IncomeCreate, IncomeOut, IncomeUpdate
from services.audit import log_delete, log_update, snapshot
from services.exchange import get_current_rate
from services.permissions import auditor_department_ids, hidden_user_ids
from services.soft_delete import soft_delete


router = APIRouter(prefix="/api/income", tags=["income"])


def _resolve_source(db: Session, org_id: int, source_id, source_text) -> "tuple[Optional[int], str]":
    """Возвращает (source_id, source_name). Если выбран справочник — имя берём из него
    (дублируется в текстовый source). Иначе используем свободный текст. Хотя бы одно
    из двух обязательно."""
    if source_id is not None:
        src = db.get(IncomeSource, source_id)
        if not src or src.org_id != org_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Источник не найден")
        return src.id, src.name
    text = (source_text or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите источник прихода")
    return None, text


def _to_out(inc: Income) -> IncomeOut:
    out = IncomeOut.model_validate(inc)
    out.received_by_name = inc.received_by.name if inc.received_by else None
    out.created_by_name = inc.created_by.name if inc.created_by else None
    return out


@router.post("", response_model=IncomeOut, status_code=status.HTTP_201_CREATED)
def create_income(
    payload: IncomeCreate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Записать приход.
    - Директор/админ — на любого сотрудника (received_by_id).
    - Подотчётный — приход можно записать ТОЛЬКО на себя.

    КГС-эквивалент фиксируется в момент создания (по текущему курсу), чтобы баланс
    не плавал при изменении курса. Если currency != KGS и курс не задан — 400.

    «Режим администратора» для Income не требует отдельного поля on_behalf_of:
    received_by_id и так указывает получателя, а created_by_id (= me) — кто внёс.
    """
    # Подотчётный (и любой не-директор) может писать приход только на себя.
    if not is_director_level(me) and payload.received_by_id != me.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Приход можно записать только на себя",
        )
    receiver = db.get(User, payload.received_by_id)
    if not receiver or receiver.org_id != me.org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Получатель не найден")

    src_id, src_name = _resolve_source(db, me.org_id, payload.source_id, payload.source)

    # Считаем amount_kgs (КГС-эквивалент)
    amount_kgs: Decimal | None
    if payload.currency == "KGS":
        amount_kgs = payload.amount
    else:
        rate = get_current_rate(db, me.org_id, payload.currency, "KGS")
        if rate is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Установите курс {payload.currency}/KGS перед записью прихода в {payload.currency}",
            )
        amount_kgs = payload.amount * rate

    inc = Income(
        org_id=me.org_id,
        amount=payload.amount,
        currency=payload.currency,
        amount_kgs=amount_kgs,
        source=src_name,
        source_id=src_id,
        description=payload.description,
        received_by_id=receiver.id,
        created_by_id=me.id,
        date=payload.date or datetime.utcnow(),
    )
    db.add(inc)
    db.commit()
    db.refresh(inc)
    return _to_out(inc)


@router.get("", response_model=List[IncomeOut])
def list_incomes(
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    limit: int = Query(default=200, le=1000),
    db: Session = Depends(get_db),
    me: User = Depends(require_director_or_auditor),
):
    """Список приходов в org с опциональным фильтром по дате."""
    q = db.query(Income).filter(Income.org_id == me.org_id)
    # Фича 2: приходы конфиденциальных сотрудников скрыты от не-уполномоченных ролей.
    hidden = hidden_user_ids(db, me)
    if hidden:
        q = q.filter(Income.received_by_id.notin_(hidden))
    dept_scope = auditor_department_ids(db, me)  # ограниченный аудитор — только своё подразделение
    if dept_scope is not None:
        q = q.filter(Income.department_id.in_(dept_scope))
    if date_from:
        q = q.filter(Income.date >= date_from)
    if date_to:
        q = q.filter(Income.date < date_to)
    rows = q.order_by(Income.date.desc()).limit(limit).all()
    return [_to_out(r) for r in rows]


@router.get("/mine", response_model=List[IncomeOut])
def list_my_incomes(
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Свои приходы (received_by_id == me) — для блока «История» на /my-expenses.
    Роль accountable не имеет доступа к общему GET /api/income (только директор).
    В IncomeOut отдаётся created_by_id — фронт по нему различает: свой ручной приход
    (created_by == me → можно править/удалять) vs внесённый другим (read-only)."""
    rows = (
        db.query(Income)
        .filter(Income.org_id == me.org_id, Income.received_by_id == me.id)
        .order_by(Income.date.desc())
        .limit(500)
        .all()
    )
    return [_to_out(r) for r in rows]


def _ensure_can_modify_income(db: Session, me: User, inc: Income) -> None:
    """Права на правку/удаление прихода.
    - Привилегированные (admin/superadmin/gen_director/auditor) — любой приход, кроме
      конфиденциального без доступа.
    - Сотрудник — только СВОЙ РУЧНОЙ приход (created_by == me). Приход, внесённый
      другим (created_by != me) — 403: нельзя тихо удалить полученную/выданную сумму."""
    if is_director_or_auditor(me):
        if inc.received_by_id in hidden_user_ids(db, me):  # Фича 2
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Приход не найден")
        return
    if inc.created_by_id != me.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Редактировать можно только свои приходы (внесённые вами)",
        )


@router.delete("/{income_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_income(
    income_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Удалить приход. Сотрудник — только свой ручной; admin/auditor — любой."""
    inc = db.get(Income, income_id)  # хук: soft-deleted → None → 404
    if not inc or inc.org_id != me.org_id or inc.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приход не найден")
    _ensure_can_modify_income(db, me, inc)
    log_delete(db, "income", inc, me)
    soft_delete(inc, me)
    db.commit()
    return None


@router.patch("/{income_id}", response_model=IncomeOut)
def update_income(
    income_id: int,
    payload: IncomeUpdate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """Изменить приход. Сотрудник — только свой ручной; admin/auditor — любой.
    При изменении amount/currency пересчитываем amount_kgs по ТЕКУЩЕМУ курсу.
    """
    inc = db.get(Income, income_id)
    if not inc or inc.org_id != me.org_id or inc.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приход не найден")
    _ensure_can_modify_income(db, me, inc)

    before = snapshot(inc)
    data = payload.model_dump(exclude_unset=True)

    # Сотрудник не может переназначить получателя своего прихода (увести сумму другому) —
    # менять received_by_id разрешено только привилегированным ролям.
    if "received_by_id" in data and not is_director_or_auditor(me):
        data.pop("received_by_id")
    if "received_by_id" in data and data["received_by_id"] is not None:
        receiver = db.get(User, data["received_by_id"])
        if not receiver or receiver.org_id != me.org_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Получатель не найден")
        inc.received_by_id = data["received_by_id"]

    # Источник: если прислан source_id — берём имя из справочника; если только source —
    # свободный текст и сбрасываем привязку к справочнику.
    if "source_id" in data:
        if data["source_id"] is not None:
            src = db.get(IncomeSource, data["source_id"])
            if not src or src.org_id != me.org_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Источник не найден")
            inc.source_id = src.id
            inc.source = src.name
        else:
            inc.source_id = None
    if "source" in data and data["source"] is not None and "source_id" not in data:
        inc.source = data["source"]
        inc.source_id = None

    for f in ("description", "date"):
        if f in data:
            setattr(inc, f, data[f])

    # Если amount или currency меняется — нужно пересчитать KGS-эквивалент.
    new_amount = data.get("amount", inc.amount)
    new_currency = data.get("currency", inc.currency)
    if "amount" in data or "currency" in data:
        if new_currency == "KGS":
            inc.amount_kgs = new_amount
        else:
            rate = get_current_rate(db, me.org_id, new_currency, "KGS")
            if rate is None:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Курс {new_currency}/KGS не установлен — пересчёт невозможен",
                )
            from decimal import Decimal as _D
            inc.amount_kgs = _D(str(new_amount)) * rate
        inc.amount = new_amount
        inc.currency = new_currency

    db.flush()
    log_update(db, "income", inc, before, me)
    db.commit()
    db.refresh(inc)
    return _to_out(inc)
