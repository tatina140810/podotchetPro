"""incomes.amount_kgs (KGS-эквивалент на момент создания)

Revision ID: a8c531e0d472
Revises: e6f2a8b15c39
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa


revision = "a8c531e0d472"
down_revision = "e6f2a8b15c39"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("incomes") as b:
        b.add_column(sa.Column("amount_kgs", sa.Numeric(precision=14, scale=2), nullable=True))
    # Бэкфилл для существующих KGS-записей: amount_kgs = amount.
    # USD/RUB записи (если есть) остаются с NULL — их курс на момент создания неизвестен,
    # в баланс они не пойдут. Можно пересоздать вручную через UI после установки курса.
    op.execute("UPDATE incomes SET amount_kgs = amount WHERE currency = 'KGS'")


def downgrade() -> None:
    with op.batch_alter_table("incomes") as b:
        b.drop_column("amount_kgs")
