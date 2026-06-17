import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { isDirectorLevel, useAuth, type UserOut } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { getCurrentRate, getCurrentRates, refreshFromNbkr, setRate } from "../api/exchange";
import { createIncome } from "../api/income";
import { listIncomeSources, type IncomeSource } from "../api/incomeSources";
import { listColleagues } from "../api/users";
import { formatMoney, useDisplayCurrency } from "../context/CurrencyContext";
import { useSettings } from "../context/SettingsContext";

interface CashBalance {
  kgs: number;
  usd: number | null;
  rate: number | null;
  spent_usd_native: number;
}

interface DirectorDash {
  view: "director";
  totals: {
    issued: number;
    spent: number;
    balance: number;
    pending_count: number;
    pending_requests_for_me: number;
    pending_requests_total: number;
    my_issued: number;
  };
  cash_balance: CashBalance;
  recent_advances: any[];
  recent_expenses: any[];
}

export default function Dashboard() {
  const { user: _user } = useAuth();
  void _user;
  const { display } = useDisplayCurrency();
  const [data, setData] = useState<DirectorDash | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    api<DirectorDash>("/api/dashboard").then(setData).catch((e) => setErr(e.message));
  }
  useEffect(() => { reload(); }, []);

  if (err) return <div className="container"><div className="card" style={{ color: "var(--danger)" }}>{err}</div></div>;
  if (!data) return <div className="container"><div className="muted">Загрузка...</div></div>;

  const t = data.totals;
  const cb = data.cash_balance;

  return (
    <div className="container">
      <h1 className="h1">Главная</h1>

      {/* Виджет общего остатка в обороте org с эквивалентом в USD */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Остаток в обороте</div>
            <div style={{
              fontSize: 28,
              fontWeight: 700,
              color: cb.kgs < 0 ? "var(--danger)" : "var(--accent-light)",
              marginTop: 6,
            }}>
              {formatMoney(cb.kgs, display, cb.rate)}
            </div>
            {/* Подписка во второй валюте — для контекста */}
            {cb.rate !== null && (
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                {display === "USD"
                  ? `≈ ${Math.round(cb.kgs).toLocaleString("ru-RU")} с (курс ${cb.rate})`
                  : (cb.usd !== null && `≈ ${Math.round(cb.usd).toLocaleString("ru-RU")} $ (курс ${cb.rate})`)}
              </div>
            )}
            {cb.rate === null && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4, color: "var(--warning)" }}>
                Курс USD/KGS не задан — показано только в сомах
              </div>
            )}
          </div>
          {/* Кнопки «+ Приход» и «курс» перенесены: Приход — в раздел /expenses,
              курс — в шапку сайта рядом с тумблером валюты. */}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Stat label="Выдано всего" value={t.issued} display={display} rate={cb.rate} />
        <Stat label="Потрачено" value={t.spent} display={display} rate={cb.rate} />
        <Stat label="Остаток" value={t.balance} display={display} rate={cb.rate} accent />
        <div className="card">
          <div className="muted" style={{ fontSize: 12 }}>Расходы на проверке</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>
            {t.pending_count}
            {t.pending_count > 0 && <Link to="/expenses?status=pending" style={{ fontSize: 13, marginLeft: 10 }}>проверить →</Link>}
          </div>
        </div>
        <div className="card">
          <div className="muted" style={{ fontSize: 12 }}>Ожидают моего одобрения</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: t.pending_requests_for_me > 0 ? "var(--warning)" : undefined }}>
            {t.pending_requests_for_me}
            <Link to="/requests?status=pending" style={{ fontSize: 13, marginLeft: 10 }}>заявки →</Link>
          </div>
          {t.pending_requests_total !== t.pending_requests_for_me && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              всего в org: {t.pending_requests_total}
            </div>
          )}
        </div>
        <Link to="/issued-topups" className="card" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="muted" style={{ fontSize: 12 }}>Итого выдано мной</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: "var(--accent-light)" }}>
            {formatMoney(t.my_issued || 0, display, cb.rate)}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>история выдач →</div>
        </Link>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 18 }}>
        <div className="card">
          <h2 className="h2">Последние выдачи</h2>
          {data.recent_advances.length === 0 ? <div className="muted">Пусто</div> : (
            <table>
              <tbody>
                {data.recent_advances.map((a) => {
                  const cur = a.currency || "KGS";
                  const sym = cur === "USD" ? "$" : cur === "RUB" ? "₽" : cur === "EUR" ? "€" : "с";
                  return (
                  <tr key={a.id}>
                    <td>{a.employee}</td>
                    <td style={{ textAlign: "right" }}>{a.amount.toLocaleString("ru-RU")} {sym}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{new Date(a.issued_at).toLocaleDateString("ru-RU")}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2 className="h2">Последние расходы</h2>
          {data.recent_expenses.length === 0 ? <div className="muted">Пусто</div> : (
            <table>
              <tbody>
                {data.recent_expenses.map((e) => {
                  const cur = e.currency || "KGS";
                  const sym = cur === "USD" ? "$" : cur === "RUB" ? "₽" : cur === "EUR" ? "€" : "с";
                  return (
                  <tr key={e.id}>
                    <td>
                      {e.employee}
                      <div className="muted" style={{ fontSize: 11 }}>{e.category}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>{e.amount.toLocaleString("ru-RU")} {sym}</td>
                    <td>
                      <StatusBadge status={e.status} />
                      {e.is_verified && (
                        <span className="badge approved" style={{ marginLeft: 4 }}>✓ ауд.</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}

export function IncomeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { user: me } = useAuth();
  const { flag } = useSettings();
  const useSourceDirectory = flag("income_sources");
  const selfIncome = flag("self_income");
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [sources, setSources] = useState<IncomeSource[]>([]);
  // При выборе из справочника храним id; "manual" — режим свободного ввода.
  const [sourceId, setSourceId] = useState<number | "" | "manual">("");
  const [usdKgs, setUsdKgs] = useState<number | null>(null);
  const [rubKgs, setRubKgs] = useState<number | null>(null);
  const [form, setForm] = useState({
    amount: "",
    currency: "KGS" as "KGS" | "USD" | "RUB",
    source: "",
    description: "",
    // По умолчанию приход «себе», если фича включена (можно поменять получателя).
    received_by_id: (selfIncome && me ? me.id : "") as number | "",
    date: new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listColleagues().then(setColleagues).catch(() => {});
    if (useSourceDirectory) {
      listIncomeSources(true).then(setSources).catch(() => {});
    }
    getCurrentRate("USD", "KGS").then((r) => setUsdKgs(r.rate ? Number(r.rate) : null)).catch(() => {});
    getCurrentRate("RUB", "KGS").then((r) => setRubKgs(r.rate ? Number(r.rate) : null)).catch(() => {});
  }, [useSourceDirectory]);

  const rateForCurrency =
    form.currency === "USD" ? usdKgs :
    form.currency === "RUB" ? rubKgs : null;

  // Предпросмотр КГС-эквивалента (фиксируется в момент создания)
  const amountNum = parseFloat(form.amount.replace(",", "."));
  const kgsEquiv = (() => {
    if (!isFinite(amountNum) || amountNum <= 0) return null;
    if (form.currency === "KGS") return amountNum;
    if (rateForCurrency) return Math.round(amountNum * rateForCurrency);
    return null;
  })();
  const needsRateButMissing = form.currency !== "KGS" && rateForCurrency === null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(form.amount.replace(",", "."));
    if (!isFinite(amt) || amt <= 0) { toast.show("error", "Введите сумму > 0"); return; }

    // Источник: из справочника (source_id) либо свободный текст (source).
    const fromDirectory = useSourceDirectory && typeof sourceId === "number";
    if (useSourceDirectory && sourceId === "") { toast.show("error", "Выберите источник"); return; }
    if (!fromDirectory && !form.source.trim()) { toast.show("error", "Укажите источник"); return; }
    if (!form.received_by_id) { toast.show("error", "Выберите получателя"); return; }
    setBusy(true);
    try {
      await createIncome({
        amount: amt,
        currency: form.currency,
        source: fromDirectory ? null : form.source.trim(),
        source_id: fromDirectory ? (sourceId as number) : null,
        description: form.description.trim() || null,
        received_by_id: Number(form.received_by_id),
        date: form.date ? new Date(form.date).toISOString() : undefined,
      });
      toast.show("success", "Приход записан");
      onSaved();
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, width: "100%" }}>
        <h2 className="h2">+ Приход</h2>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Поступление денег извне (кредит, оплата клиента, от партнёра, и т.п.)
        </div>
        <form onSubmit={submit} className="grid">
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label>Сумма</label>
              <input
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                inputMode="decimal" autoFocus required
              />
            </div>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label>Валюта</label>
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value as "KGS" | "USD" | "RUB" })}
              >
                <option value="KGS">KGS — сом</option>
                <option value="USD">USD — $</option>
                <option value="RUB">RUB — ₽</option>
              </select>
            </div>
          </div>
          <div>
            <label>Источник</label>
            {useSourceDirectory ? (
              <>
                <select
                  value={sourceId === "" ? "" : String(sourceId)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSourceId(v === "" ? "" : v === "manual" ? "manual" : Number(v));
                  }}
                  required
                >
                  <option value="">— выберите источник —</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  <option value="manual">Другой (ввести вручную)</option>
                </select>
                {sourceId === "manual" && (
                  <input
                    style={{ marginTop: 8 }}
                    value={form.source}
                    onChange={(e) => setForm({ ...form, source: e.target.value })}
                    placeholder="название источника"
                    required
                  />
                )}
              </>
            ) : (
              <input
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                placeholder="кредит, от партнёра, оплата клиента..."
                required
              />
            )}
          </div>
          <div>
            <label>Кому зачислить</label>
            <select
              value={form.received_by_id}
              onChange={(e) => setForm({ ...form, received_by_id: e.target.value ? Number(e.target.value) : "" })}
              required
            >
              <option value="">— выберите —</option>
              {me && <option value={me.id}>Себе ({me.name})</option>}
              {colleagues.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {kgsEquiv !== null && form.currency !== "KGS" && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4, color: "var(--success)" }}>
                ≈ {kgsEquiv.toLocaleString("ru-RU")} сом (по курсу {rateForCurrency}) — будет добавлено к балансу
              </div>
            )}
            {needsRateButMissing && (
              <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>
                Курс {form.currency}/KGS не задан. Нажмите «курс» → «Загрузить с НБКР» (USD+RUB одной кнопкой).
              </div>
            )}
            {form.received_by_id && (
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Запись будет помечена: внёс «{me?.name || "admin"}» от лица получателя.
              </div>
            )}
          </div>
          <div>
            <label>Дата</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label>Описание (необязательно)</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="ghost" onClick={onClose}>Отмена</button>
            <button type="submit" disabled={busy || needsRateButMissing}>
              {busy ? "..." : "Записать"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Stat({
  label, value, display, rate, accent,
}: {
  label: string;
  value: number;
  display: "KGS" | "USD";
  rate: number | null;
  accent?: boolean;
}) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: accent ? "var(--accent-light)" : "var(--text)" }}>
        {formatMoney(value, display, rate)}
      </div>
    </div>
  );
}

const RATE_CURRENCIES = ["USD", "RUB", "EUR"] as const;
type RateCur = (typeof RATE_CURRENCIES)[number];

export function RateModal({
  currentRate: _ignored,
  onClose,
  onSaved,
}: {
  currentRate?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  void _ignored;
  const toast = useToast();
  // Поля для трёх валют; пусто = «не редактировано», не отправляем.
  const [values, setValues] = useState<Record<RateCur, string>>({
    USD: "",
    RUB: "",
    EUR: "",
  });
  const [current, setCurrent] = useState<Record<RateCur, number | null>>({
    USD: null,
    RUB: null,
    EUR: null,
  });
  const [busy, setBusy] = useState(false);
  const [pullingNbkr, setPullingNbkr] = useState(false);

  // Подгружаем текущие курсы при открытии модала.
  useEffect(() => {
    getCurrentRates(RATE_CURRENCIES.map((c) => ({ from: c })))
      .then((res) => {
        const next: Record<RateCur, number | null> = { USD: null, RUB: null, EUR: null };
        for (const c of RATE_CURRENCIES) {
          next[c] = res[c]?.rate ? Number(res[c].rate) : null;
        }
        setCurrent(next);
      })
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Парсим и валидируем непустые поля
    const updates: { cur: RateCur; rate: number }[] = [];
    for (const c of RATE_CURRENCIES) {
      const raw = values[c].trim();
      if (!raw) continue;
      const n = parseFloat(raw.replace(",", "."));
      if (!isFinite(n) || n <= 0) {
        toast.show("error", `Некорректный курс ${c}`);
        return;
      }
      updates.push({ cur: c, rate: n });
    }
    if (updates.length === 0) {
      toast.show("error", "Введите хотя бы один курс");
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        updates.map((u) =>
          setRate({ from_currency: u.cur, to_currency: "KGS", rate: u.rate })
        )
      );
      const summary = updates.map((u) => `1 ${u.cur} = ${u.rate}`).join(", ");
      toast.show("success", `Сохранено: ${summary}`);
      onSaved();
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  async function pullFromNbkr() {
    setPullingNbkr(true);
    try {
      const saved = await refreshFromNbkr();
      // Заполняем поля свежими курсами НБКР, чтобы их можно было пересмотреть и сохранить.
      const next = { ...values };
      const fresh = { ...current };
      for (const s of saved) {
        const iso = s.from_currency as RateCur;
        if (!RATE_CURRENCIES.includes(iso)) continue;
        next[iso] = String(s.rate);
        fresh[iso] = Number(s.rate);
      }
      setValues(next);
      setCurrent(fresh);
      toast.show("success", `НБКР: ${saved.map((s) => `${s.from_currency}=${s.rate}`).join(", ")}`);
      onSaved();
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось получить курсы НБКР");
    } finally {
      setPullingNbkr(false);
    }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, width: "100%" }}>
        <h2 className="h2">Курсы валют → KGS</h2>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Сколько сом за 1 единицу валюты. Пустое поле = «оставить как было».
        </div>

        <button
          type="button"
          onClick={pullFromNbkr}
          disabled={pullingNbkr || busy}
          style={{ width: "100%", marginBottom: 10 }}
        >
          {pullingNbkr ? "Загружаю с НБКР..." : "Подгрузить USD + RUB + EUR с НБКР"}
        </button>

        <div className="muted" style={{ fontSize: 11, textAlign: "center", margin: "0 0 8px" }}>
          или ввести/отредактировать вручную
        </div>

        <form onSubmit={submit} className="grid">
          {RATE_CURRENCIES.map((c) => (
            <div key={c} className="row" style={{ gap: 8, alignItems: "flex-end" }}>
              <div style={{ minWidth: 50, fontWeight: 600 }}>{c}</div>
              <div style={{ flex: 1 }}>
                <input
                  value={values[c]}
                  onChange={(e) => setValues({ ...values, [c]: e.target.value })}
                  inputMode="decimal"
                  placeholder={current[c] !== null ? String(current[c]) : "не задан"}
                />
              </div>
              <div className="muted" style={{ fontSize: 11, minWidth: 90, textAlign: "right" }}>
                {current[c] !== null ? `тек: ${current[c]}` : "—"}
              </div>
            </div>
          ))}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="ghost" onClick={onClose}>Закрыть</button>
            <button type="submit" disabled={busy || pullingNbkr}>
              {busy ? "..." : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
