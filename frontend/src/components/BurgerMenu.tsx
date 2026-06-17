import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth, isDirectorOrAuditor } from "../context/AuthContext";
import { useSettings } from "../context/SettingsContext";

export function BurgerMenu() {
  const { user } = useAuth();
  const { flag } = useSettings();
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
  // «Категории» и «Импорт истории» — admin и superadmin.
  // superadmin имеет полный admin-доступ ко всем пунктам.
  const isAdminLike = user.role === "admin" || user.role === "superadmin";
  const items = isDirectorOrAuditor(user.role)
    ? [
        { to: "/", label: "Отчёт по категориям" },
        { to: "/reports/employees", label: "Отчёт по сотрудникам" },
        { to: "/reports/departments", label: "Отчёт по подразделениям" },
        // «Приходы» — только admin/superadmin и gen_director (НЕ аудитору)
        ...(user.role !== "auditor" ? [{ to: "/reports/incomes", label: "Приходы" }] : []),
        { to: "/requests", label: "Заявки" },
        { to: "/requests/recurring", label: "Регулярные обязательства" },
        { to: "/expenses", label: "Расходы" },
        // «Подразделения» — admin/superadmin и auditor (управление иерархией).
        ...(isAdminLike || user.role === "auditor"
          ? [{ to: "/admin/departments", label: "Подразделения" }]
          : []),
        ...(user.role !== "gen_director" ? [{ to: "/employees", label: "Сотрудники" }] : []),
        ...(isAdminLike
          ? [
              { to: "/categories", label: "Категории" },
              // «Источники дохода» — справочник, виден только при включённой фиче.
              ...(flag("income_sources")
                ? [{ to: "/admin/income-sources", label: "Источники дохода" }]
                : []),
              { to: "/admin/bulk-import", label: "Импорт истории" },
            ]
          : []),
        // «Настройки» — только суперадмин (управление тумблерами фич).
        ...(user.role === "superadmin"
          ? [{ to: "/admin/settings", label: "Настройки" }]
          : []),
      ]
    : [
        { to: "/", label: "Главная" },
        { to: "/my-expenses", label: "Мои расходы" },
        { to: "/my-history", label: "Моя история" },
        { to: "/requests", label: "Заявки" },
        { to: "/requests/recurring", label: "Регулярные обязательства" },
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
