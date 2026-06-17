"""income_sources (справочник источников дохода) + org.feature_flags + incomes.source_id.

Аддитивная миграция (ничего не ломает у существующих организаций):
  - новая таблица income_sources (UNIQUE org_id+name);
  - organizations.feature_flags — JSON nullable (тумблеры фич, NULL = дефолты);
  - incomes.source_id — nullable FK → income_sources (ON DELETE SET NULL); старые
    приходы остаются с NULL и работают через текстовый source.

Revision ID: e5b9d3a2c0f1
Revises: d4a8b2c1f9e3
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa


revision = "e5b9d3a2c0f1"
down_revision = "d4a8b2c1f9e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- справочник источников дохода ---
    op.create_table(
        "income_sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "name", name="uq_income_sources_org_name"),
    )
    op.create_index("ix_income_sources_org_id", "income_sources", ["org_id"])

    # --- тумблеры фич организации ---
    op.add_column(
        "organizations", sa.Column("feature_flags", sa.JSON(), nullable=True)
    )

    # --- ссылка прихода на справочник источников ---
    op.add_column("incomes", sa.Column("source_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_incomes_source_id",
        "incomes",
        "income_sources",
        ["source_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_incomes_source_id", "incomes", ["source_id"])


def downgrade() -> None:
    op.drop_index("ix_incomes_source_id", table_name="incomes")
    op.drop_constraint("fk_incomes_source_id", "incomes", type_="foreignkey")
    op.drop_column("incomes", "source_id")

    op.drop_column("organizations", "feature_flags")

    op.drop_index("ix_income_sources_org_id", table_name="income_sources")
    op.drop_table("income_sources")
