import { useEffect, useMemo, useState } from "react";
import { useToast } from "../components/Toast";
import {
  ExpectedIncome,
  ExpPeriodicity,
  EXP_PERIODICITY_RU,
  listExpected,
  createExpected,
  updateExpected,
  deleteExpected,
  receiveExpected,
} from "../api/expectedIncomes";

type Derived = "pending" | "received" | "overdue";
type Chip = "all" | "pending" | "received" | "overdue";

const CHIPS: { key: Chip; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "pending", label: "Ожидается" },
  { key: "received", label: "Получено" },
  { key: "overdue", label: "Просрочено" },
];

const PERIODS: ExpPeriodicity[] = ["one_time", "monthly", "weekly"];

function symFor(cur: string): string {
  return cur === "USD" ? "$" : cur === "EUR" ? "€" : cur === "RUB" ? "₽" : "с";
}
function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}

function derived(e: ExpectedIncome): Derived {
  if (e.status === "received") return "received";
  if (e.expected_date && new Date(e.expected_date) < new Date(new Date().toDateString())) return "overdue";
  return "pending";
}

interface FormState {
  id: number | null;
  name: string;
  amount: string;
  currency: "KGS" | "USD" | "EUR";
  expected_date: string;
  periodicity: ExpPeriodicity;
  comment: string;
}
const EMPTY: FormState = { id: null, name: "", amount: "", currency: "KGS", expected_date: "", periodicity: "one_time", comment: "" };

export function ExpectedIncomes({
  readOnly = false,
  userId,
  onConverted,
}: {
  readOnly?: boolean;
  userId?: number;
  onConverted?: () => void;
}) {
  const toast = useToast();
  const [list, setList] = useState<ExpectedIncome[] | null>(null);
  const [chip, setChip] = useState<Chip>("all");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  function reload() {
    listExpected(userId).then(setList).catch(() => setList([]));
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [userId]);

  const pending = useMemo(() => (list || []).filter((e) => e.status === "pending"), [list]);
  const reserveTotal = useMemo(
    () => pending.reduce((s, e) => s + Number(e.amount_kgs || 0), 0),
    [pending]
  );

  const shown = useMemo(() => {
    if (!list) return [];
    if (chip === "all") return list;
    return list.filter((e) => derived(e) === chip);
  }, [list, chip]);

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    const amount = parseFloat(form.amount.replace(",", "."));
    if (!name) { toast.show("error", "Укажите название"); return; }
    if (!isFinite(amount) || amount <= 0) { toast.show("error", "Сумма должна быть больше 0"); return; }
    setSaving(true);
    try {
      const payload = {
        name, amount, currency: form.currency,
        expected_date: form.expected_date ? new Date(form.expected_date).toISOString() : null,
        periodicity: form.periodicity, comment: form.comment.trim() || null,
      };
      if (form.id) await updateExpected(form.id, payload);
      else await createExpected(payload);
      toast.show("success", form.id ? "Сохранено" : "Пополнение добавлено");
      setForm(null);
      reload();
    } catch (e: any) {
      toast.show("error", e.message);
    } finally { setSaving(false); }
  }

  async function receive(e: ExpectedIncome) {
    const kgs = Number(e.amount_kgs || e.amount);
    if (!confirm(`Подтвердить получение? Сумма ${fmt(kgs)} с будет добавлена в Приходы`)) return;
    try {
      await receiveExpected(e.id);
      toast.show("success", "Добавлено в Приходы");
      reload();
      onConverted?.();
    } catch (err: any) {
      toast.show("error", err.message);
    }
  }

  async function remove(e: ExpectedIncome) {
    if (!confirm(`Удалить «${e.name}»? Это действие нельзя отменить`)) return;
    try { await deleteExpected(e.id); reload(); }
    catch (err: any) { toast.show("error", err.message); }
  }

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 16 }}>
        <div className="card">
          <div className="muted" style={{ fontSize: 12 }}>Всего ожидается</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{pending.length}</div>
        </div>
        <div className="card">
          <div className="muted" style={{ fontSize: 12 }}>Итого ожидается (с)</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: "var(--success)" }}>
            +{fmt(reserveTotal)} с
          </div>
        </div>
      </div>

      <div className="row between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {CHIPS.map((c) => (
            <button key={c.key} type="button"
              className={chip === c.key ? "" : "ghost"}
              style={{ padding: "4px 12px", fontSize: 13 }}
              onClick={() => setChip(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
        {!readOnly && <button onClick={() => setForm({ ...EMPTY })}>+ Добавить пополнение</button>}
      </div>

      {list === null && <div className="muted">Загрузка...</div>}
      {list && list.length === 0 && (
        <div className="card muted" style={{ padding: 20, textAlign: "center" }}>
          {readOnly ? "Нет ожидаемых пополнений." : "Добавьте суммы, которые ожидаете получить — отметите галочкой, когда придут."}
        </div>
      )}

      {list && list.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                {!readOnly && <th style={{ width: 36 }}></th>}
                <th>Название</th>
                <th style={{ textAlign: "right" }}>Сумма (исх.)</th>
                <th style={{ textAlign: "right" }}>В с</th>
                <th>Ожид. дата</th>
                <th>Периодичность</th>
                <th>Комментарий</th>
                {!readOnly && <th style={{ width: 120 }}></th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const d = derived(e);
                const rowStyle =
                  d === "received" ? { opacity: 0.55 } :
                  d === "overdue" ? { background: "rgba(255,193,7,0.12)" } : undefined;
                return (
                  <tr key={e.id} style={rowStyle}>
                    {!readOnly && (
                      <td style={{ textAlign: "center" }}>
                        {d === "received" ? (
                          <span title="Получено" style={{ color: "var(--success)" }}>✓</span>
                        ) : (
                          <input type="checkbox" checked={false} onChange={() => receive(e)} title="Отметить полученным" />
                        )}
                      </td>
                    )}
                    <td style={{ fontWeight: 600, textDecoration: d === "received" ? "line-through" : undefined }}>
                      {e.name}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(Number(e.amount))} {symFor(e.currency)}</td>
                    <td style={{ textAlign: "right", color: "var(--success)" }}>
                      {e.amount_kgs != null ? `${fmt(Number(e.amount_kgs))} с` : "—"}
                    </td>
                    <td className="muted" style={{ fontSize: 13, color: d === "overdue" ? "var(--danger)" : undefined }}>
                      {e.expected_date ? new Date(e.expected_date).toLocaleDateString("ru-RU") : "—"}
                    </td>
                    <td className="muted" style={{ fontSize: 13 }}>{EXP_PERIODICITY_RU[e.periodicity]}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{e.comment || ""}</td>
                    {!readOnly && (
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="ghost" style={{ padding: "4px 10px", fontSize: 13 }}
                          disabled={e.status === "received"}
                          title={e.status === "received" ? "Полученное нельзя редактировать" : "Изменить"}
                          onClick={() => setForm({
                            id: e.id, name: e.name, amount: String(e.amount), currency: e.currency,
                            expected_date: e.expected_date ? e.expected_date.slice(0, 10) : "",
                            periodicity: e.periodicity, comment: e.comment || "",
                          })}>
                          Изм.
                        </button>
                        <button className="danger" style={{ padding: "4px 10px", fontSize: 13, marginLeft: 6 }}
                          onClick={() => remove(e)}>Удал.</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={readOnly ? 6 : 8} className="muted" style={{ padding: 14 }}>Нет записей с этим статусом</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div onClick={() => setForm(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div className="card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 460, width: "100%" }}>
            <h2 className="h2">{form.id ? "Изменить пополнение" : "Новое пополнение"}</h2>
            <form onSubmit={(ev) => { ev.preventDefault(); save(); }} className="grid">
              <div>
                <label>Название</label>
                <input value={form.name} autoFocus required
                  onChange={(ev) => setForm({ ...form, name: ev.target.value })}
                  placeholder="Например: Ежемесячный доход" />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 2 }}>
                  <label>Сумма</label>
                  <input value={form.amount} inputMode="decimal" required
                    onChange={(ev) => setForm({ ...form, amount: ev.target.value })} />
                </div>
                <div style={{ flex: 1, minWidth: 90 }}>
                  <label>Валюта</label>
                  <select value={form.currency}
                    onChange={(ev) => setForm({ ...form, currency: ev.target.value as "KGS" | "USD" | "EUR" })}>
                    <option value="KGS">KGS — с</option>
                    <option value="USD">USD — $</option>
                    <option value="EUR">EUR — €</option>
                  </select>
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label>Ожидаемая дата</label>
                  <input type="date" value={form.expected_date}
                    onChange={(ev) => setForm({ ...form, expected_date: ev.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Периодичность</label>
                  <select value={form.periodicity}
                    onChange={(ev) => setForm({ ...form, periodicity: ev.target.value as ExpPeriodicity })}>
                    {PERIODS.map((p) => <option key={p} value={p}>{EXP_PERIODICITY_RU[p]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label>Комментарий (необязательно)</label>
                <input value={form.comment}
                  onChange={(ev) => setForm({ ...form, comment: ev.target.value })} />
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="ghost" onClick={() => setForm(null)}>Отмена</button>
                <button type="submit" disabled={saving}>{saving ? "..." : "Сохранить"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
