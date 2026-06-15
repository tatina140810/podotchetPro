import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, downloadFile } from "../api/client";
import { useToast } from "../components/Toast";
import { useDisplayCurrency } from "../context/CurrencyContext";
import { listDepartments, type Department } from "../api/departments";

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
  year: number;
  month: number;
  rows: EmployeeRow[];
  currency: "KGS" | "USD";
  rate: number | null;
}

const MONTH_RU_FULL = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export default function EmployeesReport() {
  const toast = useToast();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
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
    // Подгружаем детали по требованию — только операции выбранного месяца.
    if (!details[uid]) {
      const dateFrom = new Date(year, month - 1, 1).toISOString();
      const dateTo = new Date(year, month, 1).toISOString();  // первый день след. месяца (exclusive)
      api<any>(`/api/users/${uid}/balance?date_from=${dateFrom}&date_to=${dateTo}`)
        .then((d) => setDetails((prev) => ({ ...prev, [uid]: d.entries || [] })))
        .catch(() => setDetails((prev) => ({ ...prev, [uid]: [] })));
    }
  }

  const KIND_RU: Record<string, string> = {
    topup: "Выдача (получил)",
    topup_out: "Выдача (отдал)",
    income: "Приход",
    transfer_in: "↙ Получил перевод",
    transfer_out: "↗ Передал",
    request_approved: "Заявка (получено)",
    request_approved_out: "Заявка (выдал)",
    expense: "Расход",
  };

  function reload() {
    setErr(null);
    const dep = departmentId ? `&department_id=${departmentId}` : "";
    api<Report>(`/api/reports/employees?year=${year}&month=${month}&currency=${display}${dep}&_t=${Date.now()}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }

  useEffect(() => {
    setData(null);
    setDetails({});  // сбросить кеш деталей при смене периода
    setExpanded(new Set());
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, display, departmentId]);

  async function onExport() {
    setExporting(true);
    try {
      await downloadFile(
        `/api/reports/employees.xlsx?year=${year}&month=${month}&currency=${display}`,
        `employees_${year}_${String(month).padStart(2, "0")}_${display}.xlsx`,
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
        `/api/reports/employees/${uid}/details.xlsx?year=${year}&month=${month}`,
        `${safeName}_${year}_${String(month).padStart(2, "0")}.xlsx`,
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
                        {details[r.user_id] === undefined && <div className="muted">Загрузка деталей...</div>}
                        {details[r.user_id] !== undefined && details[r.user_id]!.length === 0 && (
                          <div className="muted">Деталей нет</div>
                        )}
                        {details[r.user_id] && details[r.user_id]!.length > 0 && (
                          <table>
                            <thead>
                              <tr>
                                <th>Дата</th>
                                <th>Тип</th>
                                <th>Кто/Категория</th>
                                <th style={{ textAlign: "right" }}>Сумма</th>
                                <th>Описание</th>
                              </tr>
                            </thead>
                            <tbody>
                              {details[r.user_id]!.map((d: any, idx: number) => {
                                const amt = Number(d.amount);
                                const cur = (d.currency || "KGS") as string;
                                const symNative =
                                  cur === "USD" ? "$" : cur === "RUB" ? "₽" : cur === "EUR" ? "€" : "с";
                                return (
                                  <tr key={idx}>
                                    <td className="muted" style={{ fontSize: 12 }}>
                                      {d.created_at ? new Date(d.created_at).toLocaleDateString("ru-RU") : ""}
                                    </td>
                                    <td style={{ fontSize: 12 }}>{KIND_RU[d.kind] || d.kind}</td>
                                    <td style={{ fontSize: 12 }}>{d.counterparty || "—"}</td>
                                    <td style={{
                                      textAlign: "right", fontWeight: 600,
                                      color: amt < 0 ? "var(--danger)" : "var(--success)",
                                    }}>
                                      {amt > 0 ? "+" : ""}{amt.toLocaleString("ru-RU")} {symNative}
                                    </td>
                                    <td className="muted" style={{ fontSize: 12 }}>{d.note || ""}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
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
