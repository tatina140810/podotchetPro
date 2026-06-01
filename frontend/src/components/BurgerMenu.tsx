import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth, isDirectorOrAuditor } from "../context/AuthContext";

export function BurgerMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!user) return null;

  // Передача денег — теперь часть формы расхода (переключатель в /expenses/new),
  // отдельный пункт меню убран.
  // «Сотрудники» убрано у gen_director (директор сам никого не заводит).
  //   Для admin и auditor — оставлено (admin создаёт/редактирует, auditor смотрит).
  // «+ Расход / Передача» убрано у всех — форма встроена сверху страницы расходов.
  // «Категории» и «Импорт истории» — только admin.
  const items = isDirectorOrAuditor(user.role)
    ? [
        { to: "/", label: "Отчёт по категориям" },
        { to: "/reports/employees", label: "Отчёт по сотрудникам" },
        // «Приходы» — только admin и gen_director (НЕ аудитору)
        ...(user.role !== "auditor" ? [{ to: "/reports/incomes", label: "Приходы" }] : []),
        { to: "/requests", label: "Заявки" },
        { to: "/expenses", label: "Расходы" },
        ...(user.role !== "gen_director" ? [{ to: "/employees", label: "Сотрудники" }] : []),
        ...(user.role === "admin"
          ? [
              { to: "/categories", label: "Категории" },
              { to: "/admin/bulk-import", label: "Импорт истории" },
            ]
          : []),
      ]
    : [
        { to: "/", label: "Главная" },
        { to: "/my-expenses", label: "Мои расходы" },
        { to: "/my-history", label: "Моя история" },
        { to: "/requests", label: "Заявки" },
        { to: "/my-subordinates", label: "Мои подотчётные" },
      ];

  return (
    <>
      <button
        type="button"
        className="burger-btn"
        aria-label="Открыть меню"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span />
        <span />
        <span />
      </button>

      {open && (
        <div
          className="burger-overlay"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`burger-drawer${open ? " open" : ""}`}
        aria-hidden={!open}
      >
        <div className="burger-drawer-header">
          <span className="burger-drawer-title">Меню</span>
          <button
            type="button"
            className="burger-close"
            aria-label="Закрыть меню"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        <nav className="burger-nav">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end
              className={({ isActive }) => (isActive ? "active" : "")}
              onClick={() => setOpen(false)}
            >
              {it.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
