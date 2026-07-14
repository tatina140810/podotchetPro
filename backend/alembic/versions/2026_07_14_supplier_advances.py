"""supplier advances (авансы/депозиты у поставщиков)

Создаёт:
  - supplier_advances              — депозит у поставщика (баланс сотрудника уменьшен)
  - supplier_advance_transactions  — движения: deposit / purchase / refund
И добавляет в expenses:
  - payment_source (NOT NULL default 'balance') — источник оплаты расхода
  - supplier_advance_id (nullable FK) — с какого депозита оплачено

Всё аддитивно: существующие расходы получают payment_source='balance' (прежнее
поведение), новые колонки/таблицы не влияют на текущую логику.

Revision ID: f8b0d2a4c6e9
Revises: e7a9c1b3d5f2
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa


revision = "f8b0d2a4c6e9"
down_revision = "e7a9c1b3d5f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "supplier_advances",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("project_workspaces.id", ondelete="SET NULL"), nullable=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("supplier_name", sa.String(length=200), nullable=False),
        sa.Column("initial_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="KGS"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_supplier_advances_org_id", "supplier_advances", ["org_id"])
    op.create_index("ix_supplier_advances_workspace_id", "supplier_advances", ["workspace_id"])
    op.create_index("ix_supplier_advances_employee_id", "supplier_advances", ["employee_id"])
    op.create_index("ix_supplier_advances_status", "supplier_advances", ["status"])

    op.create_table(
        "supplier_advance_transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("advance_id", sa.Integer(), sa.ForeignKey("supplier_advances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("expense_id", sa.Integer(), sa.ForeignKey("expenses.id", ondelete="CASCADE"), nullable=True),
        sa.Column("date", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_sat_advance_id", "supplier_advance_transactions", ["advance_id"])
    op.create_index("ix_sat_type", "supplier_advance_transactions", ["type"])
    op.create_index("ix_sat_expense_id", "supplier_advance_transactions", ["expense_id"])

    op.add_column(
        "expenses",
        sa.Column("payment_source", sa.String(length=20), nullable=False, server_default="balance"),
    )
    op.create_index("ix_expenses_payment_source", "expenses", ["payment_source"])
    op.add_column(
        "expenses",
        sa.Column(
            "supplier_advance_id",
            sa.Integer(),
            sa.ForeignKey("supplier_advances.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_expenses_supplier_advance_id", "expenses", ["supplier_advance_id"])


def downgrade() -> None:
    op.drop_index("ix_expenses_supplier_advance_id", "expenses")
    op.drop_column("expenses", "supplier_advance_id")
    op.drop_index("ix_expenses_payment_source", "expenses")
    op.drop_column("expenses", "payment_source")
    op.drop_index("ix_sat_expense_id", "supplier_advance_transactions")
    op.drop_index("ix_sat_type", "supplier_advance_transactions")
    op.drop_index("ix_sat_advance_id", "supplier_advance_transactions")
    op.drop_table("supplier_advance_transactions")
    op.drop_index("ix_supplier_advances_status", "supplier_advances")
    op.drop_index("ix_supplier_advances_employee_id", "supplier_advances")
    op.drop_index("ix_supplier_advances_workspace_id", "supplier_advances")
    op.drop_index("ix_supplier_advances_org_id", "supplier_advances")
    op.drop_table("supplier_advances")
