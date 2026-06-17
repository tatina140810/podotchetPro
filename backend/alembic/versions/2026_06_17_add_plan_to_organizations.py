"""organizations.plan — freemium-план + даты активации/окончания.

Обратная совместимость: ВСЕ существующие организации получают plan='legacy'
(полный доступ навсегда), новые — 'free' (server_default).

Порядок безопасный: ADD COLUMN nullable → UPDATE существующих в 'legacy' →
ALTER NOT NULL + server_default 'free'. Тип — String(16) (в проекте нет нативных
DB-enum, как и у users.role); допустимые значения форсятся в коде (PlanEnum).

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa


revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("plan", sa.String(length=16), nullable=True))
    op.add_column(
        "organizations", sa.Column("plan_activated_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "organizations", sa.Column("plan_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    # Существующие компании → legacy (полный доступ навсегда).
    op.execute("UPDATE organizations SET plan = 'legacy' WHERE plan IS NULL")
    # Теперь делаем NOT NULL; новые строки по умолчанию 'free'.
    op.alter_column(
        "organizations",
        "plan",
        existing_type=sa.String(length=16),
        nullable=False,
        server_default="free",
    )


def downgrade() -> None:
    op.drop_column("organizations", "plan_expires_at")
    op.drop_column("organizations", "plan_activated_at")
    op.drop_column("organizations", "plan")
