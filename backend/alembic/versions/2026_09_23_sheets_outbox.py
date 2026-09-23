"""Очередь выгрузки операций в Google-таблицу «Локомотив» (outbox).

Запись в очередь создаётся в ТОЙ ЖЕ транзакции, что и сама операция; отправкой
занимается отдельный воркер (scripts/sheets_outbox_worker.py). Так внешний вызов
не участвует в транзакции БД: сеть отвалилась — операция всё равно сохранена,
строка уйдёт следующей попыткой.

Идемпотентность: UNIQUE (entity_type, entity_id) — одна операция = одна строка
в Google-таблице, повторный запуск воркера не дублирует.
"""
from alembic import op
import sqlalchemy as sa

revision = "c8e4b2a7f513"
down_revision = "b3f9c1d5a204"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sheets_outbox",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        # expense | income | topup
        sa.Column("entity_type", sa.String(length=16), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        # Лист назначения: bank (безнал) | cash (наличные) | salary (зарплата)
        sa.Column("sheet", sa.String(length=16), nullable=False),
        sa.Column("op_date", sa.DateTime(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        # pending | sent | skipped | failed
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("entity_type", "entity_id", name="uq_sheets_outbox_entity"),
        sa.CheckConstraint("sheet IN ('bank','cash','salary')", name="ck_sheets_outbox_sheet"),
        sa.CheckConstraint("status IN ('pending','sent','skipped','failed')",
                           name="ck_sheets_outbox_status"),
    )
    op.create_index("ix_sheets_outbox_status", "sheets_outbox", ["status"])


def downgrade() -> None:
    op.drop_index("ix_sheets_outbox_status", table_name="sheets_outbox")
    op.drop_table("sheets_outbox")
