"""Жёсткая привязка сотрудника к подразделению.

users.forced_department_id: NULL = прежнее поведение (подразделение выбирается
в форме). NOT NULL = все операции, оформленные НА этого сотрудника (а также
внесённые им от лица сотрудника без своей привязки), принудительно получают это
подразделение — выбор клиента игнорируется.

Аддитивная миграция: ADD COLUMN nullable + FK + индекс.
"""
from alembic import op
import sqlalchemy as sa

revision = "a7d2f4e8c130"
down_revision = "f1c6a8d3b70e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("forced_department_id", sa.Integer(), nullable=True))
    op.create_index("ix_users_forced_department_id", "users", ["forced_department_id"])
    op.create_foreign_key(
        "fk_users_forced_department_id", "users", "departments",
        ["forced_department_id"], ["id"], ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_forced_department_id", "users", type_="foreignkey")
    op.drop_index("ix_users_forced_department_id", table_name="users")
    op.drop_column("users", "forced_department_id")
