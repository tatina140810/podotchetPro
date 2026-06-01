from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin
from database import get_db
from models import Category, User
from schemas import CategoryCreate, CategoryOut, CategoryUpdate


router = APIRouter(prefix="/api/categories", tags=["categories"])


def _to_out(c: Category, parents_by_id: dict[int, Category]) -> CategoryOut:
    out = CategoryOut.model_validate(c)
    if c.parent_id and c.parent_id in parents_by_id:
        p = parents_by_id[c.parent_id]
        out.parent_name = p.name
        out.display_name = f"{p.name} / {c.name}"
    else:
        out.display_name = c.name
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
    cats = (
        db.query(Category)
        .filter(Category.org_id == me.org_id, Category.is_active.is_(True))
        .order_by(Category.name)
        .all()
    )
    parents_by_id = {c.id: c for c in cats if c.parent_id is None}
    return [_to_out(c, parents_by_id) for c in cats]


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    _validate_parent(db, admin.org_id, payload.parent_id)
    c = Category(org_id=admin.org_id, **payload.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    parents_by_id = {}
    if c.parent_id:
        p = db.get(Category, c.parent_id)
        if p:
            parents_by_id[p.id] = p
    return _to_out(c, parents_by_id)


@router.patch("/{cat_id}", response_model=CategoryOut)
def update_category(cat_id: int, payload: CategoryUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    c = db.get(Category, cat_id)
    if not c or c.org_id != admin.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Категория не найдена")
    data = payload.model_dump(exclude_unset=True)
    if "parent_id" in data:
        _validate_parent(db, admin.org_id, data["parent_id"], self_id=c.id)
    for field, value in data.items():
        setattr(c, field, value)
    db.commit()
    db.refresh(c)
    parents_by_id = {}
    if c.parent_id:
        p = db.get(Category, c.parent_id)
        if p:
            parents_by_id[p.id] = p
    return _to_out(c, parents_by_id)


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
