import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import {
  approveRequest,
  listRequests,
  rejectRequest,
  type MoneyRequest,
  type RequestStatus,
} from "../api/requests";

const STATUS_RU: Record<RequestStatus, string> = {
  draft: "Черновик",
  pending: "На одобрении",
  approved: "Одобрена",
  rejected: "Отклонена",
};

const STATUS_CLS: Record<RequestStatus, string> = {
  draft: "pending",
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
};

export default function Requests() {
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<MoneyRequest[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | RequestStatus>("");
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const canCreate = user?.role === "accountable" || user?.role === "auditor";

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
          <option value="rejected">Отклонённые</option>
        </select>
      </div>

      {err && <div className="card" style={{ color: "var(--danger)" }}>{err}</div>}
      {!items && !err && <div className="muted">Загрузка...</div>}

      {items && (
        <div className="card" style={{ overflow: "auto" }}>
          {sorted.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📋</div>
              Заявок пока нет
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Заявитель</th>
                  <th>Адресат</th>
                  <th style={{ textAlign: "right" }}>Сумма</th>
                  <th>Статус</th>
                  <th>Дата</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const canDecide =
                    r.status === "pending" && r.approver_id === user?.id;
                  const busy = busyId === r.id;
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/requests/${r.id}`}>{r.title}</Link>
                      </td>
                      <td className="muted">{r.requester_name || "—"}</td>
                      <td className="muted">{r.approver_name || "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>
                        {Number(r.total_amount).toLocaleString("ru-RU")} {(r.currency || "KGS") === "KGS" ? "с" : r.currency}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_CLS[r.status]}`}>
                          {STATUS_RU[r.status]}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {new Date(r.created_at).toLocaleDateString("ru-RU")}
                      </td>
                      <td>
                        {canDecide && (
                          <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                            <button
                              className="success"
                              style={{ padding: "4px 10px", fontSize: 12 }}
                              onClick={() => handleApprove(r)}
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
    </div>
  );
}
