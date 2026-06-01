"""subordinates (users.created_by_id) and advances.source

Revision ID: 5b3a9d12e7c1
Revises: 1208f602002f
Create Date: 2026-05-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "5b3a9d12e7c1"
down_revision = "1208f602002f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("created_by_id", sa.Integer(), nullable=True),
    )
    op.create_index("ix_users_created_by_id", "users", ["created_by_id"])
    op.create_foreign_key(
        "fk_users_created_by_id",
        "users",
        "users",
        ["created_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "advances",
        sa.Column(
            "source",
            sa.String(length=20),
            nullable=False,
            server_default="org_funds",
        ),
    )


def downgrade() -> None:
    op.drop_column("advances", "source")
    op.drop_constraint("fk_users_created_by_id", "users", type_="foreignkey")
    op.drop_index("ix_users_created_by_id", table_name="users")
    op.drop_column("users", "created_by_id")
