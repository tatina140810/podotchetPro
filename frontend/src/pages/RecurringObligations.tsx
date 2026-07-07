import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../api/client";
import {
  RecurringObligation,
  Periodicity,
  PERIODICITY_RU,
  listObligations,
  createObligation,
  updateObligation,
  deleteObligation,
} from "../api/recurringObligations";

const PERIODS: Periodicity[] = ["monthly", "weekly", "yearly", "one_time"];

// Горизонты планирования (вкладки). one_time сюда не входит — он разовый.
type Horizon = "weekly" | "monthly" | "yearly";
const HORIZONS: Horizon[] = ["weekly", "monthly", "yearly"];
const HORIZON_TAB_RU: Record<Horizon, string> = {
  weekly: "Еженедельно",
  monthly: "Ежемесячно",
  yearly: "Ежегодно",
};
// Суффикс к сумме (с/нед, с/мес, с/год) и слово для строки «Итого за …».
const HORIZON_SUFFIX: Record<Horizon, string> = { weekly: "нед", monthly: "мес", yearly: "год" };
const HORIZON_PER_RU: Record<Horizon, string> = { weekly: "неделю", monthly: "месяц", yearly: "год" };
// Цвет-метка периодичности — чтобы по цвету рядом с обязательством сразу было
// видно частоту оплаты. Не эмодзи: цветная точка (вектор).
const PERIOD_COLOR: Record<Periodicity, string> = {
  weekly: "#3b82f6",   // синий
  monthly: "#22c55e",  // зелёный
  yearly: "#a855f7",   // фиолетовый
  one_time: "#94a3b8", // серый
};

// Пометка под суммой — как обязательство платится в реальности.
const PAYS_AS_RU: Record<Periodicity, string> = {
  weekly: "оплачивается еженедельно",
  monthly: "оплачивается ежемесячно",
  yearly: "оплачивается раз в год",
  one_time: "разово, не включается в итог",
};

// Периодов в году: неделя 52, месяц 12, год 1. Пересчёт через «годовую базу»,
// чтобы коэффициенты были согласованы (нед→мес = 52/12 = 4.33, мес→год = 12 и т.д.).
const PERIODS_PER_YEAR: Record<Horizon, number> = { weekly: 52, monthly: 12, yearly: 1 };

/** Пересчёт суммы из исходной периодичности в выбранный горизонт. one_time не
 * пересчитывается (возвращаем как есть). Округляем до целого сома. */
function convertAmount(amount: number, from: Periodicity, to: Horizon): number {
  if (from === "one_time") return amount;
  const yearly = amount * PERIODS_PER_YEAR[from as Horizon]; // годовая база
  return Math.round(yearly / PERIODS_PER_YEAR[to]);
}

interface CategoryOpt {
  id: number;
  name: string;
  display_name?: string | null;
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}

interface FormState {
  id: number | null;
  name: string;
  amount: string;
  periodicity: Periodicity;
  comment: string;
  categoryId: string; // "" = без категории
}

const EMPTY_FORM: FormState = { id: null, name: "", amount: "", periodicity: "monthly", comment: "", categoryId: "" };

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
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  // Фильтр по категории: "" = все, "none" = без категории, иначе id категории.
  const [filterCat, setFilterCat] = useState<string>("");
  // Активный горизонт планирования (вкладка). По умолчанию — ежемесячно.
  const [activePeriod, setActivePeriod] = useState<Horizon>("monthly");

  function reload() {
    listObligations(viewUserId ?? undefined)
      .then(setList)
      .catch(() => setList([]));
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [viewUserId]);

  // Категории — только для своего списка (где есть форма добавления/изменения).
  useEffect(() => {
    if (readOnly) return;
    api<CategoryOpt[]>("/api/categories").then(setCategories).catch(() => setCategories([]));
  }, [readOnly]);

  // Опции фильтра строим из самих обязательств — работают и в режиме «только чтение».
  const filterOptions = useMemo(() => {
    const byId = new Map<number, string>();
    let hasNone = false;
    for (const o of list || []) {
      if (o.category_id) byId.set(o.category_id, o.category_name || `#${o.category_id}`);
      else hasNone = true;
    }
    return {
      cats: [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru")),
      hasNone,
    };
  }, [list]);

  const filtered = useMemo(() => {
    const all = list || [];
    if (filterCat === "") return all;
    if (filterCat === "none") return all.filter((o) => !o.category_id);
    return all.filter((o) => String(o.category_id) === filterCat);
  }, [list, filterCat]);

  // Итог за выбранный горизонт: сумма всех (кроме разовых) обязательств,
  // пересчитанных в активный период. Учитывает текущий фильтр по категории.
  const periodTotal = useMemo(
    () => filtered
      .filter((o) => o.periodicity !== "one_time")
      .reduce((s, o) => s + convertAmount(Number(o.amount), o.periodicity, activePeriod), 0),
    [filtered, activePeriod]
  );

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    const amount = parseFloat(form.amount.replace(",", "."));
    if (!name) { toast.show("error", "Укажите название"); return; }
    if (!isFinite(amount) || amount <= 0) { toast.show("error", "Сумма должна быть больше 0"); return; }
    setSaving(true);
    try {
      const payload = {
        name,
        amount,
        periodicity: form.periodicity,
        comment: form.comment.trim() || null,
        category_id: form.categoryId ? Number(form.categoryId) : null,
      };
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

      {list && list.length > 0 && (filterOptions.cats.length > 0 || filterOptions.hasNone) && (
        <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <label style={{ margin: 0 }}>Категория:</label>
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} style={{ minWidth: 200 }}>
            <option value="">Все категории</option>
            {filterOptions.cats.map(([id, name]) => (
              <option key={id} value={String(id)}>{name}</option>
            ))}
            {filterOptions.hasNone && <option value="none">Без категории</option>}
          </select>
          {filterCat !== "" && (
            <button type="button" className="ghost" style={{ padding: "4px 10px", fontSize: 13 }}
              onClick={() => setFilterCat("")}>Сбросить</button>
          )}
        </div>
      )}

      {list && list.length > 0 && (
        <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {HORIZONS.map((h) => {
            const on = activePeriod === h;
            return (
              <button key={h} type="button" onClick={() => setActivePeriod(h)}
                className={on ? "" : "ghost"}
                style={{ padding: "6px 16px", fontWeight: on ? 700 : 500 }}>
                {HORIZON_TAB_RU[h]}
              </button>
            );
          })}
        </div>
      )}

      {list && list.length > 0 && (
        <div className="row muted" style={{ gap: 14, marginBottom: 12, flexWrap: "wrap", fontSize: 12 }}>
          {PERIODS.map((p) => (
            <span key={p} className="row" style={{ gap: 6, alignItems: "center" }}>
              <span style={{
                display: "inline-block", width: 10, height: 10, borderRadius: "50%",
                background: PERIOD_COLOR[p],
              }} />
              {PERIODICITY_RU[p]}
            </span>
          ))}
        </div>
      )}

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
                <th>Название</th>
                <th style={{ textAlign: "right" }}>Сумма</th>
                <th>Периодичность</th>
                <th>Категория</th>
                <th>Комментарий</th>
                {!readOnly && <th style={{ width: 120 }}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>
                    <span title={PERIODICITY_RU[o.periodicity]} style={{
                      display: "inline-block", width: 10, height: 10, borderRadius: "50%",
                      background: PERIOD_COLOR[o.periodicity], marginRight: 8, verticalAlign: "middle",
                    }} />
                    {o.name}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {o.periodicity === "one_time" ? (
                      <>
                        {fmt(Number(o.amount))} с
                        <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                          {PAYS_AS_RU.one_time}
                        </div>
                      </>
                    ) : (
                      <>
                        {fmt(convertAmount(Number(o.amount), o.periodicity, activePeriod))} с/{HORIZON_SUFFIX[activePeriod]}
                        {o.periodicity !== activePeriod && (
                          <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                            {PAYS_AS_RU[o.periodicity]}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>{PERIODICITY_RU[o.periodicity]}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{o.category_name || "—"}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{o.comment || ""}</td>
                  {!readOnly && (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="ghost" style={{ padding: "4px 10px", fontSize: 13 }}
                        onClick={() => setForm({ id: o.id, name: o.name, amount: String(o.amount), periodicity: o.periodicity, comment: o.comment || "", categoryId: o.category_id ? String(o.category_id) : "" })}>
                        Изм.
                      </button>
                      <button className="danger" style={{ padding: "4px 10px", fontSize: 13, marginLeft: 6 }}
                        onClick={() => remove(o)}>Удал.</button>
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={readOnly ? 5 : 6} className="muted" style={{ textAlign: "center", padding: 16 }}>
                    Нет обязательств в выбранной категории.
                  </td>
                </tr>
              )}
              <tr>
                <td colSpan={3} style={{ fontWeight: 700 }}>
                  Итого за {HORIZON_PER_RU[activePeriod]}{filterCat !== "" ? " — по фильтру" : ""}
                </td>
                <td colSpan={readOnly ? 2 : 3} style={{ textAlign: "left", fontWeight: 700, color: "var(--success)" }}>
                  {fmt(periodTotal)} с
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
                <label>Категория (необязательно)</label>
                <select value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">Без категории</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.display_name || c.name}</option>
                  ))}
                </select>
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
