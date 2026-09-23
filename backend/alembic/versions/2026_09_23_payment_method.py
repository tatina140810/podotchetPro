"""Форма расчёта операции: наличные / безналичные.

payment_method: 'cash' | 'bank'; NULL = не указано (все записи до миграции).
Нужна для фильтра в «Импорте истории» и для выгрузки новых записей в Google-таблицу
«Локомотив» (безнал → лист «Банк», наличные → лист «Нал»).

Аддитивная миграция: ADD COLUMN nullable + CHECK + индекс.
"""
from alembic import op
import sqlalchemy as sa

revision = "b3f9c1d5a204"
down_revision = "a7d2f4e8c130"
branch_labels = None
depends_on = None

_TABLES = ("expenses", "incomes", "balance_topups")


def upgrade() -> None:
    for t in _TABLES:
        op.add_column(t, sa.Column("payment_method", sa.String(length=8), nullable=True))
        op.create_check_constraint(
            f"ck_{t}_payment_method", t,
            "payment_method IS NULL OR payment_method IN ('cash','bank')",
        )
        op.create_index(f"ix_{t}_payment_method", t, ["payment_method"])


def downgrade() -> None:
    for t in _TABLES:
        op.drop_index(f"ix_{t}_payment_method", table_name=t)
        op.drop_constraint(f"ck_{t}_payment_method", t, type_="check")
        op.drop_column(t, "payment_method")
