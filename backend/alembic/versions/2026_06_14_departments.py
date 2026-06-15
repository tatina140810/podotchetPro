"""departments: новый уровень иерархии (Холдинг → Подразделения → Сотрудники/Категории → Расходы).

Аддитивная миграция:
  - новая таблица departments (UNIQUE org_id+name);
  - M2M employee_departments (сотрудник может быть в нескольких подразделениях);
  - nullable department_id на categories / expenses / balance_topups / money_requests.

Все department_id — DB-nullable: существующие записи остаются NULL ("Не указано"),
обязательность для НОВЫХ записей форсится на уровне API. Старые данные не трогаем.

Revision ID: c2f9a1b4e7d8
Revises: b1e7c4a90d62
Create Date: 2026-06-14
"""
from alembic import op
import sqlalchemy as sa


revision = "c2f9a1b4e7d8"
down_revision = "b1e7c4a90d62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- departments ---
    op.create_table(
        "departments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "name", name="uq_departments_org_name"),
    )
    op.create_index("ix_departments_org_id", "departments", ["org_id"])

    # --- M2M сотрудник <-> подразделение ---
    op.create_table(
        "employee_departments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["employee_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "employee_id", "department_id", name="uq_employee_departments_pair"
        ),
    )
    op.create_index(
        "ix_employee_departments_employee_id", "employee_departments", ["employee_id"]
    )
    op.create_index(
        "ix_employee_departments_department_id", "employee_departments", ["department_id"]
    )

    # --- nullable department_id на доменных таблицах ---
    # categories: NULL = общая категория для всех подразделений; SET NULL не сработает
    #   (удаление dept блокируется в API при наличии категорий), оставлено для подстраховки.
    op.add_column("categories", sa.Column("department_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_categories_department_id",
        "categories",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_categories_department_id", "categories", ["department_id"])

    # expenses / balance_topups / money_requests: для НОВЫХ записей обязательно (API),
    #   старые остаются NULL. RESTRICT — нельзя удалить dept с привязанными движениями.
    for table in ("expenses", "balance_topups", "money_requests"):
        op.add_column(table, sa.Column("department_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            f"fk_{table}_department_id",
            table,
            "departments",
            ["department_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        op.create_index(f"ix_{table}_department_id", table, ["department_id"])


def downgrade() -> None:
    for table in ("money_requests", "balance_topups", "expenses"):
        op.drop_index(f"ix_{table}_department_id", table_name=table)
        op.drop_constraint(f"fk_{table}_department_id", table, type_="foreignkey")
        op.drop_column(table, "department_id")

    op.drop_index("ix_categories_department_id", table_name="categories")
    op.drop_constraint("fk_categories_department_id", "categories", type_="foreignkey")
    op.drop_column("categories", "department_id")

    op.drop_index("ix_employee_departments_department_id", table_name="employee_departments")
    op.drop_index("ix_employee_departments_employee_id", table_name="employee_departments")
    op.drop_table("employee_departments")

    op.drop_index("ix_departments_org_id", table_name="departments")
    op.drop_table("departments")
