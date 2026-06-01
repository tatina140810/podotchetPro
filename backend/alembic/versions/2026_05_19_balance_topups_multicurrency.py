"""balance_topups.currency + amount_kgs (multi-currency для выдач)

Revision ID: c8e72f1b4093
Revises: f9a3c6e07d52
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa


revision = "c8e72f1b4093"
down_revision = "f9a3c6e07d52"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Добавляем nullable, чтобы старые строки не упали на NOT NULL.
    with op.batch_alter_table("balance_topups") as b:
        b.add_column(sa.Column("currency", sa.String(length=8), nullable=True))
        b.add_column(sa.Column("amount_kgs", sa.Numeric(precision=14, scale=2), nullable=True))

    # 2) Бэкфилл: старые выдачи были KGS-only — currency='KGS', amount_kgs=amount.
    op.execute("UPDATE balance_topups SET currency = 'KGS' WHERE currency IS NULL")
    op.execute("UPDATE balance_topups SET amount_kgs = amount WHERE amount_kgs IS NULL")

    # 3) currency делаем NOT NULL + server_default. amount_kgs оставляем nullable
    #    (для USD/RUB записей, созданных в момент когда курс не задан — но это блокируется в роутере).
    with op.batch_alter_table("balance_topups") as b:
        b.alter_column("currency", nullable=False, server_default="KGS")


def downgrade() -> None:
    with op.batch_alter_table("balance_topups") as b:
        b.drop_column("amount_kgs")
        b.drop_column("currency")
