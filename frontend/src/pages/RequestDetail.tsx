import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import {
  approveRequest,
  deleteRequest,
  getRequest,
  rejectRequest,
  submitRequest,
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

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const requestId = Number(id);
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [req, setReq] = useState<MoneyRequest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");

  function reload() {
    setErr(null);
    getRequest(requestId).then(setReq).catch((e) => setErr(e.message));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  if (err) return <div className="container"><div className="card" style={{ color: "var(--danger)" }}>{err}</div></div>;
  if (!req) return <div className="container"><div className="muted">Загрузка...</div></div>;

  const cur = req.currency || "KGS";
  const curLabel = cur === "KGS" ? "с" : cur;

  const isMine = req.requester_id === user?.id;
  const isApprover = req.approver_id === user?.id;
  const canSubmit = isMine && req.status === "draft";
  const canApprove = isApprover && req.status === "pending";
  const canDelete = isMine && (req.status === "draft" || req.status === "rejected");

  async function doSubmit() {
    setBusy(true);
    try {
      const updated = await submitRequest(requestId);
      setReq(updated);
      toast.show("success", "Отправлено на одобрение");
    } catch (e: any) {
      toast.show("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doApprove() {
    setBusy(true);
    try {
      const updated = await approveRequest(requestId);
      setReq(updated);
      toast.show("success", "Заявка одобрена");
    } catch (e: any) {
      toast.show("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doReject() {
    if (!comment.trim()) {
      toast.show("error", "Укажите причину отклонения");
      return;
    }
    setBusy(true);
    try {
      const updated = await rejectRequest(requestId, comment.trim());
      setReq(updated);
      setRejecting(false);
      setComment("");
      toast.show("success", "Заявка отклонена");
    } catch (e: any) {
      toast.show("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!confirm("Удалить заявку?")) return;
    setBusy(true);
    try {
      await deleteRequest(requestId);
      toast.show("success", "Удалено");
      nav("/requests");
    } catch (e: any) {
      toast.show("error", e.message);
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>{req.title}</h1>
        <Link to="/requests" className="muted" style={{ fontSize: 13 }}>← К списку</Link>
      </div>

      <div className="card grid">
        <div className="row between">
          <span className="muted">Тип</span>
          <span
            className="badge"
            style={{
              background: req.is_expense_on_approve ? "#f59e0b" : "#3b82f6",
              color: "white",
              fontSize: 12,
            }}
          >
            {req.is_expense_on_approve ? "Заявка на расход" : "Выдача под отчёт"}
          </span>
        </div>
        <div className="row between">
          <span className="muted">Статус</span>
          <span className={`badge ${STATUS_CLS[req.status]}`}>{STATUS_RU[req.status]}</span>
        </div>
        <div className="row between">
          <span className="muted">Заявитель</span>
          <span>{req.requester_name || "—"}</span>
        </div>
        <div className="row between">
          <span className="muted">Кому отправлено</span>
          <span>{req.approver_name || "—"}</span>
        </div>
        <div className="row between">
          <span className="muted">Валюта</span>
          <span><b>{cur}</b></span>
        </div>
        <div className="row between">
          <span className="muted">Создана</span>
          <span>{new Date(req.created_at).toLocaleString("ru-RU")}</span>
        </div>
        {req.approved_at && (
          <div className="row between">
            <span className="muted">Одобрена</span>
            <span>{new Date(req.approved_at).toLocaleString("ru-RU")}</span>
          </div>
        )}
        {req.status === "rejected" && req.comment && (
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Причина отклонения</div>
            <div style={{ color: "var(--danger)" }}>{req.comment}</div>
          </div>
        )}
      </div>

      {req.status === "approved" && req.is_expense_on_approve && (
        <div className="card" style={{ marginTop: 12, borderLeft: "4px solid var(--success)" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            Одобрено. Расход создан автоматически.
          </div>
          <div className="row between" style={{ fontSize: 13 }}>
            <span className="muted">Категория</span>
            <span>{req.expense_category_name || "—"}</span>
          </div>
          <div className="row between" style={{ fontSize: 13 }}>
            <span className="muted">Сумма</span>
            <b>{Number(req.total_amount).toLocaleString("ru-RU")} {curLabel}</b>
          </div>
          <div className="row between" style={{ fontSize: 13 }}>
            <span className="muted">Записан на</span>
            <span>{req.requester_name}</span>
          </div>
          <div className="row between" style={{ fontSize: 13 }}>
            <span className="muted">Финансировал</span>
            <span>{req.approver_name}</span>
          </div>
        </div>
      )}

      <h2 className="h2" style={{ marginTop: 18 }}>Строки</h2>
      <div className="card" style={{ overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Описание</th>
              <th>Категория</th>
              <th style={{ textAlign: "right" }}>Кол-во</th>
              <th style={{ textAlign: "right" }}>Сумма</th>
              <th style={{ textAlign: "right" }}>Итого</th>
            </tr>
          </thead>
          <tbody>
            {req.items.map((it) => {
              const subtotal = Number(it.amount) * it.quantity;
              return (
                <tr key={it.id}>
                  <td>{it.description}</td>
                  <td className="muted">{it.category_name || "—"}</td>
                  <td style={{ textAlign: "right" }}>{it.quantity}</td>
                  <td style={{ textAlign: "right" }}>
                    {Number(it.amount).toLocaleString("ru-RU")} {curLabel}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {subtotal.toLocaleString("ru-RU")} {curLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ textAlign: "right", fontWeight: 600 }}>Итого по заявке:</td>
              <td style={{ textAlign: "right", fontWeight: 700, fontSize: 16 }}>
                {Number(req.total_amount).toLocaleString("ru-RU")} {curLabel}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="row" style={{ marginTop: 18, justifyContent: "flex-end", gap: 8 }}>
        {canDelete && (
          <button className="danger" onClick={doDelete} disabled={busy}>Удалить</button>
        )}
        {canSubmit && (
          <button onClick={doSubmit} disabled={busy}>Отправить на одобрение</button>
        )}
        {canApprove && (
          <>
            <button className="ghost" onClick={() => setRejecting((v) => !v)} disabled={busy}>
              Отклонить
            </button>
            <button className="success" onClick={doApprove} disabled={busy}>
              Одобрить
            </button>
          </>
        )}
      </div>

      {rejecting && canApprove && (
        <div className="card" style={{ marginTop: 12 }}>
          <label>Причина отклонения</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Опишите, почему отклоняете"
          />
          <div className="row" style={{ marginTop: 10, justifyContent: "flex-end", gap: 8 }}>
            <button className="ghost" onClick={() => { setRejecting(false); setComment(""); }}>
              Отмена
            </button>
            <button className="danger" onClick={doReject} disabled={busy}>
              Подтвердить отклонение
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
