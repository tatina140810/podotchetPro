"""Ролевые правила видимости пользователей и связанных с ними данных."""
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import (
    can_manage_workspaces,
    can_see_confidential,
    is_director_or_auditor,
)
from models import (
    BalanceTopUp,
    Category,
    Expense,
    Organization,
    ProjectWorkspace,
    ProjectWorkspaceMember,
    User,
)
from services.feature_flags import is_enabled


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


# ===================== Проектные пространства =====================
# Флаг организации, открывающий admin/auditor полную детализацию пространств.
WORKSPACE_AUDITOR_ACCESS_FLAG = "workspace_auditor_access"


def owned_active_workspace(db: Session, user_id: int, org_id: int) -> Optional[ProjectWorkspace]:
    """Активное пространство, владельцем которого является user_id (или None)."""
    return (
        db.query(ProjectWorkspace)
        .filter(
            ProjectWorkspace.org_id == org_id,
            ProjectWorkspace.owner_id == user_id,
            ProjectWorkspace.is_active.is_(True),
        )
        .first()
    )


def owned_active_workspace_id(db: Session, user_id: int, org_id: int) -> Optional[int]:
    """id активного пространства, владельцем которого является user_id (или None).
    Один пользователь может владеть максимум одним активным пространством."""
    ws = owned_active_workspace(db, user_id, org_id)
    return ws.id if ws else None


def owner_isolation_ws_id(db: Session, me: User) -> Optional[int]:
    """Если me — владелец активного пространства, его интерфейс ИЗОЛИРОВАН в это
    пространство: на всех обычных экранах он видит только данные своего пространства
    (свои + подотчётных-участников), а не всю организацию. Иначе None.

    Делается на бэкенде, чтобы переиспользовать привычный интерфейс администратора
    (детализация, управление категориями), а не строить отдельный UI."""
    return owned_active_workspace_id(db, me.id, me.org_id)


def workspace_member_ids(db: Session, ws_id: int) -> set[int]:
    rows = db.query(ProjectWorkspaceMember.user_id).filter(
        ProjectWorkspaceMember.workspace_id == ws_id,
    ).all()
    return {uid for (uid,) in rows}


def member_active_workspace_id(db: Session, user_id: int, org_id: int) -> Optional[int]:
    """id активного пространства, УЧАСТНИКОМ которого является user_id (владелец тоже
    участник). Используется для авто-привязки расходов участника к пространству и для
    выбора подразделений пространства. None — если не состоит ни в одном."""
    row = (
        db.query(ProjectWorkspace.id)
        .join(ProjectWorkspaceMember, ProjectWorkspaceMember.workspace_id == ProjectWorkspace.id)
        .filter(
            ProjectWorkspace.org_id == org_id,
            ProjectWorkspace.is_active.is_(True),
            ProjectWorkspaceMember.user_id == user_id,
        )
        .first()
    )
    return row[0] if row else None


def workspace_department_ids(db: Session, ws_id: int) -> set[int]:
    """Подразделения, по которым в пространстве есть движения (расходы/пополнения).
    Участник пространства выбирает подразделение из них (+ новые/пустые)."""
    ids: set[int] = set()
    for (d,) in db.query(Expense.department_id).filter(
        Expense.workspace_id == ws_id, Expense.department_id.isnot(None)).distinct():
        ids.add(d)
    for (d,) in db.query(BalanceTopUp.department_id).filter(
        BalanceTopUp.workspace_id == ws_id, BalanceTopUp.department_id.isnot(None)).distinct():
        ids.add(d)
    return ids


def workspace_details_hidden(db: Session, me: User) -> bool:
    """Нужно ли СКРЫВАТЬ от me детализацию пространств (категории/описания расходов).

    - superadmin / gen_director → False (видят всё);
    - если у организации включён флаг workspace_auditor_access → False (детализация открыта);
    - остальные (admin, auditor, accountable не-владелец) → True.
    Владелец своего пространства обрабатывается отдельно через visible_workspace_ids.
    """
    if can_manage_workspaces(me):
        return False
    org = db.get(Organization, me.org_id)
    flags = org.feature_flags if org else None
    if is_enabled(flags, WORKSPACE_AUDITOR_ACCESS_FLAG):
        return False
    return True


def visible_workspace_ids(db: Session, me: User) -> Optional[set[int]]:
    """Какие пространства me вправе видеть в ПОСТРОЧНОЙ детализации (список расходов).

    - None  → ограничения нет (видит все записи, в т.ч. любых пространств);
    - set   → видит записи вне пространств (workspace_id IS NULL) ПЛЮС записи из этих
              пространств. Пустой set = только записи вне пространств.
    """
    if not workspace_details_hidden(db, me):
        return None
    # Участник пространства (владелец ИЛИ подотчётный-участник) видит записи своего
    # пространства; остальные — только записи вне пространств.
    ws = member_active_workspace_id(db, me.id, me.org_id)
    return {ws} if ws else set()


def workspace_expense_clause(visible_ids: Optional[set[int]]):
    """SQLAlchemy-условие для Expense из visible_workspace_ids. None — фильтр не нужен."""
    if visible_ids is None:
        return None
    if visible_ids:
        return or_(Expense.workspace_id.is_(None), Expense.workspace_id.in_(visible_ids))
    return Expense.workspace_id.is_(None)


def masked_workspace_category_ids(db: Session, org_id: int) -> set[int]:
    """id категорий, принадлежащих пространствам — их имена в общих отчётах
    заменяются на «Проектное пространство», чтобы не светить приватные названия."""
    rows = (
        db.query(Category.id)
        .filter(Category.org_id == org_id, Category.workspace_id.isnot(None))
        .all()
    )
    return {cid for (cid,) in rows}
