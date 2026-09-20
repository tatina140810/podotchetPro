"""money_request_receipts — чеки/документы к одобренной заявке

Аддитивно: CREATE TABLE. По образцу expense_receipts (несколько документов на
сущность). Крепятся к заявке в статусе approved — подтверждение того, что
одобренные деньги потрачены. Удалять может тот, кто загрузил, и директор.

Revision ID: f1c6a8d3b70e
Revises: e5b1c7d9a2f4
Create Date: 2026-09-20
"""
from alembic import op
import sqlalchemy as sa


revision = "f1c6a8d3b70e"
down_revision = "e5b1c7d9a2f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "money_request_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("file_url", sa.String(length=500), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("uploaded_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["request_id"], ["money_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"]),
    )
    op.create_index("ix_money_request_receipts_org_id", "money_request_receipts", ["org_id"])
    op.create_index("ix_money_request_receipts_request_id", "money_request_receipts", ["request_id"])


def downgrade() -> None:
    op.drop_index("ix_money_request_receipts_request_id", table_name="money_request_receipts")
    op.drop_index("ix_money_request_receipts_org_id", table_name="money_request_receipts")
    op.drop_table("money_request_receipts")
