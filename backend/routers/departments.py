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

from auth import get_current_user, is_director_or_auditor, require_auditor
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


router = APIRouter(prefix="/api/departments", tags=["departments"])


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
def list_departments(db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    q = db.query(Department).filter(Department.org_id == me.org_id)
    if not is_director_or_auditor(me):
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
