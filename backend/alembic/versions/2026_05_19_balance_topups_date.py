"""balance_topups.date — бизнес-дата операции (для исторических записей)

Revision ID: d7b14e2c5f88
Revises: b2d54f3e9a17
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa


revision = "d7b14e2c5f88"
down_revision = "b2d54f3e9a17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Сначала добавляем nullable, чтобы бэкфилл из created_at прошёл без ошибок
    #    у уже существующих строк.
    with op.batch_alter_table("balance_topups") as b:
        b.add_column(sa.Column("date", sa.DateTime(), nullable=True))

    # 2) Бэкфилл: для всех существующих топапов date = created_at.
    op.execute("UPDATE balance_topups SET date = created_at WHERE date IS NULL")

    # 3) Делаем NOT NULL + индекс для быстрых выборок по периоду.
    with op.batch_alter_table("balance_topups") as b:
        b.alter_column("date", nullable=False)
        b.create_index("ix_balance_topups_date", ["date"])


def downgrade() -> None:
    with op.batch_alter_table("balance_topups") as b:
        b.drop_index("ix_balance_topups_date")
        b.drop_column("date")
