"""users.can_bulk_import — доступ сотрудника к «Импорту истории»

Аддитивно: ADD COLUMN BOOL NOT NULL DEFAULT false. Ставит только superadmin.
Сотрудник с флагом импортирует ТОЛЬКО свои расходы (тип expense, employee = он сам);
приходы и выдачи ему запрещены — иначе он мог бы нарисовать себе поступление денег.
Статус импортированных расходов — approved (решение Тати 2026-09-10), как у админского
импорта: это перенос уже состоявшейся истории, а не новая заявка на проверку.

Revision ID: e5b1c7d9a2f4
Revises: a3f7c9e1d2b4
Create Date: 2026-09-10
"""
from alembic import op
import sqlalchemy as sa


revision = "e5b1c7d9a2f4"
down_revision = "a3f7c9e1d2b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("can_bulk_import", sa.Boolean(), nullable=False,
                  server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("users", "can_bulk_import")
