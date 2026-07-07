"""Подразделения (Departments) — уровень иерархии над сотрудниками и категориями.

Права:
  - GET  — любой авторизованный. accountable видит только свои подразделения;
           admin/gen_director/auditor — все подразделения org.
  - POST/DELETE — только admin/auditor (require_auditor).
  - Удаление запрещено, если к подразделению привязаны расходы, пополнения,
    заявки или категории (членство сотрудников удаляется каскадно).
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import can_manage_workspaces, get_current_user, is_director_or_auditor, require_auditor
from database import get_db
from models import (
    BalanceTopUp,
    Category,
    Department,
    EmployeeDepartment,
    Expense,
    MoneyRequest,
    User,
)
from schemas import DepartmentCreate, DepartmentOut
from services.permissions import member_active_workspace_id


router = APIRouter(prefix="/api/departments", tags=["departments"])


def _dept_ids_movements(db: Session, org_id: int, *, workspace_id, common: bool) -> set[int]:
    """id подразделений, по которым есть движения (расход/пополнение) в заданном
    срезе: common=True → общее пространство (workspace_id IS NULL);
    иначе — конкретное пространство workspace_id."""
    eq = db.query(Expense.department_id).filter(
        Expense.org_id == org_id, Expense.department_id.isnot(None)
    )
    tq = db.query(BalanceTopUp.department_id).filter(
        BalanceTopUp.org_id == org_id, BalanceTopUp.department_id.isnot(None)
    )
    if common:
        eq = eq.filter(Expense.workspace_id.is_(None))
        tq = tq.filter(BalanceTopUp.workspace_id.is_(None))
    else:
        eq = eq.filter(Expense.workspace_id == workspace_id)
        tq = tq.filter(BalanceTopUp.workspace_id == workspace_id)
    return ({d for (d,) in eq.distinct()} | {d for (d,) in tq.distinct()})


def _dept_ids_any(db: Session, org_id: int) -> set[int]:
    """id подразделений, по которым есть ХОТЬ КАКИЕ-ТО движения (любой срез)."""
    eq = {d for (d,) in db.query(Expense.department_id).filter(
        Expense.org_id == org_id, Expense.department_id.isnot(None)).distinct()}
    tq = {d for (d,) in db.query(BalanceTopUp.department_id).filter(
        BalanceTopUp.org_id == org_id, BalanceTopUp.department_id.isnot(None)).distinct()}
    return eq | tq


def _scoped_department_ids(db: Session, org_id: int, *, workspace_id, common: bool) -> set[int]:
    """Подразделения, видимые в срезе: с движениями в этом срезе + совсем новые
    (без движений нигде — чтобы их можно было использовать/заводить).
    Подразделения с движениями ТОЛЬКО в чужом срезе скрываются."""
    in_scope = _dept_ids_movements(db, org_id, workspace_id=workspace_id, common=common)
    all_dep = {d.id for d in db.query(Department.id).filter(Department.org_id == org_id)}
    neutral = all_dep - _dept_ids_any(db, org_id)  # нигде не используются
    return in_scope | neutral


def my_department_ids(db: Session, user: User) -> set[int]:
    """id подразделений, к которым привязан сотрудник (через M2M)."""
    rows = (
        db.query(EmployeeDepartment.department_id)
        .filter(EmployeeDepartment.employee_id == user.id)
        .all()
    )
    return {r[0] for r in rows}


def _counts(db: Session, org_id: int) -> tuple[dict[int, int], dict[int, int]]:
    """Возвращает (employee_count_by_dept, category_count_by_dept) для org."""
    emp_rows = (
        db.query(EmployeeDepartment.department_id, func.count(EmployeeDepartment.id))
        .join(Department, Department.id == EmployeeDepartment.department_id)
        .filter(Department.org_id == org_id)
        .group_by(EmployeeDepartment.department_id)
        .all()
    )
    cat_rows = (
        db.query(Category.department_id, func.count(Category.id))
        .filter(
            Category.org_id == org_id,
            Category.department_id.isnot(None),
            Category.is_active.is_(True),
        )
        .group_by(Category.department_id)
        .all()
    )
    return {d: c for d, c in emp_rows}, {d: c for d, c in cat_rows}


def _to_out(d: Department, emp_counts: dict, cat_counts: dict) -> DepartmentOut:
    out = DepartmentOut.model_validate(d)
    out.employee_count = emp_counts.get(d.id, 0)
    out.category_count = cat_counts.get(d.id, 0)
    return out


@router.get("", response_model=List[DepartmentOut])
def list_departments(
    all: bool = False,
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    """all=true — вернуть ВСЕ подразделения org (для выпадающего списка при создании
    операции/заявки): подотчётному нужно выбрать любое подразделение, даже если он к
    нему не привязан. По умолчанию accountable видит только свои подразделения."""
    q = db.query(Department).filter(Department.org_id == me.org_id)
    member_ws = member_active_workspace_id(db, me.id, me.org_id)
    if member_ws is not None:
        # Участник пространства (владелец ИЛИ подотчётный): подразделения, где есть
        # движения его пространства (+ совсем новые/пустые). Чужие — скрыты.
        ids = _scoped_department_ids(db, me.org_id, workspace_id=member_ws, common=False)
        q = q.filter(Department.id.in_(ids or {-1}))
    elif can_manage_workspaces(me):
        pass  # superadmin / gen_director — видят все подразделения (оверсайт)
    elif is_director_or_auditor(me):
        # Общий admin/auditor: только подразделения общего пространства (с движениями
        # вне пространств) + новые. Подразделения, используемые только в пространствах
        # (напр. «Объект Байгелди»), скрыты.
        ids = _scoped_department_ids(db, me.org_id, workspace_id=None, common=True)
        q = q.filter(Department.id.in_(ids or {-1}))
    elif not all:
        # accountable видит только свои подразделения
        ids = my_department_ids(db, me)
        if not ids:
            return []
        q = q.filter(Department.id.in_(ids))
    depts = q.order_by(Department.name).all()
    emp_counts, cat_counts = _counts(db, me.org_id)
    return [_to_out(d, emp_counts, cat_counts) for d in depts]


@router.post("", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    me: User = Depends(require_auditor),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Название не может быть пустым")
    exists = (
        db.query(Department.id)
        .filter(Department.org_id == me.org_id, Department.name == name)
        .first()
    )
    if exists:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Подразделение с таким названием уже есть")
    d = Department(org_id=me.org_id, name=name)
    db.add(d)
    db.commit()
    db.refresh(d)
    return _to_out(d, {}, {})


@router.delete("/{dept_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    dept_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(require_auditor),
):
    d = db.get(Department, dept_id)
    if not d or d.org_id != me.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Подразделение не найдено")

    # Проверяем привязки, блокирующие удаление.
    blockers: list[str] = []
    if db.query(Expense.id).filter(Expense.department_id == dept_id).first():
        blockers.append("расходы")
    if db.query(BalanceTopUp.id).filter(BalanceTopUp.department_id == dept_id).first():
        blockers.append("пополнения")
    if db.query(MoneyRequest.id).filter(MoneyRequest.department_id == dept_id).first():
        blockers.append("заявки")
    if db.query(Category.id).filter(Category.department_id == dept_id).first():
        blockers.append("категории")

    if blockers:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Нельзя удалить: к подразделению привязаны " + ", ".join(blockers)
            + ". Сначала перенесите или удалите их.",
        )

    db.delete(d)  # членство сотрудников (employee_departments) удалится каскадно
    db.commit()
    return None
