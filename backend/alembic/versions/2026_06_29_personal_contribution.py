"""expenses.is_personal_contribution — «расход из личных средств в счёт подразделения»

Флаг НЕ создаёт отдельный приход. Он означает: сотрудник оплатил расход из личных
средств без подотчёта. В агрегате подразделения такой расход засчитывается
ОДНОВРЕМЕННО как приход и как расход (баланс подразделения не уходит в минус,
личный баланс сотрудника не меняется, приход не задваивается).

Revision ID: d4f6b8c0e2a3
Revises: c3e5a7b9d1f2
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa


revision = "d4f6b8c0e2a3"
down_revision = "c3e5a7b9d1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "expenses",
        sa.Column("is_personal_contribution", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("expenses", "is_personal_contribution")
