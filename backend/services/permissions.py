"""Ролевые правила видимости пользователей и связанных с ними данных."""
from typing import Optional

from sqlalchemy.orm import Session

from auth import is_director_or_auditor
from models import User


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
