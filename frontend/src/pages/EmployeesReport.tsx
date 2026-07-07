import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, downloadFile } from "../api/client";
import { useToast } from "../components/Toast";
import { useDisplayCurrency } from "../context/CurrencyContext";
import { listDepartments, type Department } from "../api/departments";
import EmployeeDetailRows from "./EmployeeDetailRows";

interface EmployeeRow {
  user_id: number;
  name: string;
  received: number;
  transferred_out: number;
  spent: number;
  balance: number;
  debt: number;
}

interface Report {
  year: number | null;
  month: number | null;
  date_from?: string;
  date_to?: string;
  rows: EmployeeRow[];
  currency: "KGS" | "USD";
  rate: number | null;
}

const MONTH_RU_FULL = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

// YYYY-MM-DD по локальному времени (без сдвига часового пояса, как у toISOString)
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function EmployeesReport() {
  const toast = useToast();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  // Режим периода: "month" — месяц+год (как было), "range" — произвольный диапазон дат.
  const [mode, setMode] = useState<"month" | "range">("month");
  const [dateFrom, setDateFrom] = useState(() => ymd(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(() => ymd(today));
  const { display } = useDisplayCurrency();
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [details, setDetails] = useState<Record<number, any[] | null>>({});
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<number | "">("");

  useEffect(() => {
    listDepartments().then(setDepartments).catch(() => {});
  }, []);

  function toggle(uid: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
    // Подгружаем детали по требованию — только операции выбранного периода.
    if (!details[uid]) {
      let from: string, to: string;
      if (mode === "range" && dateFrom && dateTo) {
        from = new Date(dateFrom + "T00:00:00").toISOString();
        to = new Date(new Date(dateTo + "T00:00:00").getTime() + 86400000).toISOString();  // конец дня «по» (exclusive)
      } else {
        from = new Date(year, month - 1, 1).toISOString();
        to = new Date(year, month, 1).toISOString();  // первый день след. месяца (exclusive)
      }
      api<any>(`/api/users/${uid}/balance?date_from=${from}&date_to=${to}`)
        .then((d) => setDetails((prev) => ({ ...prev, [uid]: d.entries || [] })))
        .catch(() => setDetails((prev) => ({ ...prev, [uid]: [] })));
    }
  }

  const rangeReady = mode === "month" || (!!dateFrom && !!dateTo);

  // Query-параметры периода для всех эндпоинтов отчёта (JSON и xlsx).
  function periodQuery(): string {
    return mode === "range" && dateFrom && dateTo
      ? `date_from=${dateFrom}&date_to=${dateTo}`
      : `year=${year}&month=${month}`;
  }
  // Суффикс имени файла Excel.
  function fileSuffix(): string {
    return mode === "range" && dateFrom && dateTo
      ? `${dateFrom}_${dateTo}`
      : `${year}_${String(month).padStart(2, "0")}`;
  }

  function reload() {
    setErr(null);
    if (!rangeReady) return;  // ждём, пока заданы обе даты периода
    const dep = departmentId ? `&department_id=${departmentId}` : "";
    api<Report>(`/api/reports/employees?${periodQuery()}&currency=${display}${dep}&_t=${Date.now()}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }

  useEffect(() => {
    setData(null);
    setDetails({});  // сбросить кеш деталей при смене периода
    setExpanded(new Set());
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, mode, dateFrom, dateTo, display, departmentId]);

  async function onExport() {
    setExporting(true);
    try {
      await downloadFile(
        `/api/reports/employees.xlsx?${periodQuery()}&currency=${display}`,
        `employees_${fileSuffix()}_${display}.xlsx`,
      );
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось скачать");
    } finally {
      setExporting(false);
    }
  }

  const [exportingUid, setExportingUid] = useState<number | null>(null);
  async function onExportEmployee(uid: number, name: string) {
    setExportingUid(uid);
    try {
      const safeName = name.replace(/[^\wа-яА-ЯёЁ-]+/g, "_");
      await downloadFile(
        `/api/reports/employees/${uid}/details.xlsx?${periodQuery()}`,
        `${safeName}_${fileSuffix()}.xlsx`,
      );
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось скачать");
    } finally {
      setExportingUid(null);
    }
  }

  const sym = data?.currency === "USD" ? "$" : "с";

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Отчёт по сотрудникам</h1>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={onExport} disabled={exporting || !data}
            style={{ background: "#107C41", color: "#fff" }}>
            {exporting ? "..." : "Excel"}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label>Период</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as "month" | "range")}>
              <option value="month">За месяц</option>
              <option value="range">Произвольный</option>
            </select>
          </div>
          {mode === "month" ? (
            <>
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
            </>
          ) : (
            <>
              <div>
                <label>С</label>
                <input type="date" value={dateFrom} max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label>По</label>
                <input type="date" value={dateTo} min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </>
          )}
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
            Валюта: <b>{display === "USD" ? "USD ($)" : "KGS (с)"}</b> — меняется тумблером в шапке.
            <br />Остаток — накопительный к концу периода (переходит из месяца в месяц).
          </div>
        </div>
      </div>

      {err && <div className="card" style={{ color: "var(--danger)" }}>Ошибка: {err}</div>}
      {!data && !err && <div className="muted">Загрузка...</div>}

      {data && (
        <div className="card" style={{ overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th style={{ textAlign: "right" }}>Получил</th>
                <th style={{ textAlign: "right" }}>Передал дальше</th>
                <th style={{ textAlign: "right" }}>Потратил</th>
                <th style={{ textAlign: "right" }}>Остаток</th>
                <th style={{ textAlign: "right" }}>Долг</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr><td colSpan={6} className="muted">Пусто за этот период</td></tr>
              )}
              {data.rows.map((r) => (
                <Fragment key={r.user_id}>
                  <tr onClick={() => toggle(r.user_id)} style={{ cursor: "pointer" }}>
                    <td>
                      <span style={{ marginRight: 6 }}>{expanded.has(r.user_id) ? "▼" : "▶"}</span>
                      <Link
                        to={`/reports/employees/${r.user_id}?month=${month}&year=${year}`}
                        onClick={(e) => e.stopPropagation()}
                        title="Открыть профиль сотрудника"
                      >
                        {r.name}
                      </Link>
                      <button
                        type="button"
                        className="ghost"
                        onClick={(e) => { e.stopPropagation(); onExportEmployee(r.user_id, r.name); }}
                        disabled={exportingUid === r.user_id}
                        title="Скачать Excel с развёрткой операций за выбранный месяц"
                        style={{ marginLeft: 8, padding: "2px 8px", fontSize: 12 }}
                      >
                        {exportingUid === r.user_id ? "..." : "Excel"}
                      </button>
                    </td>
                    <td style={{ textAlign: "right" }}>{r.received ? `${r.received.toLocaleString("ru-RU")} ${sym}` : "—"}</td>
                    <td style={{ textAlign: "right" }} className="muted">
                      {r.transferred_out ? `${r.transferred_out.toLocaleString("ru-RU")} ${sym}` : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>{r.spent ? `${r.spent.toLocaleString("ru-RU")} ${sym}` : "—"}</td>
                    <td style={{
                      textAlign: "right", fontWeight: 600,
                      color: r.balance < 0 ? "var(--danger)" : r.balance > 0 ? "var(--success)" : undefined,
                    }}>
                      {r.balance.toLocaleString("ru-RU")} {sym}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600, color: r.debt > 0 ? "var(--danger)" : undefined }}>
                      {r.debt > 0 ? `${r.debt.toLocaleString("ru-RU")} ${sym}` : "—"}
                    </td>
                  </tr>
                  {expanded.has(r.user_id) && (
                    <tr>
                      <td colSpan={6} style={{ background: "var(--bg-subtle, rgba(255,255,255,0.03))", padding: 12 }}>
                        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
                          <EmployeeDetailRows entries={details[r.user_id]} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
