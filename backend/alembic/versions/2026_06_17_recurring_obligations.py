"""recurring_obligations — личный справочник регулярных расходов сотрудника.

Аддитивная миграция: новая таблица recurring_obligations (на уровне пользователя).
Ничего из существующего не трогает.

Revision ID: f6c0e4b3d1a2
Revises: e5b9d3a2c0f1
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa


revision = "f6c0e4b3d1a2"
down_revision = "e5b9d3a2c0f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recurring_obligations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column(
            "periodicity", sa.String(length=16), server_default="monthly", nullable=False
        ),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recurring_obligations_org_id", "recurring_obligations", ["org_id"])
    op.create_index("ix_recurring_obligations_user_id", "recurring_obligations", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_recurring_obligations_user_id", table_name="recurring_obligations")
    op.drop_index("ix_recurring_obligations_org_id", table_name="recurring_obligations")
    op.drop_table("recurring_obligations")
