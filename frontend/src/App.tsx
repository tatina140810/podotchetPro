import { Navigate, Route, Routes, Link } from "react-router-dom";
import { useState } from "react";
import { useAuth, isDirectorOrAuditor } from "./context/AuthContext";
import { CurrencyProvider, CurrencyToggle } from "./context/CurrencyContext";
import { ToastProvider } from "./components/Toast";
import { BurgerMenu } from "./components/BurgerMenu";
import { PlanBadge } from "./components/PlanBadge";
import { UpgradeModalHost } from "./components/UpgradeModal";
import { usePlan } from "./api/plan";
import { NotificationBell } from "./components/NotificationBell";
import { ChatWidget } from "./components/chat/ChatWidget";
import { RateModal } from "./pages/Dashboard";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import MyDashboard from "./pages/MyDashboard";
import MySubordinates from "./pages/MySubordinates";
import Employees from "./pages/Employees";
import EmployeeCard from "./pages/EmployeeCard";
import EmployeeChain from "./pages/EmployeeChain";
import EmployeeSpec from "./pages/EmployeeSpec";
import NewAdvance from "./pages/Advances";
import Expenses from "./pages/Expenses";
import MyExpenses from "./pages/MyExpenses";
import MyHistory from "./pages/MyHistory";
import NewExpense from "./pages/NewExpense";
import BulkImport from "./pages/BulkImport";
import Categories from "./pages/Categories";
import Departments from "./pages/Departments";
import CategoryReport from "./pages/CategoryReport";
import EmployeesReport from "./pages/EmployeesReport";
import EmployeeProfile from "./pages/EmployeeProfile";
import ReportsDepartments from "./pages/ReportsDepartments";
import BalanceReport from "./pages/BalanceReport";
import IncomeReport from "./pages/IncomeReport";
import IncomeSources from "./pages/IncomeSources";
import Settings from "./pages/Settings";
import IssuedTopups from "./pages/IssuedTopups";
import Requests from "./pages/Requests";
import RecurringObligations from "./pages/RecurringObligations";
import RequestNew from "./pages/RequestNew";
import RequestDetail from "./pages/RequestDetail";
import Transfers from "./pages/Transfers";

function ProtectedShell({ children }: { children: React.ReactNode }) {
  const { user, org, logout, loading } = useAuth();
  const { planInfo } = usePlan(user?.org_id);
  if (loading) return <div className="container"><div className="muted">Загрузка...</div></div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <>
      <UpgradeModalHost />
      <header className="app-header">
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <BurgerMenu />
          <div className="brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src="/logo.png" alt="PodotchetPRO" style={{ height: 30, display: "block" }} />
            {org?.name ? <small>{org.name}</small> : null}
            <PlanBadge plan={planInfo?.plan} />
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {/* Тумблер валют влияет только на отчёты директора/аудитора.
              На экранах подотчётного суммы всегда в сомах — поэтому скрываем,
              чтобы кнопка не выглядела «нерабочей». */}
          {user.role !== "accountable" && <CurrencyToggle />}
          {(user.role === "admin" || user.role === "superadmin") && <RateButtonInHeader />}
          <NotificationBell />
          <span className="muted" style={{ fontSize: 13 }}>{user.name}</span>
          <button className="ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={logout}>Выйти</button>
        </div>
      </header>
      {children}
      <ChatWidget />
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <CurrencyProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="*" element={
            <ProtectedShell>
              <RoleRoutes />
            </ProtectedShell>
          } />
        </Routes>
      </CurrencyProvider>
    </ToastProvider>
  );
}

function LoginRoute() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

function RoleRoutes() {
  const { user } = useAuth();
  if (!user) return null;

  // admin / gen_director / auditor — полный набор
  if (isDirectorOrAuditor(user.role)) {
    return (
      <Routes>
        {/* Главная теперь = Отчёт по категориям. Старый дашборд доступен по /dashboard. */}
        <Route path="/" element={<CategoryReport />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/employees/:id" element={<EmployeeCard />} />
        <Route path="/employees/:id/chain" element={<EmployeeChain />} />
        <Route path="/employees/:id/spec" element={<EmployeeSpec />} />
        <Route path="/advances/new" element={<NewAdvance />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/expenses/new" element={<NewExpense />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/admin/departments" element={<Departments />} />
        <Route path="/admin/income-sources" element={<IncomeSources />} />
        <Route path="/admin/settings" element={<Settings />} />
        <Route path="/reports" element={<Navigate to="/" replace />} />
        <Route path="/reports/categories" element={<Navigate to="/" replace />} />
        <Route path="/reports/employees" element={<EmployeesReport />} />
        <Route path="/reports/employees/:id" element={<EmployeeProfile />} />
        <Route path="/reports/departments" element={<ReportsDepartments />} />
        <Route path="/reports/balance" element={<BalanceReport />} />
        <Route path="/reports/incomes" element={<IncomeReport />} />
        <Route path="/issued-topups" element={<IssuedTopups />} />
        <Route path="/admin/bulk-import" element={<BulkImport />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/requests/recurring" element={<RecurringObligations />} />
        <Route path="/requests/new" element={<RequestNew />} />
        <Route path="/requests/:id" element={<RequestDetail />} />
        <Route path="/transfers" element={<Transfers />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    );
  }
  // accountable
  return (
    <Routes>
      <Route path="/" element={<MyDashboard />} />
      <Route path="/my-expenses" element={<MyExpenses />} />
      <Route path="/my-history" element={<MyHistory />} />
      <Route path="/reports/employees/:id" element={<EmployeeProfile />} />
      <Route path="/expenses/new" element={<NewExpense />} />
      <Route path="/my-subordinates" element={<MySubordinates />} />
      <Route path="/employees/:id/chain" element={<EmployeeChain />} />
      <Route path="/requests" element={<Requests />} />
      <Route path="/requests/recurring" element={<RecurringObligations />} />
      <Route path="/requests/new" element={<RequestNew />} />
      <Route path="/requests/:id" element={<RequestDetail />} />
      <Route path="/transfers" element={<Transfers />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="container">
      <div className="card">Страница не найдена. <Link to="/">На главную</Link></div>
    </div>
  );
}

/** Кнопка «курс» в шапке — открывает RateModal. Только admin. */
function RateButtonInHeader() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="ghost"
        style={{ padding: "4px 10px", fontSize: 13 }}
        onClick={() => setOpen(true)}
        title="Курсы валют"
      >курс</button>
      {open && (
        <RateModal
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </>
  );
}
