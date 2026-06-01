"""categories.is_operational — флаг операционных категорий для отчёта.

Revision ID: a4f1c2d8e570
Revises: c8e72f1b4093
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa


revision = "a4f1c2d8e570"
down_revision = "c8e72f1b4093"
branch_labels = None
depends_on = None


# Список операционных категорий по указанию пользователя — backfill при апгрейде.
OPERATIONAL_NAMES = [
    "Налоги",
    "Аренда",
    "ЗП Офис",
    "ЗП Банковским сотрудникам",
    "Банк",
    "Связь",
    "Хоз. расход 6 этаж",
    "Хоз. расход 8 этаж",
    "Хоз. расход Москва",
]


def upgrade() -> None:
    with op.batch_alter_table("categories") as b:
        b.add_column(
            sa.Column(
                "is_operational",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            )
        )
    # Backfill: помечаем известные операционные категории.
    conn = op.get_bind()
    for name in OPERATIONAL_NAMES:
        conn.execute(
            sa.text("UPDATE categories SET is_operational = true WHERE name = :n"),
            {"n": name},
        )


def downgrade() -> None:
    with op.batch_alter_table("categories") as b:
        b.drop_column("is_operational")
