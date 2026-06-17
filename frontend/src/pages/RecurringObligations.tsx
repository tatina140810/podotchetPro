import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import {
  RecurringObligation,
  Periodicity,
  PERIODICITY_RU,
  listObligations,
  createObligation,
  updateObligation,
  deleteObligation,
  reorderObligations,
} from "../api/recurringObligations";

const PERIODS: Periodicity[] = ["monthly", "weekly", "one_time"];

function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}

interface FormState {
  id: number | null;
  name: string;
  amount: string;
  periodicity: Periodicity;
  comment: string;
}

const EMPTY_FORM: FormState = { id: null, name: "", amount: "", periodicity: "monthly", comment: "" };

export default function RecurringObligations() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const viewUserId = params.get("user_id") ? Number(params.get("user_id")) : null;
  const viewName = params.get("name");
  const readOnly = viewUserId != null && viewUserId !== me?.id;

  const [list, setList] = useState<RecurringObligation[] | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  function reload() {
    listObligations(viewUserId ?? undefined)
      .then(setList)
      .catch(() => setList([]));
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [viewUserId]);

  const reserveTotal = useMemo(
    () => (list || []).filter((o) => o.periodicity === "monthly").reduce((s, o) => s + Number(o.amount), 0),
    [list]
  );

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    const amount = parseFloat(form.amount.replace(",", "."));
    if (!name) { toast.show("error", "Укажите название"); return; }
    if (!isFinite(amount) || amount <= 0) { toast.show("error", "Сумма должна быть больше 0"); return; }
    setSaving(true);
    try {
      const payload = { name, amount, periodicity: form.periodicity, comment: form.comment.trim() || null };
      if (form.id) await updateObligation(form.id, payload);
      else await createObligation(payload);
      toast.show("success", form.id ? "Сохранено" : "Обязательство добавлено");
      setForm(null);
      reload();
    } catch (e: any) {
      toast.show("error", e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(o: RecurringObligation) {
    if (!confirm(`Удалить «${o.name}»?`)) return;
    try {
      await deleteObligation(o.id);
      reload();
    } catch (e: any) {
      toast.show("error", e.message);
    }
  }

  async function move(idx: number, dir: -1 | 1) {
    if (!list) return;
    const next = [...list];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setList(next); // оптимистично
    try {
      await reorderObligations(next.map((o) => o.id));
    } catch (e: any) {
      toast.show("error", e.message);
      reload();
    }
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>
          Регулярные обязательства{readOnly && viewName ? ` — ${viewName}` : ""}
        </h1>
        {!readOnly && (
          <button onClick={() => setForm({ ...EMPTY_FORM })}>+ Добавить обязательство</button>
        )}
      </div>

      <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        {readOnly
          ? "Просмотр обязательств сотрудника (только чтение)."
          : "Личный список регулярных расходов — подсказка, чтобы не забыть включить их в заявку. Заявку не создаёт."}
        {" "}
        <Link to="/requests/new">Создать заявку →</Link>
      </div>

      {list === null && <div className="muted">Загрузка...</div>}

      {list && list.length === 0 && (
        <div className="card muted" style={{ padding: 20, textAlign: "center" }}>
          {readOnly
            ? "У сотрудника нет регулярных обязательств."
            : "Добавьте регулярные расходы, чтобы не забывать включать их в заявки."}
        </div>
      )}

      {list && list.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                {!readOnly && <th style={{ width: 44 }}></th>}
                <th>Название</th>
                <th style={{ textAlign: "right" }}>Сумма</th>
                <th>Периодичность</th>
                <th>Комментарий</th>
                {!readOnly && <th style={{ width: 120 }}></th>}
              </tr>
            </thead>
            <tbody>
              {list.map((o, idx) => (
                <tr key={o.id}>
                  {!readOnly && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="ghost" style={{ padding: "2px 6px" }} disabled={idx === 0}
                        onClick={() => move(idx, -1)} title="Выше">↑</button>
                      <button className="ghost" style={{ padding: "2px 6px" }} disabled={idx === list.length - 1}
                        onClick={() => move(idx, 1)} title="Ниже">↓</button>
                    </td>
                  )}
                  <td style={{ fontWeight: 600 }}>{o.name}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(Number(o.amount))} с</td>
                  <td className="muted" style={{ fontSize: 13 }}>{PERIODICITY_RU[o.periodicity]}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{o.comment || ""}</td>
                  {!readOnly && (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="ghost" style={{ padding: "4px 10px", fontSize: 13 }}
                        onClick={() => setForm({ id: o.id, name: o.name, amount: String(o.amount), periodicity: o.periodicity, comment: o.comment || "" })}>
                        Изм.
                      </button>
                      <button className="danger" style={{ padding: "4px 10px", fontSize: 13, marginLeft: 6 }}
                        onClick={() => remove(o)}>Удал.</button>
                    </td>
                  )}
                </tr>
              ))}
              <tr>
                <td colSpan={readOnly ? 2 : 3} style={{ fontWeight: 700 }}>Итого к резерву (ежемесячно)</td>
                <td colSpan={readOnly ? 2 : 3} style={{ textAlign: "left", fontWeight: 700, color: "var(--success)" }}>
                  {fmt(reserveTotal)} с
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div onClick={() => setForm(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, width: "100%" }}>
            <h2 className="h2">{form.id ? "Изменить обязательство" : "Новое обязательство"}</h2>
            <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid">
              <div>
                <label>Название</label>
                <input value={form.name} autoFocus required
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Например: Аренда" />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label>Сумма (с)</label>
                  <input value={form.amount} inputMode="decimal" required
                    onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Периодичность</label>
                  <select value={form.periodicity}
                    onChange={(e) => setForm({ ...form, periodicity: e.target.value as Periodicity })}>
                    {PERIODS.map((p) => <option key={p} value={p}>{PERIODICITY_RU[p]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label>Комментарий (необязательно)</label>
                <input value={form.comment}
                  onChange={(e) => setForm({ ...form, comment: e.target.value })}
                  placeholder="Например: офис на Ленина" />
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="ghost" onClick={() => setForm(null)}>Отмена</button>
                <button type="submit" disabled={saving}>{saving ? "..." : "Сохранить"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
