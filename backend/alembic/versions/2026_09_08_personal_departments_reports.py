"""Личные подразделения сотрудника + доступ к своим отчётам

Аддитивно (безопасно для прода):
- departments.owner_id INTEGER NULL FK users(id) ON DELETE RESTRICT + индекс.
  NULL = обычное общее подразделение (всё, что есть сейчас, — такое).
  NOT NULL = личное подразделение сотрудника: видно только владельцу и
  директорам/суперадмину (оверсайт). Другие сотрудники его не видят и не могут
  выбрать в формах.
- users.can_view_own_reports BOOL NOT NULL DEFAULT false — открывает сотруднику
  отчёты «по категориям» и «по подразделениям», построенные ТОЛЬКО по его расходам.
- users.can_create_departments BOOL NOT NULL DEFAULT false — разрешает заводить
  свои (личные) подразделения.

RESTRICT у owner_id: пользователей физически не удаляем (delete_user — soft,
is_active=False), поэтому каскад не нужен, а случайное физическое удаление
владельца не должно утащить подразделение с его историей расходов.

Revision ID: a3f7c9e1d2b4
Revises: c4e8a2d7f1b3
Create Date: 2026-09-08
"""
from alembic import op
import sqlalchemy as sa


revision = "a3f7c9e1d2b4"
down_revision = "c4e8a2d7f1b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("departments", sa.Column("owner_id", sa.Integer(), nullable=True))
    op.create_index("ix_departments_owner_id", "departments", ["owner_id"])
    op.create_foreign_key(
        "fk_departments_owner_id_users", "departments", "users",
        ["owner_id"], ["id"], ondelete="RESTRICT",
    )
    op.add_column(
        "users",
        sa.Column("can_view_own_reports", sa.Boolean(), nullable=False,
                  server_default=sa.text("false")),
    )
    op.add_column(
        "users",
        sa.Column("can_create_departments", sa.Boolean(), nullable=False,
                  server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("users", "can_create_departments")
    op.drop_column("users", "can_view_own_reports")
    op.drop_constraint("fk_departments_owner_id_users", "departments", type_="foreignkey")
    op.drop_index("ix_departments_owner_id", table_name="departments")
    op.drop_column("departments", "owner_id")
