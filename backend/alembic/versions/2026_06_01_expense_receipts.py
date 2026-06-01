"""expense_receipts: несколько чеков/документов на один расход.

Чеки можно докладывать даже после проверки расхода (status approved/rejected).
Бэкфилл: существующие expenses.receipt_url переносим в expense_receipts,
чтобы уже прикреплённые чеки сразу показывались в галерее.

Revision ID: b1e7c4a90d62
Revises: a7d3c8e9f2b5
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa


revision = "b1e7c4a90d62"
down_revision = "a7d3c8e9f2b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "expense_receipts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("expense_id", sa.Integer(), nullable=False),
        sa.Column("file_url", sa.String(length=500), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("uploaded_by_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["expense_id"], ["expenses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_expense_receipts_org_id", "expense_receipts", ["org_id"])
    op.create_index("ix_expense_receipts_expense_id", "expense_receipts", ["expense_id"])

    # Бэкфилл старых одиночных чеков. uploaded_by = владелец расхода (employee_id),
    # created_at = момент создания расхода. Берём только непустые receipt_url.
    op.execute(
        """
        INSERT INTO expense_receipts (org_id, expense_id, file_url, uploaded_by_id, created_at)
        SELECT org_id, id, receipt_url, employee_id, created_at
        FROM expenses
        WHERE receipt_url IS NOT NULL AND receipt_url <> ''
        """
    )


def downgrade() -> None:
    op.drop_index("ix_expense_receipts_expense_id", table_name="expense_receipts")
    op.drop_index("ix_expense_receipts_org_id", table_name="expense_receipts")
    op.drop_table("expense_receipts")
