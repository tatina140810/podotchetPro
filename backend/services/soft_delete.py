"""Глобальный фильтр мягкого удаления.

Одно событие `do_orm_execute` на класс Session добавляет ко ВСЕМ ORM-SELECT
условие `deleted_at IS NULL` для любой модели, наследующей SoftDeleteMixin
(Expense, Income, MoneyTransfer, BalanceTopUp). Это закрывает разом все ~60
точек агрегации (balance.py, reports.py, dashboard.py, users.py, employees.py,
workspaces.py, admin.py, departments.py, income_sources.py, permissions.py и
все CRUD-списки), не полагаясь на ручной фильтр в каждом месте.

Почему именно так (проверено до внедрения):
- Все сессии идут через один SessionLocal → событие на классе Session покрывает
  и фоновые сессии (chat, push), и тестовую сессию.
- Alembic использует Core-connection (не ORM Session) → миграции хук не трогают.
- Событие ставится ТОЛЬКО на верхнеуровневые SELECT (is_column_load /
  is_relationship_load пропускаем — канонический рецепт SQLAlchemy), а
  propagate_to_loaders=True переносит критерий на lazy/joined-загрузку связей —
  так удалённые записи не «протекают» через отношения.
- Escape-hatch: execution_options(include_deleted=True) — по белому списку
  (восстановление, change-log, блокировки удаления справочников). Каждое
  использование помечается комментарием на месте вызова.
"""
from datetime import datetime

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from models import SoftDeleteMixin, User


@event.listens_for(Session, "do_orm_execute")
def _apply_soft_delete_filter(execute_state) -> None:
    if not execute_state.is_select:
        return
    # Загрузку отдельных колонок и отношений не трогаем — критерий переносится
    # на них через propagate_to_loaders у самого верхнеуровневого запроса.
    if execute_state.is_column_load or execute_state.is_relationship_load:
        return
    # Явный опт-аут (по белому списку).
    if execute_state.execution_options.get("include_deleted", False):
        return
    execute_state.statement = execute_state.statement.options(
        with_loader_criteria(
            SoftDeleteMixin,
            lambda cls: cls.deleted_at.is_(None),
            include_aliases=True,
            propagate_to_loaders=True,
        )
    )


def soft_delete(obj: SoftDeleteMixin, user: User) -> None:
    """Пометить запись удалённой. Не коммитит — вызывающий отвечает за транзакцию
    (удаление и все откаты балансов должны быть в ОДНОЙ транзакции)."""
    obj.deleted_at = datetime.utcnow()
    obj.deleted_by = user.id
