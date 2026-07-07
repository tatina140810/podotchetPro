import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useDisplayCurrency } from "../context/CurrencyContext";
import { useSettings } from "../context/SettingsContext";
import { ExpectedIncomes } from "./ExpectedIncomes";

interface IncomeItem {
  id: number;
  date: string;
  amount: number;
  currency: string;
  amount_kgs: number;
  amount_display: number;
  source: string;
  source_id: number | null;
  description: string | null;
  received_by_name: string | null;
  created_by_name: string | null;
}

interface SourceRow {
  source_id: number | null;
  source: string;
  total: number;
  count: number;
}

interface Report {
  year: number | null;
  month: number | null;
  items: IncomeItem[];
  by_source: SourceRow[];
  total: number;
  count: number;
  currency: "KGS" | "USD";
  rate: number | null;
}

const MONTH_RU_FULL = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export default function IncomeReport() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState<number | "">(today.getMonth() + 1);
  const { display } = useDisplayCurrency();
  const { flag } = useSettings();
  const showBySource = flag("income_source_report");
  const [params] = useSearchParams();
  // Read-only просмотр ожидаемых пополнений конкретного сотрудника (из карточки).
  const viewUserId = params.get("user_id") ? Number(params.get("user_id")) : undefined;
  const viewName = params.get("name");
  // Таб: "incomes" (отчёт по приходам org) | "expected" (ожидаемые пополнения).
  // При просмотре чужого сотрудника — только таб ожидаемых (read-only).
  const [tab, setTab] = useState<"incomes" | "expected">(
    viewUserId ? "expected" : (params.get("tab") === "expected" ? "expected" : "incomes")
  );
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Какие источники раскрыты (ключ совпадает с группировкой бэкенда).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Ключ группы — по нормализованному названию (совпадает с группировкой бэкенда):
  // одинаковое имя = один источник, даже если часть приходов без привязки к справочнику.
  function sourceKey(s: SourceRow): string {
    return `nm:${(s.source || "—").trim().toLowerCase()}`;
  }

  function toggleSource(s: SourceRow) {
    const k = sourceKey(s);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  // История по источнику — фильтруем уже загруженные позиции (без доп. запросов).
  function itemsForSource(s: SourceRow): IncomeItem[] {
    if (!data) return [];
    const target = (s.source || "—").trim().toLowerCase();
    return data.items.filter((it) => (it.source || "—").trim().toLowerCase() === target);
  }

  function reload() {
    setErr(null);
    const params = new URLSearchParams({ currency: display });
    if (month !== "") {
      params.set("year", String(year));
      params.set("month", String(month));
    }
    api<Report>(`/api/reports/incomes?${params.toString()}&_t=${Date.now()}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }

  useEffect(() => {
    setData(null);
    setExpanded(new Set());
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, display]);

  const sym = data?.currency === "USD" ? "$" : "с";

  function symFor(cur: string): string {
    return cur === "USD" ? "$" : cur === "RUB" ? "₽" : cur === "EUR" ? "€" : "с";
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>
          {viewUserId ? `Ожидаемые пополнения${viewName ? ` — ${viewName}` : ""}` : "Приходы"}
        </h1>
        {!viewUserId && (
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className={tab === "incomes" ? "" : "ghost"} onClick={() => setTab("incomes")}>
              Приходы
            </button>
            <button type="button" className={tab === "expected" ? "" : "ghost"} onClick={() => setTab("expected")}>
              Ожидаемые пополнения
            </button>
          </div>
        )}
      </div>

      {viewUserId ? (
        <ExpectedIncomes readOnly userId={viewUserId} />
      ) : (
      <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label>Месяц</label>
            <select value={month} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : "")}>
              <option value="">все</option>
              {MONTH_RU_FULL.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Год</label>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 90 }} />
          </div>
          <div className="muted" style={{ fontSize: 12, marginLeft: 12 }}>
            Валюта: <b>{display === "USD" ? "USD ($)" : "KGS (с)"}</b> — меняется тумблером в шапке.
          </div>
        </div>
      </div>

      {tab === "expected" ? (
        <ExpectedIncomes onConverted={reload} />
      ) : (
      <>
      {err && <div className="card" style={{ color: "var(--danger)" }}>Ошибка: {err}</div>}
      {!data && !err && <div className="muted">Загрузка...</div>}

      {data && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 16 }}>
            <div className="card">
              <div className="muted" style={{ fontSize: 12 }}>Всего приходов</div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{data.count}</div>
            </div>
            <div className="card">
              <div className="muted" style={{ fontSize: 12 }}>Итого ({sym})</div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: "var(--success)" }}>
                +{data.total.toLocaleString("ru-RU")} {sym}
              </div>
            </div>
          </div>

          {showBySource && data.by_source && data.by_source.length > 0 && (
            <div className="card" style={{ marginBottom: 16, overflow: "auto" }}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>По источникам</div>
              <table>
                <thead>
                  <tr>
                    <th>Источник</th>
                    <th style={{ textAlign: "right" }}>Кол-во</th>
                    <th style={{ textAlign: "right" }}>Итого ({sym})</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_source.map((s, i) => {
                    const k = sourceKey(s);
                    const open = expanded.has(k);
                    return (
                      <Fragment key={s.source_id ?? `txt-${i}`}>
                        <tr onClick={() => toggleSource(s)} style={{ cursor: "pointer" }}>
                          <td style={{ fontWeight: 600 }}>
                            <span style={{ marginRight: 6 }}>{open ? "▼" : "▶"}</span>
                            {s.source || "—"}
                          </td>
                          <td style={{ textAlign: "right" }} className="muted">{s.count}</td>
                          <td style={{ textAlign: "right", color: "var(--success)", fontWeight: 600 }}>
                            +{s.total.toLocaleString("ru-RU")} {sym}
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={3} style={{ background: "var(--bg-subtle, rgba(255,255,255,0.03))", padding: 12 }}>
                              <table>
                                <thead>
                                  <tr>
                                    <th>Дата</th>
                                    <th>Получатель</th>
                                    <th style={{ textAlign: "right" }}>Сумма (исх.)</th>
                                    <th style={{ textAlign: "right" }}>В {sym}</th>
                                    <th>Комментарий</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {itemsForSource(s).map((it) => (
                                    <tr key={it.id}>
                                      <td className="muted" style={{ fontSize: 12 }}>
                                        {new Date(it.date).toLocaleDateString("ru-RU")}
                                      </td>
                                      <td style={{ fontSize: 13 }}>{it.received_by_name || "—"}</td>
                                      <td style={{ textAlign: "right", fontWeight: 600 }}>
                                        +{it.amount.toLocaleString("ru-RU")} {symFor(it.currency)}
                                      </td>
                                      <td style={{ textAlign: "right", color: "var(--success)" }}>
                                        +{it.amount_display.toLocaleString("ru-RU")} {sym}
                                      </td>
                                      <td className="muted" style={{ fontSize: 12 }}>{it.description || ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="card" style={{ overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Источник</th>
                  <th>Получатель</th>
                  <th style={{ textAlign: "right" }}>Сумма (исх.)</th>
                  <th style={{ textAlign: "right" }}>В {sym}</th>
                  <th>Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && (
                  <tr><td colSpan={6} className="muted">Нет приходов за этот период</td></tr>
                )}
                {data.items.map((it) => (
                  <tr key={it.id}>
                    <td style={{ fontSize: 12 }}>
                      {new Date(it.date).toLocaleDateString("ru-RU")}
                    </td>
                    <td>{it.source || "—"}</td>
                    <td className="muted" style={{ fontSize: 13 }}>{it.received_by_name || "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>
                      +{it.amount.toLocaleString("ru-RU")} {symFor(it.currency)}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--success)" }}>
                      +{it.amount_display.toLocaleString("ru-RU")} {sym}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>{it.description || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      </>
      )}
      </>
      )}
    </div>
  );
}
