/**
 * Панель «Одобрить с проверкой»: адресат сверяет и при необходимости правит
 * заявку прямо перед одобрением. Что исправлено здесь — то и уйдёт в заявку,
 * и в расход, который создаётся при одобрении (сервер применяет правки ДО
 * создания расхода).
 *
 * Сумма правится строками — итог считает сервер по той же формуле
 * (Σ сумма × количество), отдельного поля «итого» намеренно нет.
 */
import { useMemo, useState } from "react";
import { CategoryPicker, type CatOpt } from "./CategoryPicker";
import type { Department } from "../api/departments";
import type { ApproveEdits, MoneyRequest } from "../api/requests";

interface Row {
  id?: number;
  description: string;
  amount: string;
  quantity: string;
  category_id: string;
}

interface Props {
  req: MoneyRequest;
  cats: CatOpt[];
  departments: Department[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (edits: ApproveEdits) => void;
}

const CURRENCIES = ["KGS", "USD", "EUR", "RUB"];

export function ApproveRequestPanel({ req, cats, departments, busy, onCancel, onConfirm }: Props) {
  const [title, setTitle] = useState(req.title);
  const [currency, setCurrency] = useState(req.currency || "KGS");
  const [departmentId, setDepartmentId] = useState(req.department_id ? String(req.department_id) : "");
  const [asExpense, setAsExpense] = useState(req.is_expense_on_approve);
  const [expenseCat, setExpenseCat] = useState(req.expense_category_id ? String(req.expense_category_id) : "");
  const [rows, setRows] = useState<Row[]>(
    req.items.map((it) => ({
      id: it.id,
      description: it.description,
      amount: String(it.amount),
      quantity: String(it.quantity),
      category_id: it.category_id ? String(it.category_id) : "",
    })),
  );

  const total = useMemo(
    () => rows.reduce((sum, r) => {
      const a = parseFloat(r.amount.replace(",", "."));
      const q = parseInt(r.quantity, 10);
      return sum + (isFinite(a) && a > 0 && q > 0 ? a * q : 0);
    }, 0),
    [rows],
  );

  function patch(idx: number, p: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  }

  const problem =
    rows.length === 0
      ? "Оставьте хотя бы одну строку"
      : rows.some((r) => !r.description.trim())
        ? "У каждой строки должно быть описание"
        : rows.some((r) => !(parseFloat(r.amount.replace(",", ".")) > 0))
          ? "Сумма строки должна быть больше нуля"
          : asExpense && !expenseCat
            ? "Для заявки на расход выберите категорию"
            : !departmentId
              ? "Выберите подразделение"
              : null;

  function confirm() {
    onConfirm({
      title: title.trim(),
      currency,
      department_id: Number(departmentId),
      is_expense_on_approve: asExpense,
      expense_category_id: asExpense ? Number(expenseCat) : null,
      items: rows.map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        description: r.description.trim(),
        amount: r.amount.replace(",", "."),
        quantity: parseInt(r.quantity, 10) || 1,
        category_id: r.category_id ? Number(r.category_id) : null,
      })),
    });
  }

  return (
    <div className="card" style={{ marginTop: 12, borderLeft: "4px solid var(--success)" }}>
      <h2 className="h2" style={{ marginTop: 0 }}>Проверьте перед одобрением</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Исправленные значения сохранятся в заявке и будут использованы в расходе.
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div>
          <label>Название</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label>Валюта</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label>Подразделение</label>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">— выбрать —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 12 }}>
        <input
          type="checkbox"
          id="as-expense"
          checked={asExpense}
          onChange={(e) => setAsExpense(e.target.checked)}
          style={{ width: "auto", margin: 0 }}
        />
        <label htmlFor="as-expense" style={{ margin: 0 }}>Сразу оформить расходом</label>
      </div>
      {asExpense && (
        <div style={{ marginTop: 8, maxWidth: 280 }}>
          <label>Категория расхода</label>
          <CategoryPicker cats={cats} value={expenseCat} onChange={setExpenseCat} />
        </div>
      )}

      <h3 className="h2" style={{ fontSize: 15, marginTop: 16, marginBottom: 6 }}>Строки</h3>
      <div style={{ overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Описание</th>
              <th style={{ width: 170 }}>Категория</th>
              <th style={{ width: 80, textAlign: "right" }}>Кол-во</th>
              <th style={{ width: 120, textAlign: "right" }}>Сумма</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.id ?? `new-${idx}`}>
                <td><input value={r.description} onChange={(e) => patch(idx, { description: e.target.value })} /></td>
                <td>
                  <CategoryPicker
                    cats={cats}
                    value={r.category_id}
                    onChange={(id) => patch(idx, { category_id: id })}
                    compact
                  />
                </td>
                <td>
                  <input
                    type="number" min="1" step="1" value={r.quantity}
                    onChange={(e) => patch(idx, { quantity: e.target.value })}
                    style={{ textAlign: "right" }}
                  />
                </td>
                <td>
                  <input
                    type="number" min="0.01" step="0.01" value={r.amount}
                    onChange={(e) => patch(idx, { amount: e.target.value })}
                    style={{ textAlign: "right" }}
                  />
                </td>
                <td>
                  <button
                    type="button" className="ghost" title="Убрать строку"
                    style={{ padding: "4px 8px" }}
                    onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ textAlign: "right", fontWeight: 600 }}>Итого:</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>
                {total.toLocaleString("ru-RU")} {currency}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <button
        type="button" className="ghost" style={{ marginTop: 8 }}
        onClick={() => setRows((prev) => [...prev, { description: "", amount: "", quantity: "1", category_id: "" }])}
      >
        + Добавить строку
      </button>

      {problem && (
        <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{problem}</div>
      )}

      <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        <button className="success" onClick={confirm} disabled={busy || !!problem}>
          {busy ? "Одобряю..." : "Одобрить"}
        </button>
      </div>
    </div>
  );
}
