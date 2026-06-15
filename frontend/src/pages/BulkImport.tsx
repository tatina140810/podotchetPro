/**
 * Массовый импорт исторических операций. Только admin.
 *
 * Excel-like таблица: тип / кто / сумма / валюта / категория|источник / дата.
 * Enter в любой ячейке последней строки добавляет новую строку.
 * Перед импортом — превью-сводка (сколько каких операций, сумма).
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import { useAuth, type UserOut } from "../context/AuthContext";
import { listColleagues } from "../api/users";
import { listDepartments, type Department } from "../api/departments";
import { EditExpenseModal } from "../components/EditExpenseModal";
import { EditIncomeModal } from "../components/EditIncomeModal";
import { EditTopUpModal } from "../components/EditTopUpModal";

type Op = "expense" | "income" | "topup";

interface Row {
  type: Op;
  user_id: string;            // employee для expense / получатель для topup / получатель для income
  department_id: string;      // подразделение — обязательно для expense/topup (income игнорирует)
  issued_by_id: string;       // только для topup — «кто выдал». Пустое = текущий admin.
  amount: string;
  currency: "KGS" | "USD" | "RUB";
  category_id: string;        // для expense — id категории; для income/topup игнорируется
  source: string;             // для income — текстовое поле «Источник»; для остальных не используется
  comment: string;            // комментарий к записи — для всех типов
  date: string;               // YYYY-MM-DD
}

interface CategoryOpt { id: number; name: string; display_name?: string | null; parent_id?: number | null }

interface ImportError { index: number; error: string }
interface ImportResult { created: number; errors: ImportError[] }

const TYPE_LABEL: Record<Op, string> = {
  expense: "Расход",
  income: "Приход",
  topup: "Выдача",
};

const TYPE_ICON: Record<Op, string> = {
  expense: "",
  income: "",
  topup: "",
};

function makeEmptyRow(): Row {
  return {
    type: "expense",
    user_id: "",
    department_id: "",
    issued_by_id: "",
    amount: "",
    currency: "KGS",
    category_id: "",
    source: "",
    comment: "",
    date: new Date().toISOString().slice(0, 10),
  };
}

export default function BulkImport() {
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const [rows, setRows] = useState<Row[]>([makeEmptyRow()]);
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    listColleagues().then(setColleagues).catch(() => {});
    api<CategoryOpt[]>("/api/categories").then(setCategories).catch(() => {});
    listDepartments().then(setDepartments).catch(() => {});
  }, []);

  // Защита: страница только для admin / superadmin
  if (user && user.role !== "admin" && user.role !== "superadmin") {
    return (
      <div className="container">
        <div className="card" style={{ color: "var(--danger)" }}>
          Доступно только администратору организации.
        </div>
      </div>
    );
  }

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRow(idx: number) {
    setRows((prev) => (prev.length === 1 ? [makeEmptyRow()] : prev.filter((_, i) => i !== idx)));
  }

  function addRow() {
    setRows((prev) => [...prev, makeEmptyRow()]);
  }

  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    // Enter в любой ячейке последней строки → добавить новую.
    if (e.key === "Enter" && idx === rows.length - 1) {
      e.preventDefault();
      addRow();
    }
  }

  // Сводка: количество и общая сумма (по amount, без конвертации — превью)
  const summary = useMemo(() => {
    const counts: Record<Op, number> = { expense: 0, income: 0, topup: 0 };
    let total = 0;
    for (const r of rows) {
      const amt = parseFloat(r.amount.replace(",", "."));
      if (!isFinite(amt) || amt <= 0) continue;
      if (!r.user_id) continue;
      // Подразделение обязательно для расходов и выдач (у прихода его нет).
      if ((r.type === "expense" || r.type === "topup") && !r.department_id) continue;
      counts[r.type] += 1;
      if (r.currency === "KGS") total += amt;
    }
    return { counts, total, validCount: counts.expense + counts.income + counts.topup };
  }, [rows]);

  function buildPayload() {
    const items = rows
      .map((r) => {
        const amount = parseFloat(r.amount.replace(",", "."));
        if (!isFinite(amount) || amount <= 0) return null;
        if (!r.user_id) return null;
        if ((r.type === "expense" || r.type === "topup") && !r.department_id) return null;
        const base = {
          type: r.type,
          amount,
          currency: r.currency,
          date: r.date ? new Date(r.date).toISOString() : null,
        } as any;
        if (r.type === "expense") {
          base.user_id = Number(r.user_id);
          base.department_id = Number(r.department_id);
          base.category_id = r.category_id ? Number(r.category_id) : null;
          base.description = r.comment || null;
        } else if (r.type === "income") {
          base.received_by_id = Number(r.user_id);
          base.source = r.source || "—";
          base.description = r.comment || null;
        } else {
          base.user_id = Number(r.user_id);
          base.department_id = Number(r.department_id);
          base.note = r.comment || null;
          if (r.issued_by_id) base.issued_by_id = Number(r.issued_by_id);
          if (r.category_id) base.category_id = Number(r.category_id);
        }
        return base;
      })
      .filter(Boolean);
    return { items };
  }

  async function doImport() {
    const payload = buildPayload();
    if (payload.items.length === 0) {
      toast.show("error", "Нет валидных строк для импорта");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<ImportResult>("/api/admin/bulk-import", {
        method: "POST",
        body: payload,
      });
      setResult(res);
      setShowConfirm(false);
      if (res.errors.length === 0) {
        toast.show("success", `Импортировано: ${res.created}`);
        setRows([makeEmptyRow()]);
      } else {
        toast.show(
          "info" as any,
          `Импортировано: ${res.created}. Ошибок: ${res.errors.length} (см. ниже)`
        );
      }
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка импорта");
    } finally { setSubmitting(false); }
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 16 }}>
        <h1 className="h1" style={{ margin: 0 }}>Импорт истории</h1>
        <div className="row" style={{ gap: 8 }}>
          <DuplicatesButton />
          <button className="ghost" onClick={() => nav(-1)}>← Назад</button>
        </div>
      </div>
      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Массово внести исторические операции. Все записи будут помечены: «внёс {user?.name}».
        Enter в последней строке — новая строка. Tab — следующая ячейка.
        Для «Выдача» в колонке «Категория / Источник» выбирается <strong>кто выдал</strong> —
        по умолчанию вы, но можно указать другого сотрудника (для исторических выдач).
      </div>

      <div className="card" style={{ overflow: "auto", padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Тип</th>
              <th style={{ width: 170 }}>Кто / Кому</th>
              <th style={{ width: 160 }}>Подразделение</th>
              <th style={{ width: 170, textAlign: "right" }}>Сумма</th>
              <th style={{ width: 90 }}>Валюта</th>
              <th style={{ width: 180 }}>Категория / Источник</th>
              <th style={{ width: 220 }}>Комментарий</th>
              <th style={{ width: 130 }}>Дата</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td>
                  <select
                    value={r.type}
                    onChange={(e) => updateRow(idx, { type: e.target.value as Op })}
                    onKeyDown={(e) => onKeyDown(e, idx)}
                  >
                    <option value="expense">Расход</option>
                    <option value="income">Приход</option>
                    <option value="topup">Выдача</option>
                  </select>
                </td>
                <td>
                  <select
                    value={r.user_id}
                    onChange={(e) => updateRow(idx, { user_id: e.target.value })}
                    onKeyDown={(e) => onKeyDown(e, idx)}
                  >
                    <option value="">— выбрать —</option>
                    {colleagues.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {r.type === "income" ? (
                    <span className="muted" style={{ fontSize: 12 }}>—</span>
                  ) : (
                    <select
                      value={r.department_id}
                      onChange={(e) => updateRow(idx, { department_id: e.target.value })}
                      onKeyDown={(e) => onKeyDown(e, idx)}
                      style={!r.department_id ? { borderColor: "var(--danger)" } : undefined}
                      title="Подразделение (обязательно)"
                    >
                      <option value="">— подразделение —</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  <input
                    type="number" min="0.01" step="0.01"
                    value={r.amount}
                    onChange={(e) => updateRow(idx, { amount: e.target.value })}
                    onKeyDown={(e) => onKeyDown(e, idx)}
                    style={{ textAlign: "right" }}
                  />
                </td>
                <td>
                  <select
                    value={r.currency}
                    onChange={(e) => updateRow(idx, { currency: e.target.value as "KGS" | "USD" | "RUB" })}
                    onKeyDown={(e) => onKeyDown(e, idx)}
                  >
                    <option value="KGS">KGS</option>
                    <option value="USD">USD</option>
                    <option value="RUB">RUB</option>
                  </select>
                </td>
                <td>
                  {r.type === "expense" && (
                    <select
                      value={r.category_id}
                      onChange={(e) => updateRow(idx, { category_id: e.target.value })}
                      onKeyDown={(e) => onKeyDown(e, idx)}
                    >
                      <option value="">— категория —</option>
                      {categories.map((c: any) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
                    </select>
                  )}
                  {r.type === "income" && (
                    <input
                      value={r.source}
                      onChange={(e) => updateRow(idx, { source: e.target.value })}
                      onKeyDown={(e) => onKeyDown(e, idx)}
                      placeholder="Источник (кредит, клиент...)"
                    />
                  )}
                  {r.type === "topup" && (
                    <div className="grid" style={{ gap: 4 }}>
                      <select
                        value={r.category_id}
                        onChange={(e) => updateRow(idx, { category_id: e.target.value })}
                        onKeyDown={(e) => onKeyDown(e, idx)}
                        title="Категория выдачи (необязательно)"
                      >
                        <option value="">— категория —</option>
                        {categories.map((c: any) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
                      </select>
                      <select
                        value={r.issued_by_id}
                        onChange={(e) => updateRow(idx, { issued_by_id: e.target.value })}
                        onKeyDown={(e) => onKeyDown(e, idx)}
                        title="Кто выдал (если не указать — вы)"
                        style={{ fontSize: 12 }}
                      >
                        <option value="">Выдал: я ({user?.name})</option>
                        {colleagues.map((u) => (
                          <option key={u.id} value={u.id}>Выдал: {u.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </td>
                <td>
                  <input
                    value={r.comment}
                    onChange={(e) => updateRow(idx, { comment: e.target.value })}
                    onKeyDown={(e) => onKeyDown(e, idx)}
                    placeholder="напр. «Аренда Q1»"
                  />
                </td>
                <td>
                  <input
                    type="date"
                    value={r.date}
                    onChange={(e) => updateRow(idx, { date: e.target.value })}
                    onKeyDown={(e) => onKeyDown(e, idx)}
                  />
                </td>
                <td>
                  <button
                    type="button" className="ghost" onClick={() => removeRow(idx)}
                    style={{ padding: "4px 8px", fontSize: 14 }}
                    title="Удалить строку"
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: 10 }}>
          <button type="button" className="ghost" onClick={addRow}>+ Добавить строку</button>
        </div>
      </div>

      <div className="row between" style={{ marginTop: 16, flexWrap: "wrap", gap: 10 }}>
        <div className="muted" style={{ fontSize: 13 }}>
          Валидных строк: <strong>{summary.validCount}</strong>
          {" · "}
          {summary.counts.expense} · {summary.counts.income} · {summary.counts.topup}
          {" · "}
          сумма (KGS): <strong>{summary.total.toLocaleString("ru-RU")}</strong>
        </div>
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          disabled={submitting || summary.validCount === 0}
        >
          Импортировать всё
        </button>
      </div>

      {/* Превью-подтверждение */}
      {showConfirm && (
        <div onClick={() => setShowConfirm(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, width: "100%" }}>
            <h2 className="h2">Подтвердите импорт</h2>
            <div style={{ marginBottom: 12 }}>
              Будет создано:
              <ul style={{ marginTop: 6, paddingLeft: 20 }}>
                <li>расходов: <strong>{summary.counts.expense}</strong></li>
                <li>приходов: <strong>{summary.counts.income}</strong></li>
                <li>выдач: <strong>{summary.counts.topup}</strong></li>
              </ul>
              На сумму (KGS): <strong>{summary.total.toLocaleString("ru-RU")} сом</strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                USD/RUB-операции пересчитаются по текущему курсу при импорте.
                Все записи будут помечены: внёс {user?.name}.
              </div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button className="ghost" onClick={() => setShowConfirm(false)}>Отмена</button>
              <button onClick={doImport} disabled={submitting}>
                {submitting ? "Импортирую..." : "Подтвердить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Результат импорта */}
      {result && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 className="h2">Результат</h2>
          <div style={{ color: "var(--success)" }}>Создано: {result.created}</div>
          {result.errors.length > 0 && (
            <>
              <div style={{ marginTop: 10, color: "var(--danger)" }}>
                Ошибки ({result.errors.length}):
              </div>
              <ul style={{ paddingLeft: 20 }}>
                {result.errors.map((er) => (
                  <li key={er.index} style={{ fontSize: 13 }}>
                    Строка {er.index + 1}: {er.error}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
            <button className="ghost" onClick={() => setResult(null)}>Закрыть</button>
          </div>
        </div>
      )}

      <RecentOperations reloadKey={result?.created || 0} colleagues={colleagues} categories={categories} departments={departments} />
    </div>
  );
}

interface RecentOp {
  kind: "expense" | "income" | "topup" | "request";
  id: number;
  date: string;
  who: string | null;
  amount: number;
  currency: string;
  description?: string | null;
  source?: string | null;
  note?: string | null;
  category_name?: string | null;
  category_id?: number | null;
  issued_by?: string | null;
  issued_by_id?: number | null;
  employee_id?: number | null;
  received_by_id?: number | null;
  user_id?: number | null;
  status?: string;
}

interface DuplicatePair {
  topup: {
    id: number; date: string; issued_by: string | null; receiver: string | null;
    amount: number; currency: string; note: string | null; category_name: string | null;
  };
  expense: {
    id: number; date: string; employee: string | null;
    amount: number; currency: string; description: string | null; category_name: string | null;
  };
  days_diff: number;
  amount_diff_pct: number;
}

function DuplicatesButton() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null);
  const [fixing, setFixing] = useState<number | null>(null);

  async function find() {
    setLoading(true);
    try {
      const r = await api<{ pairs: DuplicatePair[] }>("/api/admin/find-duplicates", { method: "POST" });
      setPairs(r.pairs);
      setOpen(true);
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка поиска");
    } finally { setLoading(false); }
  }

  async function fix(pair: DuplicatePair) {
    if (!confirm(
      `Удалить TopUp ${pair.topup.amount} ${pair.topup.currency} (${pair.topup.issued_by} → ${pair.topup.receiver}) ` +
      `и оставить Expense у ${pair.expense.employee}? Категория и note перенесутся в Expense.`
    )) return;
    setFixing(pair.topup.id);
    try {
      await api(`/api/admin/fix-duplicate/${pair.topup.id}?expense_id=${pair.expense.id}`, { method: "POST" });
      toast.show("success", "Дубль слит");
      setPairs((prev) => prev?.filter((p) => p.topup.id !== pair.topup.id) || null);
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally { setFixing(null); }
  }

  return (
    <>
      <button type="button" className="ghost" onClick={find} disabled={loading}>
        {loading ? "..." : "Найти дубли"}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: "100%", maxHeight: "85vh", overflow: "auto" }}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <h2 className="h2" style={{ margin: 0 }}>Потенциальные дубли TopUp + Expense</h2>
              <button className="ghost" onClick={() => setOpen(false)}>×</button>
            </div>
            {pairs && pairs.length === 0 && <div className="muted">Дублей не найдено ✓</div>}
            {pairs && pairs.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>TopUp (выдача)</th>
                    <th>Expense (расход)</th>
                    <th>Δ дней</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p) => (
                    <tr key={`${p.topup.id}-${p.expense.id}`}>
                      <td style={{ fontSize: 12 }}>
                        <div><b>{p.topup.amount.toLocaleString("ru-RU")} {p.topup.currency}</b></div>
                        <div>{p.topup.issued_by} → {p.topup.receiver}</div>
                        <div className="muted">{p.topup.date.slice(0, 10)} · {p.topup.category_name || "—"}</div>
                        <div className="muted">{p.topup.note || ""}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        <div><b>{p.expense.amount.toLocaleString("ru-RU")} {p.expense.currency}</b></div>
                        <div>{p.expense.employee}</div>
                        <div className="muted">{p.expense.date.slice(0, 10)} · {p.expense.category_name || "—"}</div>
                        <div className="muted">{p.expense.description || ""}</div>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{p.days_diff} дн.</td>
                      <td>
                        <button onClick={() => fix(p)} disabled={fixing === p.topup.id}>
                          {fixing === p.topup.id ? "..." : "Слить (удалить TopUp)"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
              Поиск: пары где user (получатель TopUp = employee Expense), валюта совпадает,
              сумма ±1%, дата в пределах ±3 дней.
              При «Слить» переносится category_id и note из TopUp в Expense, TopUp удаляется.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RecentOperations({ reloadKey, colleagues, categories, departments }: { reloadKey: number; colleagues: UserOut[]; categories: CategoryOpt[]; departments: Department[] }) {
  const toast = useToast();
  const PAGE_SIZE = 30;
  const [ops, setOps] = useState<RecentOp[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  const [editing, setEditing] = useState<RecentOp | null>(null);

  // Фильтры
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);  // 0-indexed

  // Выбранные через чекбоксы — сохраняются между страницами. Ключ "kind-id".
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Метаданные выбранных строк (amount/currency/kind) — нужны для расчёта суммы,
  // т.к. при смене страницы строка может выпасть из текущего `ops`.
  const [selectedMeta, setSelectedMeta] = useState<Record<string, { amount: number; currency: string }>>({});

  // Совпадения сотрудников по строке поиска (показываем когда печатают)
  const employeeMatches = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    if (!q || employeeId !== null) return [];
    return colleagues.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 10);
  }, [employeeQuery, employeeId, colleagues]);

  // Загрузка с фильтрами + дебаунс для текстовых/числовых полей
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams();
      qs.set("limit", String(PAGE_SIZE));
      qs.set("offset", String(page * PAGE_SIZE));
      if (employeeId !== null) qs.set("employee_id", String(employeeId));
      if (categoryId !== null) qs.set("category_id", String(categoryId));
      if (departmentId !== null) qs.set("department_id", String(departmentId));
      // Нормализуем: убираем пробелы (включая неразрывный 00A0) и заменяем запятую на точку.
      // Без этого "20 000" → parseFloat → 20, и фильтр пропускал записи <20k.
      const norm = (s: string) => s.replace(/[\s ]/g, "").replace(",", ".");
      const amtMin = parseFloat(norm(amountMin));
      const amtMax = parseFloat(norm(amountMax));
      if (isFinite(amtMin) && amtMin > 0) qs.set("amount_min", String(amtMin));
      if (isFinite(amtMax) && amtMax > 0) qs.set("amount_max", String(amtMax));
      if (dateFrom) qs.set("date_from", new Date(dateFrom).toISOString());
      if (dateTo) qs.set("date_to", new Date(dateTo).toISOString());

      setOps(null);
      setErr(null);
      api<{ items: RecentOp[]; total: number; has_more: boolean }>(
        `/api/admin/recent-operations?${qs.toString()}`
      )
        .then((r) => { setOps(r.items); setTotal(r.total); })
        .catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [reloadKey, bump, page, employeeId, categoryId, departmentId, amountMin, amountMax, dateFrom, dateTo]);

  // При смене фильтров — сбросить пагинацию на первую страницу
  useEffect(() => { setPage(0); }, [employeeId, categoryId, departmentId, amountMin, amountMax, dateFrom, dateTo, reloadKey, bump]);

  const KIND_LABEL: Record<string, string> = {
    expense: "Расход",
    income: "Приход",
    topup: "Выдача",
    request: "Заявка",
  };

  async function onDelete(o: RecentOp) {
    const desc = `${o.amount.toLocaleString("ru-RU")} ${o.currency} · ${o.description || o.note || o.source || "—"}`;
    if (!confirm(`Удалить ${KIND_LABEL[o.kind]}: ${desc}?\nДействие необратимо.`)) return;
    try {
      if (o.kind === "expense") {
        await api(`/api/expenses/${o.id}`, { method: "DELETE" });
      } else if (o.kind === "income") {
        await api(`/api/incomes/${o.id}`, { method: "DELETE" });
      } else if (o.kind === "request") {
        await api(`/api/requests/${o.id}`, { method: "DELETE" });
      } else {
        await api(`/api/users/topups/${o.id}`, { method: "DELETE" });
      }
      toast.show("success", "Удалено");
      setBump((x) => x + 1);
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    }
  }

  function toggleSelect(o: RecentOp) {
    const key = `${o.kind}-${o.id}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSelectedMeta((prev) => {
      if (prev[key]) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: { amount: o.amount, currency: o.currency } };
    });
  }

  function resetFilters() {
    setEmployeeQuery(""); setEmployeeId(null);
    setCategoryId(null);
    setDepartmentId(null);
    setAmountMin(""); setAmountMax("");
    setDateFrom(""); setDateTo("");
  }
  function clearSelected() { setSelected(new Set()); setSelectedMeta({}); }

  // Сумма выбранных строк, сгруппированная по валюте
  const selectedTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const meta of Object.values(selectedMeta)) {
      m[meta.currency] = (m[meta.currency] || 0) + meta.amount;
    }
    return m;
  }, [selectedMeta]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const employeeName = employeeId !== null ? (colleagues.find((c) => c.id === employeeId)?.name || "") : "";

  return (
    <div className="card" style={{ marginTop: 24, paddingBottom: selected.size > 0 ? 96 : undefined }}>
      <div className="row between" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <h2 className="h2" style={{ margin: 0 }}>Последние операции</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {ops ? `Стр ${page + 1} из ${totalPages} · всего ${total}` : "загрузка…"}
        </span>
      </div>

      {/* Фильтры */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 12 }}>
        <div style={{ position: "relative" }}>
          <label>Сотрудник</label>
          <input
            value={employeeId !== null ? employeeName : employeeQuery}
            onChange={(e) => { setEmployeeQuery(e.target.value); setEmployeeId(null); }}
            placeholder="Имя…"
          />
          {employeeMatches.length > 0 && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
              background: "#1a1f2e", border: "1px solid var(--border)", borderRadius: 8,
              marginTop: 2, maxHeight: 220, overflow: "auto",
            }}>
              {employeeMatches.map((c) => (
                <div
                  key={c.id}
                  onClick={() => { setEmployeeId(c.id); setEmployeeQuery(""); }}
                  style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <label>Категория</label>
          <select value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Все</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.display_name || c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Подразделение</label>
          <select value={departmentId ?? ""} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Все</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Сумма от</label>
          <input value={amountMin} onChange={(e) => setAmountMin(e.target.value)} inputMode="decimal" placeholder="0" />
        </div>
        <div>
          <label>Сумма до</label>
          <input value={amountMax} onChange={(e) => setAmountMax(e.target.value)} inputMode="decimal" placeholder="∞" />
        </div>
        <div>
          <label>С даты</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label>По дату</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button type="button" className="ghost" onClick={resetFilters} style={{ width: "100%" }}>Сбросить</button>
        </div>
      </div>

      {err && <div style={{ color: "var(--danger)", fontSize: 13 }}>Ошибка: {err}</div>}
      {!ops && !err && <div className="muted">Загрузка...</div>}
      {ops && ops.length === 0 && <div className="muted">Ничего не найдено</div>}
      {ops && ops.length > 0 && (
        <div style={{ overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th style={{ width: 110 }}>Дата</th>
                <th style={{ width: 100 }}>Тип</th>
                <th>Кто / Кому</th>
                <th style={{ textAlign: "right" }}>Сумма</th>
                <th>Категория / Источник</th>
                <th>Комментарий</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {ops.map((o) => {
                const key = `${o.kind}-${o.id}`;
                const isSelected = selected.has(key);
                return (
                <tr key={key} style={isSelected ? { background: "rgba(37,99,235,0.08)" } : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(o)}
                      style={{ width: "auto", margin: 0, cursor: "pointer" }}
                    />
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {new Date(o.date).toLocaleDateString("ru-RU")}
                  </td>
                  <td style={{ fontSize: 12 }}>{KIND_LABEL[o.kind] || o.kind}</td>
                  <td style={{ fontSize: 13 }}>
                    {o.kind === "topup" && o.issued_by ? `${o.issued_by} → ` : ""}
                    {o.kind === "request" && o.issued_by
                      ? `${o.who || "?"} → ${o.issued_by}`
                      : (o.who || "—")}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {o.amount.toLocaleString("ru-RU")} {o.currency}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {o.category_name || o.source || "—"}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {o.description || o.note || ""}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                      {o.kind !== "request" && (
                        <button
                          className="ghost"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => setEditing(o)}
                          title="Редактировать"
                        >Изм.</button>
                      )}
                      <button
                        className="danger"
                        style={{ padding: "4px 8px", fontSize: 12 }}
                        onClick={() => onDelete(o)}
                        title="Удалить"
                      >Удал.</button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>


          {/* Постраничная навигация */}
          {totalPages > 1 && (
            <div className="row" style={{ padding: 10, justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ← Назад
              </button>
              <span style={{ alignSelf: "center", fontSize: 13, padding: "0 8px" }}>
                Стр {page + 1} из {totalPages}
              </span>
              <button type="button" className="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                Вперёд →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sticky-плашка выбранных — через portal в body, чтобы не зависеть от родительских stacking contexts */}
      {selected.size > 0 && createPortal(
        <div style={{
          position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)",
          width: "calc(100% - 32px)", maxWidth: 1060, zIndex: 1000,
          padding: "12px 16px", borderRadius: 10,
          background: "rgba(20,28,48,0.96)", border: "1px solid rgba(37,99,235,0.6)",
          boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
          backdropFilter: "blur(8px)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexWrap: "wrap", gap: 8,
        }}>
          <div style={{ fontSize: 14, color: "#fff" }}>
            <b>Выбрано: {selected.size}</b>{" · "}
            {Object.entries(selectedTotals).map(([cur, sum], idx, arr) => (
              <span key={cur}>
                {sum.toLocaleString("ru-RU")} {cur}{idx < arr.length - 1 ? " · " : ""}
              </span>
            ))}
          </div>
          <button type="button" className="ghost" onClick={clearSelected} style={{ padding: "4px 12px", fontSize: 12 }}>
            Снять выделение
          </button>
        </div>,
        document.body
      )}

      {editing && editing.kind === "expense" && (
        <EditExpenseModal
          expense={{
            id: editing.id,
            amount: editing.amount,
            currency: editing.currency,
            category_id: editing.category_id ?? null,
            description: editing.description ?? null,
            spent_at: editing.date,
          }}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setBump((x) => x + 1); }}
        />
      )}
      {editing && editing.kind === "income" && editing.received_by_id != null && (
        <EditIncomeModal
          income={{
            id: editing.id,
            amount: editing.amount,
            currency: editing.currency,
            source: editing.source || "",
            description: editing.description ?? null,
            received_by_id: editing.received_by_id,
            date: editing.date,
          }}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setBump((x) => x + 1); }}
        />
      )}
      {editing && editing.kind === "topup" && editing.user_id != null && (
        <EditTopUpModal
          topup={{
            id: editing.id,
            org_id: 0,
            admin_id: editing.issued_by_id ?? 0,
            admin_name: editing.issued_by ?? null,
            user_id: editing.user_id,
            user_name: editing.who ?? null,
            amount: String(editing.amount),
            currency: editing.currency,
            amount_kgs: null,
            note: editing.note ?? null,
            date: editing.date,
            category_id: editing.category_id ?? null,
            category_name: editing.category_name ?? null,
            created_at: editing.date,
          }}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setBump((x) => x + 1); }}
        />
      )}
    </div>
  );
}
