import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function TabBar() {
  const { user } = useAuth();
  if (!user) return null;

  const tabs = user.role === "admin"
    ? [
        { to: "/", label: "Главная" },
        { to: "/employees", label: "Сотрудники" },
        { to: "/expenses", label: "Расходы" },
        { to: "/categories", label: "Категории" },
        { to: "/reports", label: "Отчёты" },
      ]
    : [
        { to: "/", label: "Главная" },
        { to: "/my-expenses", label: "Мои расходы" },
        { to: "/expenses/new", label: "Добавить" },
      ];

  return (
    <nav className="tabbar">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end className={({ isActive }) => (isActive ? "active" : "")}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
