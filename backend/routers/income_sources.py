"""Источники дохода (IncomeSource) — справочник для приходов (как подразделения).

Права:
  - GET  — admin / gen_director / auditor (require_director_or_auditor).
           Параметр active_only=true отдаёт только включённые (для выпадающих списков).
  - POST / PATCH / DELETE — admin / superadmin (require_admin).
  - Удаление запрещено, если на источник ссылаются приходы — вместо удаления
    используйте выключение (is_active=false), чтобы он пропал из списков, но
    история приходов осталась корректной.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import require_admin, require_director_or_auditor
from database import get_db
from models import Income, IncomeSource, User
from schemas import IncomeSourceCreate, IncomeSourceOut, IncomeSourceUpdate
from services.permissions import owner_isolation_ws_id


router = APIRouter(prefix="/api/income-sources", tags=["income-sources"])


def _block_isolated_owner(db: Session, me: User) -> None:
    """Источники дохода — общефирменный справочник, не относится к проектным
    пространствам. Изолированному владельцу пространства он недоступен."""
    if owner_isolation_ws_id(db, me) is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Недоступно в проектном пространстве")


def _counts(db: Session, org_id: int) -> dict[int, int]:
    rows = (
        db.query(Income.source_id, func.count(Income.id))
        .filter(Income.org_id == org_id, Income.source_id.isnot(None))
        .group_by(Income.source_id)
        .all()
    )
    return {sid: c for sid, c in rows}


def _to_out(s: IncomeSource, counts: dict[int, int]) -> IncomeSourceOut:
    out = IncomeSourceOut.model_validate(s)
    out.income_count = counts.get(s.id, 0)
    return out


@router.get("", response_model=List[IncomeSourceOut])
def list_income_sources(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    me: User = Depends(require_director_or_auditor),
):
    if owner_isolation_ws_id(db, me) is not None:
        return []  # владельцу пространства общефирменный справочник не показываем
    q = db.query(IncomeSource).filter(IncomeSource.org_id == me.org_id)
    if active_only:
        q = q.filter(IncomeSource.is_active.is_(True))
    sources = q.order_by(IncomeSource.name).all()
    counts = _counts(db, me.org_id)
    return [_to_out(s, counts) for s in sources]


@router.post("", response_model=IncomeSourceOut, status_code=status.HTTP_201_CREATED)
def create_income_source(
    payload: IncomeSourceCreate,
    db: Session = Depends(get_db),
    me: User = Depends(require_admin),
):
    _block_isolated_owner(db, me)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Название не может быть пустым")
    exists = (
        db.query(IncomeSource.id)
        .filter(IncomeSource.org_id == me.org_id, IncomeSource.name == name)
        .first()
    )
    if exists:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Источник с таким названием уже есть")
    s = IncomeSource(org_id=me.org_id, name=name, is_active=True)
    db.add(s)
    db.commit()
    db.refresh(s)
    return _to_out(s, {})


@router.patch("/{source_id}", response_model=IncomeSourceOut)
def update_income_source(
    source_id: int,
    payload: IncomeSourceUpdate,
    db: Session = Depends(get_db),
    me: User = Depends(require_admin),
):
    _block_isolated_owner(db, me)
    s = db.get(IncomeSource, source_id)
    if not s or s.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Источник не найден")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        name = data["name"].strip()
        if not name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Название не может быть пустым")
        dup = (
            db.query(IncomeSource.id)
            .filter(
                IncomeSource.org_id == me.org_id,
                IncomeSource.name == name,
                IncomeSource.id != source_id,
            )
            .first()
        )
        if dup:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Источник с таким названием уже есть")
        s.name = name
    if "is_active" in data and data["is_active"] is not None:
        s.is_active = data["is_active"]

    db.commit()
    db.refresh(s)
    counts = _counts(db, me.org_id)
    return _to_out(s, counts)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_income_source(
    source_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(require_admin),
):
    _block_isolated_owner(db, me)
    s = db.get(IncomeSource, source_id)
    if not s or s.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Источник не найден")
    # include_deleted=True: даже soft-deleted приходы на источник блокируют удаление,
    # чтобы CASCADE не унёс их историю (тумблер is_active — штатный способ «спрятать»).
    used = db.query(Income.id).filter(Income.source_id == source_id).execution_options(include_deleted=True).first()
    if used:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Нельзя удалить: на источник ссылаются приходы. Выключите его (тумблер) — "
            "он пропадёт из списков, но история приходов сохранится.",
        )
    db.delete(s)
    db.commit()
    return None
