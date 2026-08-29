from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin, require_auditor
from database import get_db
from models import Category, Department, Expense, User
from schemas import CategoryCreate, CategoryOut, CategoryUpdate
from services.permissions import (
    auditor_department_ids,
    member_active_workspace_id,
    owner_isolation_ws_id,
)


router = APIRouter(prefix="/api/categories", tags=["categories"])


def _validate_department(db: Session, org_id: int, department_id: Optional[int]) -> None:
    """Подразделение (если указано) должно принадлежать той же организации."""
    if department_id is None:
        return
    dep = db.get(Department, department_id)
    if not dep or dep.org_id != org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Подразделение не найдено")


def _dept_names(db: Session, org_id: int) -> dict[int, str]:
    rows = db.query(Department.id, Department.name).filter(Department.org_id == org_id).all()
    return {i: n for i, n in rows}


def _to_out(
    c: Category,
    parents_by_id: dict[int, Category],
    dept_names: Optional[dict] = None,
) -> CategoryOut:
    out = CategoryOut.model_validate(c)
    if c.parent_id and c.parent_id in parents_by_id:
        p = parents_by_id[c.parent_id]
        out.parent_name = p.name
        out.display_name = f"{p.name} / {c.name}"
    else:
        out.display_name = c.name
    if c.department_id:
        out.department_name = (dept_names or {}).get(c.department_id)
    return out


def _validate_parent(
    db: Session,
    org_id: int,
    parent_id: Optional[int],
    self_id: Optional[int] = None,
) -> None:
    """Проверка parent: та же org, не сама себя, родитель не может быть подкатегорией (только 2 уровня)."""
    if parent_id is None:
        return
    if self_id is not None and parent_id == self_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Категория не может быть родителем самой себя")
    parent = db.get(Category, parent_id)
    if not parent or parent.org_id != org_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Родительская категория не найдена")
    if parent.parent_id is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Нельзя сделать подкатегорией категорию, которая уже является подкатегорией (только 2 уровня)",
        )
    # Если у текущей категории есть свои дети — она не может стать подкатегорией.
    if self_id is not None:
        has_children = db.query(Category.id).filter(Category.parent_id == self_id).first()
        if has_children:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "У категории есть подкатегории — её нельзя сделать подкатегорией",
            )


@router.get("", response_model=List[CategoryOut])
def list_categories(db: Session = Depends(get_db), me: User = Depends(get_current_user)):
    base = db.query(Category).filter(
        Category.org_id == me.org_id, Category.is_active.is_(True),
    )
    dept_scope = auditor_department_ids(db, me)
    if dept_scope is not None:
        # Ограниченный аудитор: видит только категории, по которым есть расходы его
        # подразделения (пустые категории скрыты) + их родителей (чтобы двухуровневое
        # дерево и имена родителей не «поехали»).
        cat_ids = {
            cid for (cid,) in db.query(Expense.category_id).filter(
                Expense.org_id == me.org_id,
                Expense.department_id.in_(dept_scope),
                Expense.category_id.isnot(None),
            ).distinct()
        }
        parent_ids = {
            pid for (pid,) in db.query(Category.parent_id).filter(
                Category.id.in_(cat_ids or {-1}),
                Category.parent_id.isnot(None),
            ).distinct()
        }
        allowed_ids = cat_ids | parent_ids
        cats = base.filter(Category.id.in_(allowed_ids or {-1})).order_by(Category.name).all()
        parents_by_id = {c.id: c for c in cats if c.parent_id is None}
        dept_names = _dept_names(db, me.org_id)
        return [_to_out(c, parents_by_id, dept_names) for c in cats]
    iso = owner_isolation_ws_id(db, me)
    if iso is not None:
        # Владелец пространства: категории СВОЕГО пространства (изоляция) + служебные
        # системные («Подотчёт»). Системная «Подотчёт» — не приватная категория расходов,
        # а маркер «оставить деньги на балансе подотчётного» (выдача с ней НЕ создаёт
        # авто-расход). Она нужна везде, иначе владелец пространства не может выдать
        # своему участнику «под отчёт», чтобы тот сам разнёс расходы.
        base = base.filter(or_(Category.workspace_id == iso, Category.is_system.is_(True)))
    else:
        # Остальные: общие категории организации + категории своего пространства
        # (если состоит участником — например подотчётный участник пространства).
        member_ws = member_active_workspace_id(db, me.id, me.org_id)
        ws_cond = [Category.workspace_id.is_(None)]
        if member_ws:
            ws_cond.append(Category.workspace_id == member_ws)
        base = base.filter(or_(*ws_cond))
    cats = base.order_by(Category.name).all()
    parents_by_id = {c.id: c for c in cats if c.parent_id is None}
    dept_names = _dept_names(db, me.org_id)
    return [_to_out(c, parents_by_id, dept_names) for c in cats]


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db), me: User = Depends(require_auditor)):
    _validate_parent(db, me.org_id, payload.parent_id)
    _validate_department(db, me.org_id, payload.department_id)
    # Владелец пространства создаёт категорию внутри своего пространства (изоляция).
    iso = owner_isolation_ws_id(db, me)
    c = Category(org_id=me.org_id, workspace_id=iso, **payload.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    parents_by_id = {}
    if c.parent_id:
        p = db.get(Category, c.parent_id)
        if p:
            parents_by_id[p.id] = p
    return _to_out(c, parents_by_id, _dept_names(db, me.org_id))


@router.patch("/{cat_id}", response_model=CategoryOut)
def update_category(cat_id: int, payload: CategoryUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    c = db.get(Category, cat_id)
    if not c or c.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Категория не найдена")
    data = payload.model_dump(exclude_unset=True)
    if "parent_id" in data:
        _validate_parent(db, admin.org_id, data["parent_id"], self_id=c.id)
    if "department_id" in data:
        _validate_department(db, admin.org_id, data["department_id"])
    for field, value in data.items():
        setattr(c, field, value)
    db.commit()
    db.refresh(c)
    parents_by_id = {}
    if c.parent_id:
        p = db.get(Category, c.parent_id)
        if p:
            parents_by_id[p.id] = p
    return _to_out(c, parents_by_id, _dept_names(db, admin.org_id))


@router.delete("/{cat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(cat_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    c = db.get(Category, cat_id)
    if not c or c.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Категория не найдена")
    if c.is_system:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Системную категорию нельзя удалить")
    c.is_active = False
    db.commit()
    return None
