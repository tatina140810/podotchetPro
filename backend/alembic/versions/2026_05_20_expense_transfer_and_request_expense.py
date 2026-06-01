"""expenses: to_user_id, expense_type, funded_by_id, source_request_id.
money_requests: is_expense_on_approve, expense_category_id.

Revision ID: e5b7d1a2c930
Revises: a4f1c2d8e570
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa


revision = "e5b7d1a2c930"
down_revision = "a4f1c2d8e570"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- expenses ---
    with op.batch_alter_table("expenses") as b:
        b.add_column(sa.Column("to_user_id", sa.Integer(), nullable=True))
        b.add_column(sa.Column(
            "expense_type",
            sa.String(length=20),
            nullable=False,
            server_default="expense",
        ))
        b.add_column(sa.Column("funded_by_id", sa.Integer(), nullable=True))
        b.add_column(sa.Column("source_request_id", sa.Integer(), nullable=True))
        b.create_foreign_key("fk_expenses_to_user_id", "users", ["to_user_id"], ["id"])
        b.create_foreign_key("fk_expenses_funded_by_id", "users", ["funded_by_id"], ["id"])
        b.create_foreign_key(
            "fk_expenses_source_request_id", "money_requests", ["source_request_id"], ["id"]
        )

    # --- money_requests ---
    with op.batch_alter_table("money_requests") as b:
        b.add_column(sa.Column(
            "is_expense_on_approve",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ))
        b.add_column(sa.Column("expense_category_id", sa.Integer(), nullable=True))
        b.create_foreign_key(
            "fk_money_requests_expense_category_id",
            "categories",
            ["expense_category_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("money_requests") as b:
        b.drop_constraint("fk_money_requests_expense_category_id", type_="foreignkey")
        b.drop_column("expense_category_id")
        b.drop_column("is_expense_on_approve")

    with op.batch_alter_table("expenses") as b:
        b.drop_constraint("fk_expenses_source_request_id", type_="foreignkey")
        b.drop_constraint("fk_expenses_funded_by_id", type_="foreignkey")
        b.drop_constraint("fk_expenses_to_user_id", type_="foreignkey")
        b.drop_column("source_request_id")
        b.drop_column("funded_by_id")
        b.drop_column("expense_type")
        b.drop_column("to_user_id")
