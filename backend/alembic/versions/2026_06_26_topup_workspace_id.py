"""balance_topups.workspace_id — привязка пополнения к проектному пространству

Нужно для агрегата пространства: финансирование владельцев пространств идёт через
пополнения (BalanceTopUp), а не выдачи (Advance). Аддитивно, nullable.

Revision ID: b2d4f6a8c0e1
Revises: a1c2e3f4b5d6
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa


revision = "b2d4f6a8c0e1"
down_revision = "a1c2e3f4b5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "balance_topups",
        sa.Column(
            "workspace_id",
            sa.Integer(),
            sa.ForeignKey("project_workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_balance_topups_workspace_id", "balance_topups", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_balance_topups_workspace_id", table_name="balance_topups")
    op.drop_column("balance_topups", "workspace_id")
