"""chat tables: chat_rooms, chat_members, chat_messages

Revision ID: 7d2c4f9a1b08
Revises: 9e2b51a4f8c3
Create Date: 2026-05-17

"""
from alembic import op
import sqlalchemy as sa


revision = "7d2c4f9a1b08"
down_revision = "9e2b51a4f8c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_rooms",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("room_type", sa.String(length=10), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_rooms_org_id", "chat_rooms", ["org_id"])

    op.create_table(
        "chat_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("room_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "joined_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("last_read_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["room_id"], ["chat_rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("room_id", "user_id", name="uq_chat_members_room_user"),
    )
    op.create_index("ix_chat_members_room_id", "chat_members", ["room_id"])
    op.create_index("ix_chat_members_user_id", "chat_members", ["user_id"])

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("room_id", sa.Integer(), nullable=False),
        sa.Column("sender_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("reply_to_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["room_id"], ["chat_rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reply_to_id"], ["chat_messages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_room_id", "chat_messages", ["room_id"])
    op.create_index("ix_chat_messages_sender_id", "chat_messages", ["sender_id"])
    op.create_index("ix_chat_messages_created_at", "chat_messages", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_chat_messages_created_at", table_name="chat_messages")
    op.drop_index("ix_chat_messages_sender_id", table_name="chat_messages")
    op.drop_index("ix_chat_messages_room_id", table_name="chat_messages")
    op.drop_table("chat_messages")

    op.drop_index("ix_chat_members_user_id", table_name="chat_members")
    op.drop_index("ix_chat_members_room_id", table_name="chat_members")
    op.drop_table("chat_members")

    op.drop_index("ix_chat_rooms_org_id", table_name="chat_rooms")
    op.drop_table("chat_rooms")
