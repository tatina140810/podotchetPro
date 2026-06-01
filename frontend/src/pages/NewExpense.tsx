/**
 * Полностраничная обёртка над NewExpenseForm — для роута /expenses/new.
 * Сейчас в меню не используется (форма встроена в /expenses и /my-expenses),
 * но роут оставлен для совместимости с прямыми ссылками.
 */
import { useNavigate } from "react-router-dom";
import { NewExpenseForm } from "../components/NewExpenseForm";
import { isDirectorOrAuditor, useAuth } from "../context/AuthContext";

export default function NewExpense() {
  const nav = useNavigate();
  const { user: me } = useAuth();

  function backToList() {
    nav(me && isDirectorOrAuditor(me.role) ? "/expenses" : "/my-expenses");
  }

  return (
    <div className="container">
      <h1 className="h1">Новая операция</h1>
      <NewExpenseForm onSaved={backToList} onCancel={() => nav(-1)} />
    </div>
  );
}
