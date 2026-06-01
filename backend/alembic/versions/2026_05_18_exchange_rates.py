"""exchange_rates table

Revision ID: c4e9b1d3a72f
Revises: 3a7d1c9e5f02
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa


revision = "c4e9b1d3a72f"
down_revision = "3a7d1c9e5f02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exchange_rates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("from_currency", sa.String(length=8), nullable=False),
        sa.Column("to_currency", sa.String(length=8), nullable=False),
        sa.Column("rate", sa.Numeric(precision=14, scale=4), nullable=False),
        sa.Column(
            "date",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_exchange_rates_org_id", "exchange_rates", ["org_id"])
    op.create_index("ix_exchange_rates_date", "exchange_rates", ["date"])


def downgrade() -> None:
    op.drop_index("ix_exchange_rates_date", table_name="exchange_rates")
    op.drop_index("ix_exchange_rates_org_id", table_name="exchange_rates")
    op.drop_table("exchange_rates")
