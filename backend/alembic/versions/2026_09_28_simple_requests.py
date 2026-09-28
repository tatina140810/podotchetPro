"""Упрощённые заявки (Тати / Ice, 2026-09-28): сотрудник пишет заявку свободно,
она сразу уходит «принимающему заявки» организации (Индире); та одобряет с
разноской (категория, подразделение, нал/безнал, сумма, дата), затем «Выдал».

Только ADD COLUMN nullable — прежние заявки и их поведение не меняются.
  organizations.request_handler_id — кто принимает упрощённые заявки;
  money_requests.flow              — 'simple' у новых, NULL у прежних;
  money_requests.handler_*         — разноска при одобрении (что станет расходом);
  money_requests.issued_*          — факт выдачи и сама выдача (balance_topups);
  money_request_items.customer/comment — «заказчик» и комментарий строки.
"""
from alembic import op
import sqlalchemy as sa

revision = "d1a7c3e9b25f"
down_revision = "c8e4b2a7f513"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column(
        "request_handler_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))

    op.add_column("money_requests", sa.Column("flow", sa.String(length=16), nullable=True))
    op.add_column("money_requests", sa.Column(
        "handler_category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True))
    op.add_column("money_requests", sa.Column("handler_payment_method", sa.String(length=8), nullable=True))
    op.add_column("money_requests", sa.Column("handler_amount", sa.Numeric(12, 2), nullable=True))
    op.add_column("money_requests", sa.Column("handler_currency", sa.String(length=8), nullable=True))
    op.add_column("money_requests", sa.Column("handler_date", sa.Date(), nullable=True))
    op.add_column("money_requests", sa.Column("handler_comment", sa.Text(), nullable=True))
    op.add_column("money_requests", sa.Column("issued_at", sa.DateTime(), nullable=True))
    op.add_column("money_requests", sa.Column(
        "issued_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    op.add_column("money_requests", sa.Column(
        "issue_topup_id", sa.Integer(), sa.ForeignKey("balance_topups.id", ondelete="SET NULL"), nullable=True))
    # Одна выдача — одна заявка: повторное «Выдал» не создаст вторую выдачу.
    op.create_index("ix_money_requests_issue_topup", "money_requests", ["issue_topup_id"], unique=True)
    op.create_index("ix_money_requests_flow_status", "money_requests", ["flow", "status"])

    op.add_column("money_request_items", sa.Column("customer", sa.String(length=200), nullable=True))
    op.add_column("money_request_items", sa.Column("comment", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("money_request_items", "comment")
    op.drop_column("money_request_items", "customer")
    op.drop_index("ix_money_requests_flow_status", table_name="money_requests")
    op.drop_index("ix_money_requests_issue_topup", table_name="money_requests")
    for col in ("issue_topup_id", "issued_by_id", "issued_at", "handler_comment", "handler_date",
                "handler_currency", "handler_amount", "handler_payment_method", "handler_category_id", "flow"):
        op.drop_column("money_requests", col)
    op.drop_column("organizations", "request_handler_id")
