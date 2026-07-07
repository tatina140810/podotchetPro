"""expense auto_income (чекбокс «Учесть как приход») + incomes.department_id

- expenses.auto_income (bool) — расход оплачен из личных средств без подотчёта,
  система создаёт парный технический приход на ту же сумму.
- expenses.auto_income_income_id — ссылка на созданный приход (для синхронизации/удаления).
- incomes.department_id — чтобы технический приход попадал в агрегат подразделения
  («приход» в отчёте по подразделениям) и баланс подразделения не уходил в минус.

Всё аддитивно/nullable.

Revision ID: c3e5a7b9d1f2
Revises: b2d4f6a8c0e1
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa


revision = "c3e5a7b9d1f2"
down_revision = "b2d4f6a8c0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "incomes",
        sa.Column(
            "department_id",
            sa.Integer(),
            sa.ForeignKey("departments.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_incomes_department_id", "incomes", ["department_id"])
    op.add_column(
        "expenses",
        sa.Column("auto_income", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "expenses",
        sa.Column(
            "auto_income_income_id",
            sa.Integer(),
            sa.ForeignKey("incomes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("expenses", "auto_income_income_id")
    op.drop_column("expenses", "auto_income")
    op.drop_index("ix_incomes_department_id", table_name="incomes")
    op.drop_column("incomes", "department_id")
