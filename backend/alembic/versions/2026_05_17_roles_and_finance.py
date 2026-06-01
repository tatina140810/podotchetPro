"""roles expansion + finance: money_requests/items/transfers/topups, notifications, supervisor rename, expense verification

Revision ID: 9e8c2a5b1d44
Revises: 7d2c4f9a1b08
Create Date: 2026-05-17

Изменения:
1. users.created_by_id → users.supervisor_id (rename, данные сохраняются)
2. UPDATE users SET role='accountable' WHERE role='employee' (admin не трогаем)
3. expenses.is_verified, expenses.verified_by_id — для аудиторской проверки
4. Новые таблицы: money_requests, money_request_items, money_transfers,
   balance_topups, notifications
"""
from alembic import op
import sqlalchemy as sa


revision = "9e8c2a5b1d44"
down_revision = "7d2c4f9a1b08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Rename users.created_by_id → users.supervisor_id (batch для SQLite-совместимости)
    #    Старый индекс ix_users_created_by_id создавался в миграции 5b3a9d12e7c1.
    with op.batch_alter_table("users") as b:
        b.drop_index("ix_users_created_by_id")
        b.alter_column("created_by_id", new_column_name="supervisor_id")
        b.create_index("ix_users_supervisor_id", ["supervisor_id"])

    # 2. Data migration: employee → accountable; admin остаётся admin
    op.execute("UPDATE users SET role='accountable' WHERE role='employee'")

    # 3. Expenses: аудиторская верификация
    with op.batch_alter_table("expenses") as b:
        b.add_column(
            sa.Column(
                "is_verified",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            )
        )
        b.add_column(sa.Column("verified_by_id", sa.Integer(), nullable=True))
        b.create_foreign_key(
            "fk_expenses_verified_by_id",
            "users",
            ["verified_by_id"],
            ["id"],
        )

    # 4. money_requests
    op.create_table(
        "money_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("requester_id", sa.Integer(), nullable=False),
        sa.Column("approver_id", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="draft",
            nullable=False,
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column(
            "total_amount",
            sa.Numeric(precision=12, scale=2),
            server_default="0",
            nullable=False,
        ),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requester_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["approver_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_money_requests_org_id", "money_requests", ["org_id"])
    op.create_index("ix_money_requests_requester_id", "money_requests", ["requester_id"])
    op.create_index("ix_money_requests_approver_id", "money_requests", ["approver_id"])
    op.create_index("ix_money_requests_status", "money_requests", ["status"])

    # 5. money_request_items
    op.create_table(
        "money_request_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("quantity", sa.Integer(), server_default="1", nullable=False),
        sa.ForeignKeyConstraint(["request_id"], ["money_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_money_request_items_request_id", "money_request_items", ["request_id"])

    # 6. money_transfers
    op.create_table(
        "money_transfers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("from_user_id", sa.Integer(), nullable=False),
        sa.Column("to_user_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["from_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_money_transfers_org_id", "money_transfers", ["org_id"])
    op.create_index("ix_money_transfers_from_user_id", "money_transfers", ["from_user_id"])
    op.create_index("ix_money_transfers_to_user_id", "money_transfers", ["to_user_id"])

    # 7. balance_topups (admin пополняет баланс юзера "из казны")
    op.create_table(
        "balance_topups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("admin_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["admin_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_balance_topups_org_id", "balance_topups", ["org_id"])
    op.create_index("ix_balance_topups_user_id", "balance_topups", ["user_id"])

    # 8. notifications
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column(
            "is_read",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_org_id", "notifications", ["org_id"])
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_is_read", "notifications", ["is_read"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_notifications_created_at", table_name="notifications")
    op.drop_index("ix_notifications_is_read", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_index("ix_notifications_org_id", table_name="notifications")
    op.drop_table("notifications")

    op.drop_index("ix_balance_topups_user_id", table_name="balance_topups")
    op.drop_index("ix_balance_topups_org_id", table_name="balance_topups")
    op.drop_table("balance_topups")

    op.drop_index("ix_money_transfers_to_user_id", table_name="money_transfers")
    op.drop_index("ix_money_transfers_from_user_id", table_name="money_transfers")
    op.drop_index("ix_money_transfers_org_id", table_name="money_transfers")
    op.drop_table("money_transfers")

    op.drop_index("ix_money_request_items_request_id", table_name="money_request_items")
    op.drop_table("money_request_items")

    op.drop_index("ix_money_requests_status", table_name="money_requests")
    op.drop_index("ix_money_requests_approver_id", table_name="money_requests")
    op.drop_index("ix_money_requests_requester_id", table_name="money_requests")
    op.drop_index("ix_money_requests_org_id", table_name="money_requests")
    op.drop_table("money_requests")

    with op.batch_alter_table("expenses") as b:
        b.drop_constraint("fk_expenses_verified_by_id", type_="foreignkey")
        b.drop_column("verified_by_id")
        b.drop_column("is_verified")

    # accountable → employee для отката
    op.execute("UPDATE users SET role='employee' WHERE role='accountable'")

    with op.batch_alter_table("users") as b:
        b.drop_index("ix_users_supervisor_id")
        b.alter_column("supervisor_id", new_column_name="created_by_id")
        b.create_index("ix_users_created_by_id", ["created_by_id"])
