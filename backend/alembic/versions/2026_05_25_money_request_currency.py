"""money_requests.currency (KGS/USD/RUB/...)

Revision ID: f6c8d2e3a1b4
Revises: e5b7d1a2c930
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa


revision = "f6c8d2e3a1b4"
down_revision = "d3b5f8a91c40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "money_requests",
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="KGS"),
    )


def downgrade() -> None:
    op.drop_column("money_requests", "currency")
