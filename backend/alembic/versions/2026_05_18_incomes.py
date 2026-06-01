"""incomes table

Revision ID: e6f2a8b15c39
Revises: c4e9b1d3a72f
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa


revision = "e6f2a8b15c39"
down_revision = "c4e9b1d3a72f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "incomes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column(
            "currency",
            sa.String(length=8),
            server_default="KGS",
            nullable=False,
        ),
        sa.Column("source", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("received_by_id", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column(
            "date",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["received_by_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_incomes_org_id", "incomes", ["org_id"])
    op.create_index("ix_incomes_received_by_id", "incomes", ["received_by_id"])
    op.create_index("ix_incomes_date", "incomes", ["date"])


def downgrade() -> None:
    op.drop_index("ix_incomes_date", table_name="incomes")
    op.drop_index("ix_incomes_received_by_id", table_name="incomes")
    op.drop_index("ix_incomes_org_id", table_name="incomes")
    op.drop_table("incomes")
