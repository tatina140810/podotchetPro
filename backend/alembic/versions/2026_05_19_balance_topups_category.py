"""balance_topups.category_id — категория для выдачи

Revision ID: f9a3c6e07d52
Revises: d7b14e2c5f88
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa


revision = "f9a3c6e07d52"
down_revision = "d7b14e2c5f88"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("balance_topups") as b:
        b.add_column(sa.Column("category_id", sa.Integer(), nullable=True))
        b.create_foreign_key(
            "fk_balance_topups_category_id",
            "categories",
            ["category_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("balance_topups") as b:
        b.drop_constraint("fk_balance_topups_category_id", type_="foreignkey")
        b.drop_column("category_id")
