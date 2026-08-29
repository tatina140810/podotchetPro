import { useEffect, useMemo, useState } from "react";
import { api, downloadFile } from "../api/client";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { listTransfers, deleteTransfer, type MoneyTransfer } from "../api/transfers";
import { listMyIncomes, deleteIncome, type Income } from "../api/income";
import { deleteExpense } from "../api/expenses";
import { getCurrentRate } from "../api/exchange";
import { formatAmountWithEquivalent } from "../lib/format-currency";
import { NewExpenseForm } from "../components/NewExpenseForm";
import { ExpenseDetailModal } from "../components/ExpenseDetailModal";
import { EditExpenseModal } from "../components/EditExpenseModal";
import { EditIncomeModal } from "../components/EditIncomeModal";
import { EditTransferModal } from "../components/EditTransferModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { ExpenseCard, IncomeCard, TransferCard } from "../components/HistoryCards";

type FeedItem =
  | { kind: "expense"; date: string; data: any }
  | { kind: "income"; date: string; data: Income }
  | { kind: "transfer_out"; date: string; data: MoneyTransfer };

type DeleteTarget =
  | { kind: "expense"; data: any }
  | { kind: "income"; data: Income }
  | { kind: "transfer"; data: MoneyTransfer };

export default function MyExpenses() {
  const { user: me } = useAuth();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [transfers, setTransfers] = useState<MoneyTransfer[]>([]);
  const [usdKgs, setUsdKgs] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  const [editingTransfer, setEditingTransfer] = useState<MoneyTransfer | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function reload() {
    Promise.all([
      api<any[]>("/api/expenses").then(setExpenses),
      listMyIncomes().then(setIncomes),
      listTransfers().then(setTransfers),
    ]).catch(() => {});
  }

  useEffect(() => {
    Promise.all([
      api<any[]>("/api/expenses").then(setExpenses),
      listMyIncomes().then(setIncomes),
      listTransfers().then(setTransfers),
      getCurrentRate("USD", "KGS").then((r) => setUsdKgs(r.rate ? Number(r.rate) : null)).catch(() => {}),
    ]).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  // Лента: мои расходы + мои приходы (свои ручные и внесённые другими) + мои
  // ИСХОДЯЩИЕ передачи. Входящие передачи/пополнения тут не показываем — это не расход.
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    for (const e of expenses) items.push({ kind: "expense", date: e.spent_at, data: e });
    for (const inc of incomes) items.push({ kind: "income", date: inc.date, data: inc });
    for (const t of transfers) {
      if (me && t.from_user_id === me.id) items.push({ kind: "transfer_out", date: t.created_at, data: t });
    }
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  }, [expenses, incomes, transfers, me]);

  async function onExport() {
    setExporting(true);
    try {
      await downloadFile("/api/expenses/export.xlsx", "expenses.xlsx");
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось скачать файл");
    } finally {
      setExporting(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      if (deleting.kind === "expense") await deleteExpense(deleting.data.id);
      else if (deleting.kind === "income") await deleteIncome(deleting.data.id);
      else await deleteTransfer(deleting.data.id);
      toast.show("success", "Удалено");
      setDeleting(null);
      reload(); // обновляет и ленту, и (на страницах с балансом) сводку
    } catch (e: any) {
      // 403/409 — backend отдаёт человекочитаемый русский текст (в т.ч. про
      // «получатель уже израсходовал средства» для передачи).
      toast.show("error", e.message || "Не удалось удалить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Мои расходы</h1>
        <button type="button" onClick={onExport} disabled={exporting || expenses.length === 0}
          style={{ background: "#107C41", color: "#fff" }}>
          {exporting ? "Готовлю…" : "Excel"}
        </button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <NewExpenseForm onSaved={reload} compact />
      </div>

      <h2 className="h2">История</h2>
      <div className="grid" style={{ gap: 8 }}>
        {!loaded && <div className="muted">Загрузка...</div>}
        {loaded && feed.length === 0 && <div className="card muted">Пока пусто</div>}
        {feed.map((item) => {
          if (item.kind === "expense") {
            return (
              <ExpenseCard key={`e-${item.data.id}`} e={item.data} rate={usdKgs}
                mine={item.data.employee_id === me?.id}
                onOpen={() => setSelected(item.data)}
                onEdit={() => setEditing(item.data)}
                onDelete={() => setDeleting({ kind: "expense", data: item.data })} />
            );
          }
          if (item.kind === "income") {
            return (
              <IncomeCard key={`i-${item.data.id}`} inc={item.data} rate={usdKgs}
                mine={item.data.created_by_id === me?.id}
                onEdit={() => setEditingIncome(item.data)}
                onDelete={() => setDeleting({ kind: "income", data: item.data })} />
            );
          }
          return (
            <TransferCard key={`t-${item.data.id}`} t={item.data} rate={usdKgs}
              onEdit={() => setEditingTransfer(item.data)}
              onDelete={() => setDeleting({ kind: "transfer", data: item.data })} />
          );
        })}
      </div>

      {selected && (
        <ExpenseDetailModal expense={selected} usdKgs={usdKgs}
          canEdit={(selected.status === "pending" || selected.status === "rejected") && selected.employee_id === me?.id}
          canAttach={selected.employee_id === me?.id}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditing(selected); setSelected(null); }}
          onChanged={reload} />
      )}

      {editing && (
        <EditExpenseModal expense={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }} />
      )}

      {editingIncome && (
        <EditIncomeModal income={editingIncome} onClose={() => setEditingIncome(null)}
          onSaved={() => { setEditingIncome(null); reload(); }} />
      )}

      {editingTransfer && (
        <EditTransferModal transfer={editingTransfer} onClose={() => setEditingTransfer(null)}
          onSaved={() => { setEditingTransfer(null); reload(); }} />
      )}

      {deleting && (
        <ConfirmModal
          title={
            deleting.kind === "expense" ? "Удалить расход?"
              : deleting.kind === "income" ? "Удалить приход?" : "Отменить передачу?"
          }
          message={
            deleting.kind === "transfer"
              ? "Передача будет отменена, баланс отправителя и получателя вернутся к исходным."
              : "Действие можно будет отследить в истории изменений."
          }
          confirmLabel={deleting.kind === "transfer" ? "Отменить передачу" : "Удалить"}
          rows={deleteRows(deleting, usdKgs)}
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function deleteRows(t: DeleteTarget, rate: number | null): { label: string; value: string }[] {
  if (t.kind === "expense") {
    return [
      { label: "Сумма", value: formatAmountWithEquivalent(t.data.amount, t.data.currency || "KGS", rate) },
      { label: "Категория", value: t.data.category_name || "—" },
      { label: "Дата", value: new Date(t.data.spent_at).toLocaleDateString("ru-RU") },
      { label: "Описание", value: t.data.description || "—" },
    ];
  }
  if (t.kind === "income") {
    return [
      { label: "Сумма", value: formatAmountWithEquivalent(t.data.amount, t.data.currency || "KGS", rate) },
      { label: "Источник", value: t.data.source || "—" },
      { label: "Дата", value: new Date(t.data.date).toLocaleDateString("ru-RU") },
      { label: "Описание", value: t.data.description || "—" },
    ];
  }
  return [
    { label: "Сумма", value: formatAmountWithEquivalent(t.data.amount, "KGS", rate) },
    { label: "Получатель", value: t.data.to_user_name || "—" },
    { label: "Дата", value: new Date(t.data.created_at).toLocaleDateString("ru-RU") },
    { label: "Комментарий", value: t.data.note || "—" },
  ];
}
