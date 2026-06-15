import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, downloadFile } from "../api/client";
import { useToast } from "../components/Toast";
import { useDisplayCurrency } from "../context/CurrencyContext";

const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

interface DeptSummary {
  received: number; spent: number; transferred_in: number;
  transferred_out: number; result: number; operations_count: number;
}
interface Dept {
  id: number; name: string; summary: DeptSummary;
  top_categories: { name: string; amount: number; percent: number }[];
  employees: { id: number; name: string; spent: number; received: number }[];
}
interface Report {
  period: { month: number; year: number };
  currency: "KGS" | "USD";
  departments: Dept[];
  totals: { received: number; spent: number; result: number };
  no_department: { spent: number; received: number; operations_count: number };
}

export default function ReportsDepartments() {
  const toast = useToast();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const { display } = useDisplayCurrency();
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setData(null); setErr(null);
    api<Report>(`/api/reports/by-department?year=${year}&month=${month}&currency=${display}&_t=${Date.now()}`)
      .then(setData).catch((e) => setErr(e.message));
  }, [year, month, display]);

  const sym = data?.currency === "USD" ? "$" : "с";
  const fmt = (n: number) => n.toLocaleString("ru-RU");

  function toggle(id: number) {
    setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  async function onExport() {
    setExporting(true);
    try {
      await downloadFile(
        `/api/reports/by-department/export?year=${year}&month=${month}&currency=${display}`,
        `departments_${year}_${String(month).padStart(2, "0")}_${display}.xlsx`,
      );
    } catch (e: any) { toast.show("error", e.message || "Не удалось скачать"); }
    finally { setExporting(false); }
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Отчёт по подразделениям</h1>
        <button type="button" onClick={onExport} disabled={exporting || !data} style={{ background: "#107C41", color: "#fff" }}>
          {exporting ? "..." : "Excel"}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label>Месяц</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label>Год</label>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 90 }} />
          </div>
        </div>
      </div>

      {err && <div className="card" style={{ color: "var(--danger)" }}>Ошибка: {err}</div>}
      {!data && !err && <div className="muted">Загрузка...</div>}

      {data && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
            <div className="card"><div className="muted" style={{ fontSize: 12 }}>Всего приход</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--success)", marginTop: 4 }}>{fmt(data.totals.received)} {sym}</div></div>
            <div className="card"><div className="muted" style={{ fontSize: 12 }}>Всего расход</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--danger)", marginTop: 4 }}>{fmt(data.totals.spent)} {sym}</div></div>
            <div className="card"><div className="muted" style={{ fontSize: 12 }}>Результат периода</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: data.totals.result >= 0 ? "var(--success)" : "var(--danger)" }}>
                {data.totals.result >= 0 ? "+" : ""}{fmt(data.totals.result)} {sym}</div></div>
          </div>

          <div className="grid" style={{ gap: 10 }}>
            {data.departments.map((d) => {
              const isOpen = open.has(d.id);
              const s = d.summary;
              return (
                <div key={d.id} className="card" style={{ padding: 0 }}>
                  <div className="row between" style={{ padding: 14, cursor: "pointer", flexWrap: "wrap", gap: 8 }} onClick={() => toggle(d.id)}>
                    <span style={{ fontWeight: 600 }}>{isOpen ? "▼" : "▶"} {d.name}</span>
                    <div className="row" style={{ gap: 16, flexWrap: "wrap", fontSize: 14 }}>
                      <span className="muted">приход <b style={{ color: "var(--success)" }}>{fmt(s.received)} {sym}</b></span>
                      <span className="muted">расход <b style={{ color: "var(--danger)" }}>{fmt(s.spent)} {sym}</b></span>
                      <span className="muted">итог <b style={{ color: s.result >= 0 ? "var(--success)" : "var(--danger)" }}>{s.result >= 0 ? "+" : ""}{fmt(s.result)} {sym}</b></span>
                      <span className="muted">{s.operations_count} опер.</span>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16, padding: 14, paddingTop: 0 }}>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>Топ категорий расходов</div>
                        {d.top_categories.length === 0 && <div className="muted">Нет расходов</div>}
                        {d.top_categories.map((c, i) => (
                          <div key={i} className="row between" style={{ padding: "4px 0" }}>
                            <span>{c.name}</span>
                            <span><b>{fmt(c.amount)} {sym}</b> <span className="muted" style={{ fontSize: 12 }}>{c.percent}%</span></span>
                          </div>
                        ))}
                      </div>
                      <div style={{ overflow: "auto" }}>
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>Сотрудники</div>
                        <table>
                          <thead><tr><th>Имя</th><th style={{ textAlign: "right" }}>Получил</th><th style={{ textAlign: "right" }}>Потратил</th></tr></thead>
                          <tbody>
                            {d.employees.length === 0 && <tr><td colSpan={3} className="muted">Нет сотрудников</td></tr>}
                            {d.employees.map((e) => (
                              <tr key={e.id}>
                                <td><Link to={`/reports/employees/${e.id}?month=${month}&year=${year}`}>{e.name}</Link></td>
                                <td style={{ textAlign: "right" }}>{fmt(e.received)} {sym}</td>
                                <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(e.spent)} {sym}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {(data.no_department.spent > 0 || data.no_department.received > 0 || data.no_department.operations_count > 0) && (
            <div className="card" style={{ marginTop: 16, borderColor: "var(--warning)" }}>
              <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Без подразделения</div>
                  <div className="muted" style={{ fontSize: 12 }}>Операции без указанного подразделения</div>
                </div>
                <div className="row" style={{ gap: 16, fontSize: 14 }}>
                  <span className="muted">приход <b style={{ color: "var(--success)" }}>{fmt(data.no_department.received)} {sym}</b></span>
                  <span className="muted">расход <b style={{ color: "var(--danger)" }}>{fmt(data.no_department.spent)} {sym}</b></span>
                  <span className="muted">{data.no_department.operations_count} опер.</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
