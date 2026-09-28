import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import {
  approveRequest,
  deleteRequest,
  getRequest,
  issueRequest,
  rejectRequest,
  submitRequest,
  type MoneyRequest,
  type MoneyRequestReceipt,
} from "../api/requests";
import { STATUS_CLS, statusLabel } from "../lib/requestStatus";
import AcceptRequestDialog from "../components/AcceptRequestDialog";
import { SimpleRequestInfo } from "../components/SimpleRequestInfo";
import { RequestReceipts } from "../components/RequestReceipts";
import { ApproveRequestPanel } from "../components/ApproveRequestPanel";
import { RequestItemsTable } from "../components/RequestItemsTable";
import type { ApproveEdits } from "../api/requests";
import { api } from "../api/client";
import { listDepartments, type Department } from "../api/departments";
import type { CatOpt } from "../components/CategoryPicker";


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
  // Режим «проверить и одобрить»: адресат правит поля перед одобрением.
  const [checking, setChecking] = useState(false);
  const [accepting, setAccepting] = useState(false); // упрощённая заявка: окно разноски
  const [cats, setCats] = useState<CatOpt[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  function reload() {
    setErr(null);
    getRequest(requestId).then(setReq).catch((e) => setErr(e.message));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  // Справочники нужны только адресату (для панели проверки) — грузим один раз.
  useEffect(() => {
    api<CatOpt[]>("/api/categories").then(setCats).catch(() => {});
    listDepartments().then(setDepartments).catch(() => {});
  }, []);

  if (err) return <div className="container"><div className="card" style={{ color: "var(--danger)" }}>{err}</div></div>;
  if (!req) return <div className="container"><div className="muted">Загрузка...</div></div>;

  const cur = req.currency || "KGS";
  const curLabel = cur === "KGS" ? "с" : cur;

  const isMine = req.requester_id === user?.id;
  const isApprover = req.approver_id === user?.id;
  const canSubmit = isMine && req.status === "draft";
  const canApprove = isApprover && req.status === "pending";
  const canDelete = isMine && (req.status === "draft" || req.status === "rejected");
  const simple = req.flow === "simple";
  const canIssue = simple && isApprover && req.status === "accepted";

  async function doIssue() {
    if (!req) return;
    if (!confirm(`Выдать ${req.requester_name ?? ""} ${Number(req.handler_amount).toLocaleString("ru-RU")} ${req.handler_currency === "KGS" ? "с" : req.handler_currency}?`)) return;
    setBusy(true);
    try {
      setReq(await issueRequest(requestId));
      toast.show("success", "Выдано — сотруднику ушло «ждём отчёт»");
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  // Чеки: только у одобренной заявки. Крепить — заявитель, адресат, директор
  // (то же правило продублировано на бэкенде). Удалять — свой документ; директор — любой.
  const isDirector = user?.role === "superadmin" || user?.role === "admin" || user?.role === "gen_director";
  const showReceipts = req.status === "approved";
  const canAttach = showReceipts && (isMine || isApprover || isDirector);

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

  async function doApprove(edits?: ApproveEdits) {
    setBusy(true);
    try {
      const updated = await approveRequest(requestId, edits);
      setReq(updated);
      setChecking(false);
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
            {simple ? "Заявка сотрудника" : req.is_expense_on_approve ? "Заявка на расход" : "Выдача под отчёт"}
          </span>
        </div>
        <div className="row between">
          <span className="muted">Статус</span>
          <span className={`badge ${STATUS_CLS[req.status] ?? "pending"}`}>{statusLabel(req.status, isMine)}</span>
        </div>
        <div className="row between">
          <span className="muted">Заявитель</span>
          <span>{req.requester_name || "—"}</span>
        </div>
        <div className="row between">
          <span className="muted">{simple ? "Принимает заявку" : "Кому отправлено"}</span>
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

      {simple && <SimpleRequestInfo req={req} />}

      {showReceipts && (
        <RequestReceipts
          requestId={requestId}
          receipts={req.receipts || []}
          canAttach={canAttach}
          canDelete={(r: MoneyRequestReceipt) => isDirector || r.uploaded_by_id === user?.id}
          onChanged={(receipts) => setReq((prev) => (prev ? { ...prev, receipts } : prev))}
        />
      )}

      <h2 className="h2" style={{ marginTop: 18 }}>Строки</h2>
      <RequestItemsTable items={req.items} total={req.total_amount} curLabel={curLabel} />

      <div className="row" style={{ marginTop: 18, justifyContent: "flex-end", gap: 8 }}>
        {canDelete && (
          <button className="danger" onClick={doDelete} disabled={busy}>Удалить</button>
        )}
        {canSubmit && (
          <button onClick={doSubmit} disabled={busy}>Отправить на одобрение</button>
        )}
        {canApprove && !checking && (
          <>
            <button className="ghost" onClick={() => setRejecting((v) => !v)} disabled={busy}>
              Отклонить
            </button>
            <button className="success" onClick={() => { setRejecting(false); if (simple) setAccepting(true); else setChecking(true); }} disabled={busy}>
              Одобрить
            </button>
          </>
        )}
        {canIssue && (
          <button className="success" onClick={doIssue} disabled={busy}>Выдал</button>
        )}
      </div>

      {checking && canApprove && (
        <ApproveRequestPanel
          req={req}
          cats={cats}
          departments={departments}
          busy={busy}
          onCancel={() => setChecking(false)}
          onConfirm={(edits) => doApprove(edits)}
        />
      )}

      {accepting && canApprove && (
        <AcceptRequestDialog req={req} onClose={() => setAccepting(false)}
          onDone={(r) => { setAccepting(false); setReq(r); }} />
      )}

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
