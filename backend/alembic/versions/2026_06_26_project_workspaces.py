"""project workspaces (изолированные проектные пространства)

Создаёт:
  - project_workspaces        — само пространство (владелец = сотрудник org)
  - project_workspace_members — участники пространства
  - workspace_audit_log       — несокращаемый журнал действий (защита аудируемости)
И добавляет nullable workspace_id в expenses / advances / categories.

Всё аддитивно и обратно совместимо: новые колонки nullable, существующие данные
не трогаются (workspace_id IS NULL = запись вне пространства, прежнее поведение).

Revision ID: a1c2e3f4b5d6
Revises: f1a2b3c4d5e6
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa


revision = "a1c2e3f4b5d6"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_workspaces",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "org_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "owner_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Один пользователь — не более одного АКТИВНОГО пространства (частичный unique).
    op.create_index(
        "uq_workspace_one_active_owner",
        "project_workspaces",
        ["owner_id"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )

    op.create_table(
        "project_workspace_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Integer(),
            sa.ForeignKey("project_workspaces.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "added_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("added_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_member_pair"),
    )

    op.create_table(
        "workspace_audit_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "org_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "workspace_id",
            sa.Integer(),
            sa.ForeignKey("project_workspaces.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "actor_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now(), index=True),
    )

    for table in ("expenses", "advances", "categories"):
        op.add_column(
            table,
            sa.Column(
                "workspace_id",
                sa.Integer(),
                sa.ForeignKey("project_workspaces.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index(f"ix_{table}_workspace_id", table, ["workspace_id"])


def downgrade() -> None:
    for table in ("expenses", "advances", "categories"):
        op.drop_index(f"ix_{table}_workspace_id", table_name=table)
        op.drop_column(table, "workspace_id")
    op.drop_table("workspace_audit_log")
    op.drop_table("project_workspace_members")
    op.drop_index("uq_workspace_one_active_owner", table_name="project_workspaces")
    op.drop_table("project_workspaces")
