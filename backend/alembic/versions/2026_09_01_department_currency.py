"""departments.currency — валюта подразделения (NULL = сомы)

Аддитивно: ADD COLUMN currency VARCHAR(8) NULL + CHECK (KGS/USD/EUR/RUB).
Кейс: «Мос офис» ведётся в рублях — профиль/итоги в ₽, расходы по умолчанию RUB.

Revision ID: c4e8a2d7f1b3
Revises: b7d3f1a9c2e4
Create Date: 2026-09-01
"""
from alembic import op
import sqlalchemy as sa


revision = "c4e8a2d7f1b3"
down_revision = "b7d3f1a9c2e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("departments", sa.Column("currency", sa.String(8), nullable=True))
    op.create_check_constraint(
        "ck_departments_currency", "departments",
        "currency IS NULL OR currency IN ('KGS','USD','EUR','RUB')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_departments_currency", "departments", type_="check")
    op.drop_column("departments", "currency")
