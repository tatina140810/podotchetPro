"""users.is_confidential — конфиденциальный сотрудник (Билим).

Аддитивная миграция: ADD COLUMN NOT NULL DEFAULT false (существующие строки → false).
Роль `superadmin` НЕ требует DB-миграции — users.role это свободный String(20)
без ENUM/CHECK. Флаги конкретным пользователям (роль Татины, is_confidential Билима)
ставятся отдельным подтверждённым SQL — НЕ в миграции.

Revision ID: d4a8b2c1f9e3
Revises: c2f9a1b4e7d8
Create Date: 2026-06-15
"""
from alembic import op
import sqlalchemy as sa


revision = "d4a8b2c1f9e3"
down_revision = "c2f9a1b4e7d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_confidential",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "is_confidential")
