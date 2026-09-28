"""Упрощённые заявки, шаг 4: расходы по заявкам — в отчёты только после выдачи владельцем.

  expenses.report_hold, balance_topups.report_hold — «ещё не в отчётах»: запись
    реальная (баланс считает её), но три отчёта (по категориям, по сотрудникам,
    по подразделениям + их Excel) её не показывают до выпуска;
  money_requests.released_at / release_topup_id — когда и какой выдачей
    владельца принимающему заявка выпущена в отчёты.
ADD COLUMN с server_default false: у всех прежних записей false — отчёты не меняются.
"""
from alembic import op
import sqlalchemy as sa

revision = "a9d3f5c7e2b8"
down_revision = "f2c6a8e4d7b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("expenses", sa.Column("report_hold", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("balance_topups", sa.Column("report_hold", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    # Частичные индексы: задержанных строк единицы — ищем их быстро, остальные не трогаем.
    op.create_index("ix_expenses_report_hold", "expenses", ["org_id"], postgresql_where=sa.text("report_hold"))
    op.create_index("ix_topups_report_hold", "balance_topups", ["org_id"], postgresql_where=sa.text("report_hold"))
    op.add_column("money_requests", sa.Column("released_at", sa.DateTime(), nullable=True))
    op.add_column("money_requests", sa.Column(
        "release_topup_id", sa.Integer(), sa.ForeignKey("balance_topups.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    op.drop_column("money_requests", "release_topup_id")
    op.drop_column("money_requests", "released_at")
    op.drop_index("ix_topups_report_hold", table_name="balance_topups")
    op.drop_index("ix_expenses_report_hold", table_name="expenses")
    op.drop_column("balance_topups", "report_hold")
    op.drop_column("expenses", "report_hold")
