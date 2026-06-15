"""Ролевые правила видимости пользователей и связанных с ними данных."""
from typing import Optional

from sqlalchemy.orm import Session

from auth import can_see_confidential, is_director_or_auditor
from models import User


def hidden_user_ids(db: Session, me: User) -> set[int]:
    """Возвращает set user_id конфиденциальных сотрудников, которых me НЕ должен
    видеть в выборках/отчётах (Фича 2).

    - superadmin / gen_director → пустой set (видят всех);
    - остальные (admin, auditor, accountable) → все is_confidential=True,
      КРОМЕ самого me (конфиденциальный сотрудник всегда видит себя).
    """
    if can_see_confidential(me):
        return set()
    rows = (
        db.query(User.id)
        .filter(
            User.org_id == me.org_id,
            User.is_confidential.is_(True),
            User.id != me.id,
        )
        .all()
    )
    return {uid for (uid,) in rows}


def visible_user_ids(db: Session, me: User) -> Optional[list[int]]:
    """Возвращает список user_id, которых me имеет право видеть в финансовых выборках.

    - admin / gen_director / auditor → None ("все в org", роутер не накладывает фильтра)
    - accountable → свой id + рекурсивно все подчинённые через supervisor_id
    """
    if is_director_or_auditor(me):
        return None

    seen: set[int] = {me.id}
    frontier: list[int] = [me.id]
    while frontier:
        rows = (
            db.query(User.id)
            .filter(User.org_id == me.org_id, User.supervisor_id.in_(frontier))
            .all()
        )
        next_ids = [uid for (uid,) in rows if uid not in seen]
        if not next_ids:
            break
        seen.update(next_ids)
        frontier = next_ids
    return sorted(seen)
