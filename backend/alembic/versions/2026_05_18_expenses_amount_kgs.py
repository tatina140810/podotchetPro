"""expenses.amount_kgs (КГС-эквивалент на момент создания, симметрично incomes)

Revision ID: f17a4e6b8290
Revises: a8c531e0d472
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa


revision = "f17a4e6b8290"
down_revision = "a8c531e0d472"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("expenses") as b:
        b.add_column(sa.Column("amount_kgs", sa.Numeric(precision=14, scale=2), nullable=True))
    # Бэкфилл: KGS-расходы → amount_kgs = amount.
    # USD/RUB остаются с NULL (курс на момент создания неизвестен) — в баланс не входят.
    # Их можно пересоздать вручную после установки курса.
    op.execute("UPDATE expenses SET amount_kgs = amount WHERE currency = 'KGS'")


def downgrade() -> None:
    with op.batch_alter_table("expenses") as b:
        b.drop_column("amount_kgs")
