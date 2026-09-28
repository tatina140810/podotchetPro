"""Упрощённые заявки, шаг 3: отчёт принимающего (Индиры) на одобрении у владельца (Ice).

Только ADD COLUMN nullable:
  organizations.request_reviewer_id — кто одобряет расходы, проведённые принимающим;
  money_requests.returned_comment/returned_at — причина и время возврата на правку
    (владелец отклонил строку: расход отменён, заявка снова «выдано, ждём чек»).
"""
from alembic import op
import sqlalchemy as sa

revision = "f2c6a8e4d7b1"
down_revision = "e4b8d2f6a913"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column(
        "request_reviewer_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    op.add_column("money_requests", sa.Column("returned_comment", sa.Text(), nullable=True))
    op.add_column("money_requests", sa.Column("returned_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("money_requests", "returned_at")
    op.drop_column("money_requests", "returned_comment")
    op.drop_column("organizations", "request_reviewer_id")
