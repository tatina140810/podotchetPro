"""categories.parent_id — подкатегории (2 уровня вложенности)

Revision ID: a7d3c8e9f2b5
Revises: f6c8d2e3a1b4
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa


revision = "a7d3c8e9f2b5"
down_revision = "f6c8d2e3a1b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column("parent_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_categories_parent_id",
        "categories",
        "categories",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_categories_parent_id",
        "categories",
        ["parent_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_categories_parent_id", table_name="categories")
    op.drop_constraint("fk_categories_parent_id", "categories", type_="foreignkey")
    op.drop_column("categories", "parent_id")
