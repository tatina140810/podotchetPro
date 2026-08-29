"""Журнал изменений финансовых записей (record_change_log).

Пишется на КАЖДОЕ обновление и удаление расхода / прихода / передачи.
- update → diff только по изменившимся полям: {"amount": {"old": "3000", "new": "4500"}};
- delete → полный снимок записи (для восстановимости).

Значения приводятся к JSON-safe (Decimal → str, datetime → isoformat), чтобы diff
корректно ложился в JSON/JSONB и переживал восстановление без потери точности.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from models import RecordChangeLog, User


def _json_safe(v: Any) -> Any:
    if isinstance(v, Decimal):
        return str(v)  # сохраняем точность денег строкой
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def snapshot(obj) -> dict:
    """Полный снимок колонок записи (без relationship'ов), JSON-safe."""
    mapper = sa_inspect(obj).mapper
    return {attr.key: _json_safe(getattr(obj, attr.key)) for attr in mapper.column_attrs}


def diff_snapshots(before: dict, after: dict) -> dict:
    """{"field": {"old": ..., "new": ...}} только по изменившимся ключам."""
    out: dict = {}
    for key in before.keys() | after.keys():
        old, new = before.get(key), after.get(key)
        if old != new:
            out[key] = {"old": old, "new": new}
    return out


def log_update(db: Session, entity_type: str, obj, before: dict, user: User) -> None:
    """Записать обновление. before — снимок ДО мутации (snapshot(obj) до setattr).
    Если по факту ничего не изменилось — записи не создаём."""
    diff = diff_snapshots(before, snapshot(obj))
    if not diff:
        return
    db.add(RecordChangeLog(
        org_id=obj.org_id,
        entity_type=entity_type,
        entity_id=obj.id,
        action="update",
        changed_by=user.id,
        diff=diff,
    ))


def log_delete(db: Session, entity_type: str, obj, user: User) -> None:
    """Записать удаление. diff = полный снимок записи на момент удаления."""
    db.add(RecordChangeLog(
        org_id=obj.org_id,
        entity_type=entity_type,
        entity_id=obj.id,
        action="delete",
        changed_by=user.id,
        diff=snapshot(obj),
    ))
