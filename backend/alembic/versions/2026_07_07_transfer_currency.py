"""money_transfers.currency + amount_kgs — мультивалютные переводы «Передать»

Раньше MoneyTransfer был только в KGS (баланс считал amount как сомы). Теперь
перевод можно записать в любой валюте: currency хранит валюту операции, amount_kgs —
KGS-эквивалент на момент перевода (как у Advance/BalanceTopUp). Общий баланс
считается по amount_kgs (COALESCE с amount для старых KGS-записей). Аддитивно.

Revision ID: e7a9c1b3d5f2
Revises: d4f6b8c0e2a3
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa


revision = "e7a9c1b3d5f2"
down_revision = "d4f6b8c0e2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "money_transfers",
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="KGS"),
    )
    op.add_column(
        "money_transfers",
        sa.Column("amount_kgs", sa.Numeric(12, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("money_transfers", "amount_kgs")
    op.drop_column("money_transfers", "currency")
