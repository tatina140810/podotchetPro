"""Упрощённые заявки, шаг 2: чек / «нет чека» и закрытие заявки расходом.

Только ADD COLUMN nullable:
  money_requests.no_receipt, no_receipt_comment — «нет чека» с обязательным комментарием;
  money_requests.closed_at, closed_by_id        — когда и кто провёл расход;
  money_requests.expense_id (UNIQUE)             — расход, которым закрыта заявка
                                                   (повторное закрытие не создаст второй).
"""
from alembic import op
import sqlalchemy as sa

revision = "e4b8d2f6a913"
down_revision = "d1a7c3e9b25f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("money_requests", sa.Column("no_receipt", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("money_requests", sa.Column("no_receipt_comment", sa.Text(), nullable=True))
    op.add_column("money_requests", sa.Column("closed_at", sa.DateTime(), nullable=True))
    op.add_column("money_requests", sa.Column(
        "closed_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    op.add_column("money_requests", sa.Column(
        "expense_id", sa.Integer(), sa.ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_money_requests_expense", "money_requests", ["expense_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_money_requests_expense", table_name="money_requests")
    for col in ("expense_id", "closed_by_id", "closed_at", "no_receipt_comment", "no_receipt"):
        op.drop_column("money_requests", col)
