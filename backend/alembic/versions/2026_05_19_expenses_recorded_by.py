"""expenses.recorded_by_id — кто реально внёс запись (admin mode)

Revision ID: b2d54f3e9a17
Revises: f17a4e6b8290
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa


revision = "b2d54f3e9a17"
down_revision = "f17a4e6b8290"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("expenses") as b:
        b.add_column(sa.Column("recorded_by_id", sa.Integer(), nullable=True))
        b.create_foreign_key(
            "fk_expenses_recorded_by_id",
            "users",
            ["recorded_by_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("expenses") as b:
        b.drop_constraint("fk_expenses_recorded_by_id", type_="foreignkey")
        b.drop_column("recorded_by_id")
