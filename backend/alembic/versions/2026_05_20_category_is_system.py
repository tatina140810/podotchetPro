"""categories.is_system — флаг системных категорий («Подотчёт»).

Revision ID: d3b5f8a91c40
Revises: e5b7d1a2c930
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa


revision = "d3b5f8a91c40"
down_revision = "e5b7d1a2c930"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("categories") as b:
        b.add_column(sa.Column(
            "is_system",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ))

    # Создаём системную категорию «Подотчёт» в каждой org, если её нет.
    conn = op.get_bind()
    conn.execute(sa.text("""
        INSERT INTO categories (org_id, name, is_active, is_operational, is_system)
        SELECT o.id, 'Подотчёт', true, false, true
        FROM organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM categories c
            WHERE c.org_id = o.id AND c.name = 'Подотчёт'
        );
    """))
    # Помечаем существующие «Подотчёт» как системные (если кто-то уже создал руками).
    conn.execute(sa.text(
        "UPDATE categories SET is_system = true WHERE name = 'Подотчёт';"
    ))


def downgrade() -> None:
    with op.batch_alter_table("categories") as b:
        b.drop_column("is_system")
