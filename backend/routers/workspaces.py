"""Проектные пространства — изолированный учёт подотчётных средств отдельного
сотрудника со своими приватными категориями.

Доступ:
  - создание/редактирование/удаление, список всех пространств → superadmin, gen_director
    (auth.require_workspace_manager);
  - детали/участники/расходы/категории конкретного пространства → менеджер ИЛИ владелец;
  - финансовый агрегат (summary) → дополнительно admin/auditor (но без детализации).

Все изменяющие действия пишутся в WorkspaceAuditLog (несокращаемый журнал) —
аудируемость сохраняется даже при скрытой от ролей детализации расходов.
"""
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import (
    can_manage_workspaces,
    can_view_workspace_aggregate,
    get_current_user,
    require_workspace_manager,
)
from database import get_db
from models import (
    Advance,
    BalanceTopUp,
    Category,
    Expense,
    ProjectWorkspace,
    ProjectWorkspaceMember,
    User,
    WorkspaceAuditLog,
)
from schemas import (
    CategoryOut,
    ExpenseOut,
    WorkspaceCategoryCreate,
    WorkspaceCategoryReportRow,
    WorkspaceCreate,
    WorkspaceMemberBalance,
    WorkspaceMemberCreate,
    WorkspaceMemberOut,
    WorkspaceOut,
    WorkspaceSummary,
    WorkspaceUpdate,
)
from services.permissions import owned_active_workspace_id


router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


# ---------- вспомогательные ----------

def _audit(db: Session, me: User, ws: ProjectWorkspace, action: str, detail: Optional[dict] = None) -> None:
    db.add(WorkspaceAuditLog(
        org_id=me.org_id,
        workspace_id=ws.id,
        actor_id=me.id,
        action=action,
        detail=detail,
    ))


def _member_ids(db: Session, ws_id: int) -> set[int]:
    rows = db.query(ProjectWorkspaceMember.user_id).filter(
        ProjectWorkspaceMember.workspace_id == ws_id,
    ).all()
    return {uid for (uid,) in rows}


def _aggregate(db: Session, ws: ProjectWorkspace) -> tuple[Decimal, Decimal, Decimal]:
    """Финансовый агрегат пространства (KGS): получено / потрачено / остаток.

    Получено = внешнее финансирование пространства:
      выдачи (Advance) + пополнения (BalanceTopUp), привязанные к пространству,
      ИСКЛЮЧАЯ внутренние переводы между участниками (когда отправитель — сам участник).
    Потрачено = утверждённые конечные расходы (expense_type='expense') пространства.
    """
    members = _member_ids(db, ws.id)

    adv = db.query(func.coalesce(func.sum(Advance.amount), 0)).filter(
        Advance.org_id == ws.org_id, Advance.workspace_id == ws.id,
    )
    if members:  # внешние выдачи: тот, кто выдал, — не участник пространства
        adv = adv.filter(Advance.issued_by_id.notin_(members))
    received_adv = adv.scalar() or 0

    top = db.query(func.coalesce(func.sum(BalanceTopUp.amount), 0)).filter(
        BalanceTopUp.org_id == ws.org_id, BalanceTopUp.workspace_id == ws.id,
    )
    if members:  # внешние пополнения: отправитель (admin_id) — не участник
        top = top.filter(BalanceTopUp.admin_id.notin_(members))
    received_top = top.scalar() or 0

    spent = db.query(func.coalesce(func.sum(Expense.amount), 0)).filter(
        Expense.org_id == ws.org_id,
        Expense.workspace_id == ws.id,
        Expense.status == "approved",
        Expense.expense_type == "expense",
    ).scalar() or 0

    received = Decimal(str(received_adv)) + Decimal(str(received_top))
    spent = Decimal(str(spent))
    return received, spent, received - spent


def _members_count(db: Session, ws_id: int) -> int:
    return db.query(func.count(ProjectWorkspaceMember.id)).filter(
        ProjectWorkspaceMember.workspace_id == ws_id,
    ).scalar() or 0


def _to_out(db: Session, ws: ProjectWorkspace) -> WorkspaceOut:
    received, spent, balance = _aggregate(db, ws)
    out = WorkspaceOut.model_validate(ws)
    out.members_count = _members_count(db, ws.id)
    out.total_received = received
    out.total_spent = spent
    out.balance = balance
    return out


def _load_ws(db: Session, me: User, ws_id: int, allow_owner: bool = True) -> ProjectWorkspace:
    ws = db.get(ProjectWorkspace, ws_id)
    if not ws or ws.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пространство не найдено")
    if can_manage_workspaces(me):
        return ws
    if allow_owner and ws.owner_id == me.id:
        return ws
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к пространству")


# ---------- CRUD пространств ----------

@router.get("", response_model=List[WorkspaceOut])
def list_workspaces(db: Session = Depends(get_db), me: User = Depends(require_workspace_manager)):
    rows = (
        db.query(ProjectWorkspace)
        .filter(ProjectWorkspace.org_id == me.org_id)
        .order_by(ProjectWorkspace.is_active.desc(), ProjectWorkspace.name)
        .all()
    )
    return [_to_out(db, ws) for ws in rows]


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(
    payload: WorkspaceCreate,
    db: Session = Depends(get_db),
    me: User = Depends(require_workspace_manager),
):
    owner = db.get(User, payload.owner_id)
    if not owner or owner.org_id != me.org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Владелец не найден в организации")
    # Один пользователь — максимум одно активное пространство.
    if owned_active_workspace_id(db, owner.id, me.org_id) is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "У этого сотрудника уже есть активное пространство",
        )
    ws = ProjectWorkspace(
        org_id=me.org_id,
        name=payload.name,
        description=payload.description,
        owner_id=owner.id,
        created_by=me.id,
        is_active=True,
    )
    db.add(ws)
    db.flush()  # нужен ws.id
    # Владелец автоматически — участник своего пространства.
    db.add(ProjectWorkspaceMember(workspace_id=ws.id, user_id=owner.id, added_by=me.id))
    _audit(db, me, ws, "workspace_created", {"name": ws.name, "owner_id": owner.id})
    db.commit()
    db.refresh(ws)
    return _to_out(db, ws)


@router.get("/{ws_id}", response_model=WorkspaceOut)
def get_workspace(ws_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    ws = _load_ws(db, me, ws_id)
    return _to_out(db, ws)


@router.get("/{ws_id}/summary", response_model=WorkspaceSummary)
def workspace_summary(ws_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    """Финансовый агрегат пространства. Доступен менеджеру, владельцу и admin/auditor."""
    ws = db.get(ProjectWorkspace, ws_id)
    if not ws or ws.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пространство не найдено")
    allowed = (
        can_manage_workspaces(me)
        or ws.owner_id == me.id
        or can_view_workspace_aggregate(me)
    )
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа")
    received, spent, balance = _aggregate(db, ws)
    return WorkspaceSummary(
        owner=ws.owner, total_received=received, total_spent=spent, balance=balance,
    )


@router.patch("/{ws_id}", response_model=WorkspaceOut)
def update_workspace(
    ws_id: int,
    payload: WorkspaceUpdate,
    db: Session = Depends(get_db),
    me: User = Depends(require_workspace_manager),
):
    ws = db.get(ProjectWorkspace, ws_id)
    if not ws or ws.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пространство не найдено")
    data = payload.model_dump(exclude_unset=True)
    # Нельзя реактивировать, если у владельца уже есть другое активное пространство.
    if data.get("is_active") is True and not ws.is_active:
        other = owned_active_workspace_id(db, ws.owner_id, me.org_id)
        if other is not None and other != ws.id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "У владельца уже есть другое активное пространство",
            )
    for field, value in data.items():
        setattr(ws, field, value)
    _audit(db, me, ws, "workspace_updated", data)
    db.commit()
    db.refresh(ws)
    return _to_out(db, ws)


@router.delete("/{ws_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_workspace(
    ws_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(require_workspace_manager),
):
    """Деактивация (soft): is_active=False. Записи и журнал сохраняются."""
    ws = db.get(ProjectWorkspace, ws_id)
    if not ws or ws.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пространство не найдено")
    ws.is_active = False
    _audit(db, me, ws, "workspace_deactivated", None)
    db.commit()
    return None


# ---------- участники ----------

def _member_out(m: ProjectWorkspaceMember) -> WorkspaceMemberOut:
    return WorkspaceMemberOut.model_validate(m)


@router.get("/{ws_id}/members", response_model=List[WorkspaceMemberOut])
def list_members(ws_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    ws = _load_ws(db, me, ws_id)
    rows = (
        db.query(ProjectWorkspaceMember)
        .filter(ProjectWorkspaceMember.workspace_id == ws.id)
        .order_by(ProjectWorkspaceMember.added_at)
        .all()
    )
    return [_member_out(m) for m in rows]


@router.post("/{ws_id}/members", response_model=WorkspaceMemberOut, status_code=status.HTTP_201_CREATED)
def add_member(
    ws_id: int,
    payload: WorkspaceMemberCreate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    ws = _load_ws(db, me, ws_id)  # менеджер или владелец
    user = db.get(User, payload.user_id)
    if not user or user.org_id != me.org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Сотрудник не найден")
    exists = (
        db.query(ProjectWorkspaceMember.id)
        .filter(
            ProjectWorkspaceMember.workspace_id == ws.id,
            ProjectWorkspaceMember.user_id == user.id,
        )
        .first()
    )
    if exists:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Уже участник пространства")
    m = ProjectWorkspaceMember(workspace_id=ws.id, user_id=user.id, added_by=me.id)
    db.add(m)
    _audit(db, me, ws, "member_added", {"user_id": user.id})
    db.commit()
    db.refresh(m)
    return _member_out(m)


@router.delete("/{ws_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    ws_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    ws = _load_ws(db, me, ws_id)
    if user_id == ws.owner_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя удалить владельца пространства")
    m = (
        db.query(ProjectWorkspaceMember)
        .filter(
            ProjectWorkspaceMember.workspace_id == ws.id,
            ProjectWorkspaceMember.user_id == user_id,
        )
        .first()
    )
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Участник не найден")
    db.delete(m)
    _audit(db, me, ws, "member_removed", {"user_id": user_id})
    db.commit()
    return None


# ---------- балансы участников (как «по сотрудникам», но внутри пространства) ----------

@router.get("/{ws_id}/members/balances", response_model=List[WorkspaceMemberBalance])
def member_balances(ws_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    """Агрегат по каждому участнику пространства: получено (извне/внутри),
    потрачено, передано дальше, остаток. Доступ — менеджер или владелец."""
    ws = _load_ws(db, me, ws_id)
    members = _member_ids(db, ws.id)  # всегда непусто (владелец — участник)
    rows: list[WorkspaceMemberBalance] = []
    for uid in sorted(members):
        u = db.get(User, uid)
        if not u:
            continue
        # пополнения, полученные участником (извне = отправитель не участник)
        top_ext = db.query(func.coalesce(func.sum(BalanceTopUp.amount), 0)).filter(
            BalanceTopUp.workspace_id == ws.id, BalanceTopUp.user_id == uid,
            BalanceTopUp.admin_id.notin_(members),
        ).scalar() or 0
        top_int = db.query(func.coalesce(func.sum(BalanceTopUp.amount), 0)).filter(
            BalanceTopUp.workspace_id == ws.id, BalanceTopUp.user_id == uid,
            BalanceTopUp.admin_id.in_(members),
        ).scalar() or 0
        # выдачи, полученные участником
        adv_ext = db.query(func.coalesce(func.sum(Advance.amount), 0)).filter(
            Advance.workspace_id == ws.id, Advance.employee_id == uid,
            Advance.issued_by_id.notin_(members),
        ).scalar() or 0
        adv_int = db.query(func.coalesce(func.sum(Advance.amount), 0)).filter(
            Advance.workspace_id == ws.id, Advance.employee_id == uid,
            Advance.issued_by_id.in_(members),
        ).scalar() or 0
        spent = db.query(func.coalesce(func.sum(Expense.amount), 0)).filter(
            Expense.workspace_id == ws.id, Expense.employee_id == uid,
            Expense.status == "approved", Expense.expense_type == "expense",
        ).scalar() or 0
        # передал дальше другим участникам
        out_top = db.query(func.coalesce(func.sum(BalanceTopUp.amount), 0)).filter(
            BalanceTopUp.workspace_id == ws.id, BalanceTopUp.admin_id == uid,
        ).scalar() or 0
        out_adv = db.query(func.coalesce(func.sum(Advance.amount), 0)).filter(
            Advance.workspace_id == ws.id, Advance.issued_by_id == uid,
        ).scalar() or 0
        rec_ext = Decimal(str(top_ext)) + Decimal(str(adv_ext))
        rec_int = Decimal(str(top_int)) + Decimal(str(adv_int))
        transferred = Decimal(str(out_top)) + Decimal(str(out_adv))
        spent_d = Decimal(str(spent))
        rows.append(WorkspaceMemberBalance(
            user_id=uid, name=u.name,
            received_external=rec_ext, received_internal=rec_int,
            spent=spent_d, transferred_out=transferred,
            balance=rec_ext + rec_int - spent_d - transferred,
        ))
    return rows


@router.get("/{ws_id}/reports/by-category", response_model=List[WorkspaceCategoryReportRow])
def report_by_category(ws_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    """Отчёт по категориям внутри пространства (утверждённые расходы)."""
    ws = _load_ws(db, me, ws_id)
    rows = (
        db.query(
            Expense.category_id,
            func.count(Expense.id),
            func.coalesce(func.sum(Expense.amount), 0),
        )
        .filter(
            Expense.workspace_id == ws.id,
            Expense.status == "approved",
            Expense.expense_type == "expense",
        )
        .group_by(Expense.category_id)
        .all()
    )
    cat_names = {c.id: c.name for c in db.query(Category).filter(Category.org_id == me.org_id).all()}
    total = sum((Decimal(str(s or 0)) for _, _, s in rows), Decimal(0))
    out: list[WorkspaceCategoryReportRow] = []
    for cid, cnt, s in rows:
        amount = Decimal(str(s or 0))
        out.append(WorkspaceCategoryReportRow(
            category_id=cid,
            category=cat_names.get(cid, "Без категории") if cid else "Без категории",
            amount=amount,
            count=int(cnt or 0),
            percent=round(float(amount / total * 100), 1) if total > 0 else 0.0,
        ))
    out.sort(key=lambda r: r.amount, reverse=True)
    return out


# ---------- расходы пространства (детализация) ----------

@router.get("/{ws_id}/expenses", response_model=List[ExpenseOut])
def list_workspace_expenses(ws_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    """Полная построчная детализация расходов пространства. Доступ — менеджер или
    владелец (admin/auditor сюда НЕ имеют доступа без флага — они видят лишь summary)."""
    ws = _load_ws(db, me, ws_id)
    rows = (
        db.query(Expense)
        .filter(Expense.org_id == me.org_id, Expense.workspace_id == ws.id)
        .order_by(Expense.spent_at.desc())
        .limit(1000)
        .all()
    )
    out = []
    for e in rows:
        o = ExpenseOut.model_validate(e)
        o.employee_name = e.employee.name if e.employee else None
        o.category_name = e.category.name if e.category else None
        o.department_name = e.department.name if e.department else None
        out.append(o)
    return out


# ---------- приватные категории пространства ----------

@router.get("/{ws_id}/categories", response_model=List[CategoryOut])
def list_workspace_categories(ws_id: int, db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    ws = _load_ws(db, me, ws_id)
    cats = (
        db.query(Category)
        .filter(
            Category.org_id == me.org_id,
            Category.workspace_id == ws.id,
            Category.is_active.is_(True),
        )
        .order_by(Category.name)
        .all()
    )
    out = []
    for c in cats:
        o = CategoryOut.model_validate(c)
        o.display_name = c.name
        out.append(o)
    return out


@router.post("/{ws_id}/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_workspace_category(
    ws_id: int,
    payload: WorkspaceCategoryCreate,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    ws = _load_ws(db, me, ws_id)
    if payload.parent_id is not None:
        parent = db.get(Category, payload.parent_id)
        if not parent or parent.org_id != me.org_id or parent.workspace_id != ws.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Родительская категория не найдена в пространстве")
    c = Category(
        org_id=me.org_id,
        workspace_id=ws.id,
        name=payload.name,
        icon=payload.icon,
        color=payload.color,
        is_operational=payload.is_operational,
        parent_id=payload.parent_id,
    )
    db.add(c)
    _audit(db, me, ws, "category_created", {"name": payload.name})
    db.commit()
    db.refresh(c)
    o = CategoryOut.model_validate(c)
    o.display_name = c.name
    return o
