"""multicurrency: advances.currency, expenses.currency

Revision ID: 9e2b51a4f8c3
Revises: 5b3a9d12e7c1
Create Date: 2026-05-12
"""
from alembic import op
import sqlalchemy as sa


revision = "9e2b51a4f8c3"
down_revision = "5b3a9d12e7c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "advances",
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="KGS"),
    )
    op.add_column(
        "expenses",
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="KGS"),
    )


def downgrade() -> None:
    op.drop_column("expenses", "currency")
    op.drop_column("advances", "currency")
