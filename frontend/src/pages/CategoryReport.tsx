import { Fragment, useEffect, useState } from "react";
import { api, downloadFile } from "../api/client";
import { useToast } from "../components/Toast";
import { useDisplayCurrency } from "../context/CurrencyContext";
import { listDepartments, type Department } from "../api/departments";

interface ExpenseItem {
  id: number;
  amount: number;
  currency: string;
  amount_kgs: number;
  description: string | null;
  spent_at: string;
  status: string;
}

interface CategoryRow {
  category_id: number | null;
  category: string;
  department: string | null;
  amount: number;
  count: number;
  percent: number;
  items: ExpenseItem[];
}

interface Report {
  year: number;
  month: number;
  operational: CategoryRow[];
  other: CategoryRow[];
  operational_subtotal: number;
  other_subtotal: number;
  total_expenses: number;
  total_income: number;
  result: number;
  currency: "KGS" | "USD";
  rate: number | null;
}

const MONTH_RU_FULL = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export default function CategoryReport() {
  const toast = useToast();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const { display } = useDisplayCurrency();
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<number | "">("");

  useEffect(() => {
    listDepartments().then(setDepartments).catch(() => {});
  }, []);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function reload() {
    setErr(null);
    const dep = departmentId ? `&department_id=${departmentId}` : "";
    api<Report>(`/api/reports/categories?year=${year}&month=${month}&currency=${display}${dep}&_t=${Date.now()}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }

  useEffect(() => {
    setData(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, display, departmentId]);

  async function onExport() {
    setExporting(true);
    try {
      await downloadFile(
        `/api/reports/categories.xlsx?year=${year}&month=${month}&currency=${display}`,
        `categories_${year}_${String(month).padStart(2, "0")}_${display}.xlsx`,
      );
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось скачать");
    } finally {
      setExporting(false);
    }
  }

  const sym = data?.currency === "USD" ? "$" : "с";

  function renderSection(title: string, rows: CategoryRow[], subtotal: number, prefix: string) {
    return (
      <>
        <h2 className="h2" style={{ marginTop: 18 }}>{title}</h2>
        <div className="card" style={{ overflow: "auto", marginBottom: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Категория</th>
                <th>Подразделение</th>
                <th style={{ textAlign: "right" }}>Сумма</th>
                <th style={{ textAlign: "right" }}>% от общего</th>
                <th style={{ textAlign: "right" }}>Операций</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="muted">Пусто</td></tr>
              )}
              {rows.map((r) => {
                const key = `${prefix}-${r.category_id ?? "none"}`;
                return (
                  <Fragment key={key}>
                    <tr style={{ cursor: "pointer" }} onClick={() => toggle(key)}>
                      <td>
                        <span style={{ marginRight: 6 }}>{expanded.has(key) ? "▼" : "▶"}</span>
                        {r.category}
                      </td>
                      <td className="muted" style={{ fontSize: 13 }}>{r.department || "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>
                        {r.amount.toLocaleString("ru-RU")} {sym}
                      </td>
                      <td style={{ textAlign: "right" }} className="muted">{r.percent}%</td>
                      <td style={{ textAlign: "right" }} className="muted">{r.count}</td>
                    </tr>
                    {expanded.has(key) && (
                      <tr>
                        <td colSpan={5} style={{ background: "rgba(255,255,255,0.03)", padding: 12 }}>
                          <table>
                            <thead>
                              <tr>
                                <th>Дата</th>
                                <th>Описание</th>
                                <th style={{ textAlign: "right" }}>Сумма (orig)</th>
                                <th style={{ textAlign: "right" }}>В {sym}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.items.map((it) => (
                                <tr key={it.id}>
                                  <td style={{ fontSize: 12 }}>
                                    {new Date(it.spent_at).toLocaleDateString("ru-RU")}
                                  </td>
                                  <td style={{ fontSize: 13 }}>{it.description || "—"}</td>
                                  <td style={{ textAlign: "right" }}>
                                    {it.amount.toLocaleString("ru-RU")} {it.currency === "KGS" ? "с" : it.currency}
                                  </td>
                                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                                    {it.amount_kgs.toLocaleString("ru-RU")} {sym}
                                  </td>
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
              <tr style={{ background: "rgba(99,102,241,0.1)", fontWeight: 700 }}>
                <td colSpan={2}>Итого {title.toLowerCase()}:</td>
                <td style={{ textAlign: "right" }}>{subtotal.toLocaleString("ru-RU")} {sym}</td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Отчёт по категориям</h1>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={onExport} disabled={exporting || !data}
            style={{ background: "#107C41", color: "#fff" }}>
            {exporting ? "..." : "📊 Excel"}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label>Месяц</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_RU_FULL.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Год</label>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 90 }} />
          </div>
          <div>
            <label>Подразделение</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Все</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="muted" style={{ fontSize: 12, marginLeft: 12 }}>
            Валюта: <b>{display === "USD" ? "USD ($)" : "KGS (с)"}</b>. Без имён сотрудников — только цифры.
          </div>
        </div>
      </div>

      {err && <div className="card" style={{ color: "var(--danger)" }}>Ошибка: {err}</div>}
      {!data && !err && <div className="muted">Загрузка...</div>}

      {data && (
        <>
          {renderSection("Операционные расходы", data.operational, data.operational_subtotal, "op")}
          {renderSection("Прочие расходы", data.other, data.other_subtotal, "other")}

          <div className="card" style={{ marginTop: 16, padding: 16 }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <span>Итого расход:</span>
              <b style={{ color: "var(--danger)" }}>{data.total_expenses.toLocaleString("ru-RU")} {sym}</b>
            </div>
            <div className="row between" style={{ marginBottom: 6 }}>
              <span>Итого приход:</span>
              <b style={{ color: "var(--success)" }}>{data.total_income.toLocaleString("ru-RU")} {sym}</b>
            </div>
            <hr />
            <div className="row between" style={{ fontSize: 18, fontWeight: 700 }}>
              <span>Результат периода:</span>
              <span style={{ color: data.result >= 0 ? "var(--success)" : "var(--danger)" }}>
                {data.result >= 0 ? "+" : ""}{data.result.toLocaleString("ru-RU")} {sym}
                {data.result >= 0 ? " ✅" : " ⚠️"}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
