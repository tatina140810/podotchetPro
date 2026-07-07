"""expenses.source_topup_id — связь авто-расхода с исходной выдачей.

Аддитивная миграция: ADD COLUMN source_topup_id (nullable) + индекс + FK (SET NULL).
Нужна, чтобы при редактировании/удалении выдачи синхронизировать привязанный авто-расход
(_sync_topup_expense в routers/transfers). Ничего существующего не ломает.

Бэкфилл: связываем уже существующие авто-расходы с их выдачами по тем же атрибутам,
по которым шла защита от дублей при создании (получатель=employee, та же категория,
сумма, валюта, дата). Один топап ↔ один авто-расход.

Revision ID: d8e2f1a9c3b5
Revises: c7d1e9f3a204
Create Date: 2026-06-24
"""
from alembic import op
import sqlalchemy as sa


revision = "d8e2f1a9c3b5"
down_revision = "c7d1e9f3a204"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "expenses",
        sa.Column("source_topup_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_expenses_source_topup_id",
        "expenses",
        ["source_topup_id"],
    )
    op.create_foreign_key(
        "fk_expenses_source_topup_id",
        "expenses",
        "balance_topups",
        ["source_topup_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Бэкфилл связей для исторических авто-расходов (только Postgres-синтаксис UPDATE..FROM).
    op.execute(
        """
        UPDATE expenses AS e
        SET source_topup_id = t.id
        FROM balance_topups AS t
        WHERE e.source_topup_id IS NULL
          AND e.expense_type = 'expense'
          AND e.category_id IS NOT NULL
          AND e.org_id = t.org_id
          AND e.employee_id = t.user_id
          AND e.category_id = t.category_id
          AND e.amount = t.amount
          AND e.currency = t.currency
          AND date_trunc('day', e.spent_at) = date_trunc('day', t.date)
        """
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_expenses_source_topup_id",
        "expenses",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_expenses_source_topup_id",
        table_name="expenses",
    )
    op.drop_column("expenses", "source_topup_id")
