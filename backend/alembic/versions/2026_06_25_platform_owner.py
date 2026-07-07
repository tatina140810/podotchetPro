"""add users.is_platform_owner (super-admin platform panel)

Revision ID: f1a2b3c4d5e6
Revises: d8e2f1a9c3b5
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa


revision = "f1a2b3c4d5e6"
down_revision = "d8e2f1a9c3b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_platform_owner", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("users", "is_platform_owner")
