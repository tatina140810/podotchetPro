"""recurring_obligations.category_id — справочная категория обязательства.

Аддитивная миграция: ADD COLUMN category_id (nullable) + индекс + FK (SET NULL).
Категория справочная, ни на что не влияет. Ничего существующего не трогает.

Revision ID: c7d1e9f3a204
Revises: b2c3d4e5f6a7
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa


revision = "c7d1e9f3a204"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "recurring_obligations",
        sa.Column("category_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_recurring_obligations_category_id",
        "recurring_obligations",
        ["category_id"],
    )
    op.create_foreign_key(
        "fk_recurring_obligations_category_id",
        "recurring_obligations",
        "categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_recurring_obligations_category_id",
        "recurring_obligations",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_recurring_obligations_category_id",
        table_name="recurring_obligations",
    )
    op.drop_column("recurring_obligations", "category_id")
