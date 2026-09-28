import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import {
  approveRequest,
  issueRequest,
  listRequests,
  rejectRequest,
  type MoneyRequest,
  type RequestStatus,
} from "../api/requests";
import { STATUS_CLS, statusLabel } from "../lib/requestStatus";
import AcceptRequestDialog from "../components/AcceptRequestDialog";

const cur = (c?: string | null) => ((c || "KGS") === "KGS" ? "с" : c);
// Упрощённая заявка после одобрения показывает сумму к выдаче (разноску принимающего).
const shownAmount = (r: MoneyRequest) =>
  r.flow === "simple" && r.handler_amount
    ? `${Number(r.handler_amount).toLocaleString("ru-RU")} ${cur(r.handler_currency)}`
    : `${Number(r.total_amount).toLocaleString("ru-RU")} ${cur(r.currency)}`;

export default function Requests() {
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<MoneyRequest[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | RequestStatus>("");
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [accepting, setAccepting] = useState<MoneyRequest | null>(null);
  // Подотчётный видит только свои заявки — столбец «Заявитель» ему не нужен,
  // вместо него важен «Принимает заявку» (2026-09-28).
  const showRequester = user?.role !== "accountable";

  async function handleIssue(r: MoneyRequest) {
    if (!confirm(`Выдать ${r.requester_name ?? ""} ${shownAmount(r)} по заявке «${r.title}»?`)) return;
    setBusyId(r.id);
    try {
      await issueRequest(r.id);
      toast.show("success", "Выдано — сотруднику ушло «ждём отчёт»");
      reload();
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusyId(null);
    }
  }

  // Заявку может подать любой сотрудник, включая admin/gen_director (2026-09-17):
  // админы тоже запрашивают средства. Бэкенд гейта по роли больше не имеет.
  const canCreate = !!user;

  function reload() {
    setErr(null);
    listRequests(statusFilter ? { status: statusFilter } : {})
      .then(setItems)
      .catch((e) => setErr(e.message));
  }

  useEffect(() => { reload(); }, [statusFilter]);

  async function handleApprove(r: MoneyRequest) {
    const cur = r.currency || "KGS";
    const curLabel = cur === "KGS" ? "с" : cur;
    if (!confirm(`Одобрить «${r.title}» на ${Number(r.total_amount).toLocaleString("ru-RU")} ${curLabel}?`)) return;
    setBusyId(r.id);
    try {
      await approveRequest(r.id);
      toast.show("success", "Заявка одобрена, баланс пересчитан");
      reload();
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(r: MoneyRequest) {
    const comment = prompt("Причина отклонения?") || "";
    if (!comment.trim()) return;
    setBusyId(r.id);
    try {
      await rejectRequest(r.id, comment.trim());
      toast.show("success", "Отклонено");
      reload();
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusyId(null);
    }
  }

  const sorted = useMemo(() => {
    if (!items) return [];
    return [...items].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [items]);

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 16 }}>
        <h1 className="h1" style={{ margin: 0 }}>Заявки</h1>
        {canCreate && (
          <Link to="/requests/new">
            <button>+ Новая заявка</button>
          </Link>
        )}
      </div>

      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <label style={{ margin: 0 }}>Статус:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RequestStatus | "")}
          style={{ width: "auto" }}
        >
          <option value="">Все</option>
          <option value="draft">Черновики</option>
          <option value="pending">На одобрении</option>
          <option value="approved">Одобренные</option>
          <option value="accepted">Одобрены, не выданы</option>
          <option value="issued">Выдано, ждём чек</option>
          <option value="rejected">Отклонённые</option>
        </select>
      </div>

      {err && <div className="card" style={{ color: "var(--danger)" }}>{err}</div>}
      {!items && !err && <div className="muted">Загрузка...</div>}

      {items && (
        <div className="card" style={{ overflow: "auto" }}>
          {sorted.length === 0 ? (
            <div className="empty-state">
              <div className="icon"></div>
              Заявок пока нет
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Название</th>
                  {showRequester && <th>Заявитель</th>}
                  <th>Принимает заявку</th>
                  <th style={{ textAlign: "right" }}>Сумма</th>
                  <th>Статус</th>
                  <th>Чек</th>
                  <th>Дата</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const mine = r.approver_id === user?.id;
                  const simple = r.flow === "simple";
                  const canDecide = r.status === "pending" && mine;
                  const canIssue = simple && r.status === "accepted" && mine;
                  const busy = busyId === r.id;
                  const receipt = !simple || !["issued", "closed"].includes(r.status)
                    ? "—" : r.receipts.length ? "есть" : r.no_receipt ? "нет чека" : "нет";
                  const canClose = simple && r.status === "issued" && mine;
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/requests/${r.id}`}>{r.title}</Link>
                      </td>
                      {showRequester && <td className="muted">{r.requester_name || "—"}</td>}
                      <td className="muted">{r.approver_name || "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{shownAmount(r)}</td>
                      <td>
                        <span className={`badge ${STATUS_CLS[r.status] ?? "pending"}`}>
                          {statusLabel(r.status, r.requester_id === user?.id)}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }} title={r.no_receipt_comment ?? undefined}>{receipt}</td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {new Date(r.created_at).toLocaleDateString("ru-RU")}
                      </td>
                      <td>
                        {canClose && (
                          <div className="row" style={{ justifyContent: "flex-end" }}>
                            <Link to={`/requests/${r.id}`}><button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }}>Провести</button></Link>
                          </div>
                        )}
                        {canIssue && (
                          <div className="row" style={{ justifyContent: "flex-end" }}>
                            <button className="success" style={{ padding: "4px 10px", fontSize: 12 }}
                              onClick={() => handleIssue(r)} disabled={busy} title="Деньги выданы сотруднику">Выдал</button>
                          </div>
                        )}
                        {canDecide && (
                          <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                            <button
                              className="success"
                              style={{ padding: "4px 10px", fontSize: 12 }}
                              onClick={() => (simple ? setAccepting(r) : handleApprove(r))}
                              disabled={busy}
                              title="Одобрить"
                            >✓</button>
                            <button
                              className="danger"
                              style={{ padding: "4px 10px", fontSize: 12 }}
                              onClick={() => handleReject(r)}
                              disabled={busy}
                              title="Отклонить"
                            >✗</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {accepting && (
        <AcceptRequestDialog req={accepting} onClose={() => setAccepting(null)}
          onDone={() => { setAccepting(null); reload(); }} />
      )}
    </div>
  );
}
