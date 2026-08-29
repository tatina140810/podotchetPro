"""soft-delete (расход/приход/передача/выдача) + журнал изменений

Добавляет:
  - expenses / incomes / money_transfers / balance_topups:
      deleted_at (TIMESTAMPTZ NULL), deleted_by (FK users SET NULL)
      + частичные индексы WHERE deleted_at IS NULL на горячие выборки
        (org + актор), чтобы «активные» сканы не деградировали.
  - record_change_log — несокращаемый журнал update/delete финансовых записей.

Всё аддитивно: столбцы nullable, у существующих записей deleted_at=NULL
(активны, прежнее поведение). Обратимо (см. downgrade).

Revision ID: b7d3f1a9c2e4
Revises: f8b0d2a4c6e9
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "b7d3f1a9c2e4"
down_revision = "f8b0d2a4c6e9"
branch_labels = None
depends_on = None


# таблица → список колонок-акторов для частичных индексов «активных» записей
_SOFT_DELETE = {
    "expenses": ["employee_id", "status"],
    "incomes": ["received_by_id"],
    "money_transfers": ["from_user_id", "to_user_id"],
    "balance_topups": ["user_id", "admin_id"],
}

_ACTIVE = sa.text("deleted_at IS NULL")


def upgrade() -> None:
    for table, actors in _SOFT_DELETE.items():
        op.add_column(table, sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        op.add_column(
            table,
            sa.Column(
                "deleted_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        for actor in actors:
            op.create_index(
                f"ix_{table}_active_{actor}",
                table,
                ["org_id", actor],
                postgresql_where=_ACTIVE,
            )

    op.create_table(
        "record_change_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "org_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("entity_type", sa.String(length=16), nullable=False),  # expense|income|transfer
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),        # update|delete
        sa.Column(
            "changed_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("diff", postgresql.JSONB(), nullable=False),
    )
    op.create_index("ix_record_change_log_org_id", "record_change_log", ["org_id"])
    op.create_index("ix_rcl_entity", "record_change_log", ["entity_type", "entity_id"])


def downgrade() -> None:
    op.drop_index("ix_rcl_entity", table_name="record_change_log")
    op.drop_index("ix_record_change_log_org_id", table_name="record_change_log")
    op.drop_table("record_change_log")

    for table, actors in _SOFT_DELETE.items():
        for actor in actors:
            op.drop_index(f"ix_{table}_active_{actor}", table_name=table)
        op.drop_column(table, "deleted_by")
        op.drop_column(table, "deleted_at")
