import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { downloadChainXlsx, getChainReport, type ChainNode, type ChainReport as Report } from "../api/chainReport";
import { listUsers } from "../api/users";
import ChainNodeCard from "../components/chain/ChainNodeCard";
import { fmtMoney } from "../components/chain/ChainOps";
import { useToast } from "../components/Toast";
import { isDirectorOrAuditor, useAuth } from "../context/AuthContext";
import { currencySymbol, useDisplayCurrency } from "../context/CurrencyContext";

type Preset = "month" | "prev" | "all" | "range";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function presetRange(p: Preset, from: string, to: string): [string | null, string | null] {
  const now = new Date();
  if (p === "month") return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)];
  if (p === "prev") {
    return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      ymd(new Date(now.getFullYear(), now.getMonth(), 0))];
  }
  if (p === "all") return [null, null];
  return [from || null, to || null];
}

/** «Цепочка расходов»: деньги человека по всей цепочке выдач до конечных расходов.
 *  Открывается из меню отчётов (/reports/chain) и из карточки сотрудника
 *  (/employees/:id/chain — корень берётся из адреса). */
export default function ChainReport() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const { display } = useDisplayCurrency();
  const [people, setPeople] = useState<{ id: number; name: string }[]>([]);
  const [rootId, setRootId] = useState<number | null>(id ? Number(id) : user?.id ?? null);
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(() => presetRange("month", "", "")[0] || "");
  const [to, setTo] = useState(() => presetRange("month", "", "")[1] || "");
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"tree" | "cats">("tree");
  const [exporting, setExporting] = useState(false);
  const director = isDirectorOrAuditor(user?.role);

  useEffect(() => {
    if (id) setRootId(Number(id));
  }, [id]);

  useEffect(() => {
    if (!user) return;
    const load = director
      ? listUsers().then((us) => us.map((u) => ({ id: u.id, name: u.name })))
      : api<{ id: number; name: string }[]>("/api/users/me/subordinates")
          .then((subs) => [{ id: user.id, name: user.name }, ...subs.map((s) => ({ id: s.id, name: s.name }))]);
    load
      .then((list) => setPeople([...list].sort((a, b) => a.name.localeCompare(b.name, "ru"))))
      .catch(() => setPeople([{ id: user.id, name: user.name }]));
  }, [user, director]);

  const [dFrom, dTo] = presetRange(preset, from, to);
  const params = rootId ? { rootId, from: dFrom, to: dTo, currency: display } : null;

  useEffect(() => {
    if (!params || (preset === "range" && (!from || !to))) return;
    setData(null);
    setErr(null);
    getChainReport(params).then(setData).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, preset, from, to, display]);

  const childrenOf = useMemo(() => {
    const m = new Map<number | null, ChainNode[]>();
    for (const n of data?.nodes || []) {
      const list = m.get(n.parent_id) || [];
      list.push(n);
      m.set(n.parent_id, list);
    }
    return m;
  }, [data]);

  function pickRoot(v: number) {
    setRootId(v);
    if (id) navigate(`/employees/${v}/chain`, { replace: true });
  }

  async function onExport() {
    if (!params) return;
    setExporting(true);
    try {
      await downloadChainXlsx(params);
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось скачать");
    } finally {
      setExporting(false);
    }
  }

  const sym = currencySymbol(data?.currency);
  const t = data?.totals;
  const root = data?.nodes[0];

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Цепочка расходов</h1>
        <button type="button" onClick={onExport} disabled={exporting || !data}
          style={{ background: "#107C41", color: "#fff" }}>
          {exporting ? "..." : "Excel"}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label>Чьи деньги</label>
            <select value={rootId ?? ""} onChange={(e) => pickRoot(Number(e.target.value))}>
              {rootId && !people.some((p) => p.id === rootId) && <option value={rootId}>{data?.root_name || "..."}</option>}
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label>Период</label>
            <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              <option value="month">Этот месяц</option>
              <option value="prev">Прошлый месяц</option>
              <option value="all">Всё время</option>
              <option value="range">Произвольный</option>
            </select>
          </div>
          {preset === "range" && (
            <>
              <div>
                <label>С</label>
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label>По</label>
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Выдачи внутри цепочки — не расход: расход считается один раз, у того, кто потратил.
          Остаток — тот же, что в карточке сотрудника.
        </div>
      </div>

      {err && <div className="card" style={{ color: "var(--danger)" }}>Ошибка: {err}</div>}
      {!data && !err && <div className="muted">Загрузка...</div>}

      {data && t && root && (
        <>
          <div className="card cr-totals" style={{ marginBottom: 16 }}>
            <div className="cr-total">
              <span className="cr-stat-label">Пришло в цепочку</span>
              <b>{fmtMoney(t.in_external, sym)}</b>
              <span className="muted cr-hint">
                {root.name}: {fmtMoney(root.in_external, sym)}
                {t.in_external - root.in_external > 0.005 && <>, другие источники участников: {fmtMoney(t.in_external - root.in_external, sym)}</>}
              </span>
            </div>
            <div className="cr-total">
              <span className="cr-stat-label">Конечные расходы</span>
              <b className="cr-out">{fmtMoney(t.expenses, sym)}</b>
              <span className="muted cr-hint">у {t.people} чел., без внутренних выдач</span>
            </div>
            <div className="cr-total">
              <span className="cr-stat-label">На руках у всех</span>
              <b className="cr-accent">{fmtMoney(t.closing, sym)}</b>
              <span className="muted cr-hint">на начало было {fmtMoney(t.opening, sym)}</span>
            </div>
            {t.out_external > 0 && (
              <div className="cr-total">
                <span className="cr-stat-label">Ушло за пределы</span>
                <b>{fmtMoney(t.out_external, sym)}</b>
              </div>
            )}
            <div className={`cr-check ${t.check_ok ? "ok" : "bad"}`}>
              {t.check_ok ? "Сверка сходится" : `Сверка не сходится на ${fmtMoney(t.check_diff, sym)}`}
            </div>
          </div>

          <div className="report-tabs" style={{ marginBottom: 12 }}>
            <button type="button" className={`report-tab${tab === "tree" ? " active" : ""}`} onClick={() => setTab("tree")}>
              Дерево
            </button>
            <button type="button" className={`report-tab${tab === "cats" ? " active" : ""}`} onClick={() => setTab("cats")}>
              По категориям
            </button>
          </div>

          {tab === "tree" ? (
            <ChainNodeCard node={root} childrenOf={childrenOf} sym={sym} cur={data.currency} defaultOpen />
          ) : (
            <div className="card">
              {data.categories.length === 0 && <div className="muted">Расходов за период нет</div>}
              {data.categories.map((c) => (
                <div key={c.name} className="cr-op">
                  <span className="cr-op-text"><b>{c.name}</b><span className="muted"> · {c.count}</span></span>
                  <span className="cr-op-sum cr-out">{fmtMoney(c.total, sym)}</span>
                </div>
              ))}
              {data.categories.length > 0 && (
                <div className="cr-op cr-op-total">
                  <span className="cr-op-text"><b>Итого конечных расходов</b></span>
                  <span className="cr-op-sum cr-out"><b>{fmtMoney(t.expenses, sym)}</b></span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
