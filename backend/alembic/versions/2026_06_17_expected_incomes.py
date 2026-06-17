"""expected_incomes — ожидаемые пополнения (подраздел модуля «Приходы»).

Аддитивная миграция: новая таблица expected_incomes (на уровне пользователя),
FK created_income_id → incomes (SET NULL). Существующее не трогает.

Revision ID: a1b2c3d4e5f6
Revises: f6c0e4b3d1a2
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa


revision = "a1b2c3d4e5f6"
down_revision = "f6c0e4b3d1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "expected_incomes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=8), server_default="KGS", nullable=False),
        sa.Column("expected_date", sa.DateTime(), nullable=True),
        sa.Column("periodicity", sa.String(length=16), server_default="one_time", nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=True),
        sa.Column("created_income_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_income_id"], ["incomes.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_expected_incomes_org_id", "expected_incomes", ["org_id"])
    op.create_index("ix_expected_incomes_user_id", "expected_incomes", ["user_id"])
    op.create_index("ix_expected_incomes_status", "expected_incomes", ["status"])
    op.create_index("ix_expected_incomes_expected_date", "expected_incomes", ["expected_date"])


def downgrade() -> None:
    op.drop_index("ix_expected_incomes_expected_date", table_name="expected_incomes")
    op.drop_index("ix_expected_incomes_status", table_name="expected_incomes")
    op.drop_index("ix_expected_incomes_user_id", table_name="expected_incomes")
    op.drop_index("ix_expected_incomes_org_id", table_name="expected_incomes")
    op.drop_table("expected_incomes")
