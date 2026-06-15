/**
 * Переиспользуемая форма расхода/передачи.
 * Встраивается в /expenses, /my-expenses (сверху списка) и /expenses/new (полная страница).
 *
 * Props:
 *   onSaved — вызывается после успешного создания (родитель решает: reload список / nav).
 *   onCancel — опционально, для рендера кнопки «Отмена».
 *   compact — слегка плотнее (для встраивания в страницу).
 */
import { useEffect, useMemo, useState } from "react";
import { api, uploadReceipt } from "../api/client";
import { useToast } from "../components/Toast";
import {
  isDirectorOrAuditor,
  useAuth,
  type UserOut,
} from "../context/AuthContext";
import { listColleagues } from "../api/users";
import { listDepartments, type Department } from "../api/departments";
import { createTransfer } from "../api/transfers";

type Kind = "expense" | "transfer";

interface Props {
  onSaved?: () => void;
  onCancel?: () => void;
  compact?: boolean;
}

export function NewExpenseForm({ onSaved, onCancel, compact }: Props) {
  const toast = useToast();
  const { user: me } = useAuth();

  const [kind, setKind] = useState<Kind>("expense");
  const [cats, setCats] = useState<any[]>([]);
  const [spec, setSpec] = useState<any>(null);
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  // Admin mode: вносим от лица другого пользователя. "" = себя.
  const [onBehalfOf, setOnBehalfOf] = useState<number | "">("");
  const [form, setForm] = useState({
    category_id: "" as any,
    department_id: "" as any,
    to_user_id: "" as number | "",
    transfer_to_user_id: "" as number | "",
    amount: "" as any,
    currency: "KGS",
    description: "",
    receipt_url: "" as string | null,
    spent_at: new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!me) return;
    api(`/api/specs/${me.id}`).then(setSpec).catch(() => {});
    api("/api/categories").then(setCats).catch(() => {});
    listColleagues().then(setColleagues).catch(() => {});
    listDepartments().then(setDepartments).catch(() => {});
  }, [me?.id]);

  const recipients = useMemo(() => {
    if (!me) return [];
    if (isDirectorOrAuditor(me.role)) return colleagues;
    return colleagues.filter((c) => c.supervisor_id === me.id);
  }, [colleagues, me]);

  const allowedIds: number[] | null = spec?.allowed_categories || null;
  const visibleCats = useMemo(() => {
    let out = allowedIds ? cats.filter((c: any) => allowedIds.includes(c.id)) : cats;
    // После выбора подразделения — показываем общие (department_id=null) + его категории.
    if (form.department_id) {
      const did = Number(form.department_id);
      out = out.filter((c: any) => c.department_id == null || c.department_id === did);
    }
    return out;
  }, [cats, allowedIds, form.department_id]);
  const requiresReceipt = !!spec?.requires_receipt;

  function resetForm() {
    setForm({
      category_id: "",
      department_id: "",
      to_user_id: "",
      transfer_to_user_id: "",
      amount: "",
      currency: "KGS",
      description: "",
      receipt_url: "",
      spent_at: new Date().toISOString().slice(0, 10),
    });
    // onBehalfOf не сбрасываем — admin часто вносит подряд несколько записей за одного
  }

  const isAdmin = me?.role === "admin" || me?.role === "superadmin";
  const onBehalfName = onBehalfOf
    ? colleagues.find((c) => c.id === onBehalfOf)?.name
    : null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const { url } = await uploadReceipt(f);
      setForm((s) => ({ ...s, receipt_url: url }));
      toast.show("success", "Чек загружен");
    } catch (err: any) {
      toast.show("error", err.message);
    } finally { setUploading(false); }
  }

  async function submitExpense() {
    if (requiresReceipt && !form.receipt_url) {
      toast.show("error", "Прикрепите фото чека");
      return false;
    }
    if (form.to_user_id && form.currency !== "KGS") {
      toast.show("error", "Передавать получателю можно только сомы (KGS)");
      return false;
    }
    if (!form.department_id) {
      toast.show("error", "Выберите подразделение");
      return false;
    }
    await api("/api/expenses", {
      method: "POST",
      body: {
        category_id: form.category_id ? Number(form.category_id) : null,
        department_id: Number(form.department_id),
        amount: Number(form.amount),
        currency: form.currency,
        description: form.description || null,
        receipt_url: form.receipt_url || null,
        spent_at: form.spent_at ? new Date(form.spent_at).toISOString() : null,
        to_user_id: form.to_user_id ? Number(form.to_user_id) : null,
        on_behalf_of_user_id: isAdmin && onBehalfOf ? Number(onBehalfOf) : null,
      },
    });
    const msgPart = onBehalfName ? ` (от лица ${onBehalfName})` : "";
    toast.show("success", (form.to_user_id ? "Расход + передача" : "Расход добавлен") + msgPart);
    return true;
  }

  async function submitTransfer() {
    if (!form.transfer_to_user_id) {
      toast.show("error", "Выберите получателя");
      return false;
    }
    await createTransfer({
      to_user_id: Number(form.transfer_to_user_id),
      amount: Number(form.amount),
      note: form.description.trim() || null,
    });
    toast.show("success", "Передано");
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!Number(form.amount) || Number(form.amount) <= 0) {
      toast.show("error", "Введите сумму больше 0");
      return;
    }
    setBusy(true);
    try {
      const ok = kind === "transfer" ? await submitTransfer() : await submitExpense();
      if (ok) {
        resetForm();
        onSaved?.();
      }
    } catch (err: any) {
      toast.show("error", err.message);
    } finally { setBusy(false); }
  }

  return (
    <div style={compact ? undefined : { maxWidth: 520 }}>
      {/* Admin mode: «Вношу от лица». Видно только админу. */}
      {isAdmin && (
        <div
          className="card"
          style={{
            marginBottom: 10,
            padding: "10px 14px",
            borderColor: onBehalfOf ? "var(--warning)" : undefined,
            borderWidth: onBehalfOf ? 2 : 1,
            background: onBehalfOf ? "rgba(253, 203, 110, 0.08)" : undefined,
          }}
        >
          <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14 }}>Вношу от лица:</span>
            <select
              value={onBehalfOf}
              onChange={(e) => setOnBehalfOf(e.target.value ? Number(e.target.value) : "")}
              style={{ width: "auto", flex: "0 1 220px" }}
            >
              <option value="">Себя ({me?.name || "admin"})</option>
              {colleagues.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          {onBehalfOf && (
            <div style={{ fontSize: 12, color: "var(--warning)", marginTop: 6 }}>
              Запись будет создана от имени <strong>{onBehalfName}</strong>.
              Аудит пометит вас как фактического автора.
            </div>
          )}
        </div>
      )}

      {/* Переключатель типа операции */}
      <div className="row" style={{ marginBottom: 10, gap: 0 }}>
        <button
          type="button"
          className={kind === "expense" ? "" : "ghost"}
          onClick={() => setKind("expense")}
          style={{ flex: 1, borderRadius: "10px 0 0 10px", fontSize: compact ? 13 : 15 }}
        >
          Расход
        </button>
        <button
          type="button"
          className={kind === "transfer" ? "" : "ghost"}
          onClick={() => setKind("transfer")}
          style={{ flex: 1, borderRadius: "0 10px 10px 0", fontSize: compact ? 13 : 15 }}
          disabled={recipients.length === 0}
          title={recipients.length === 0 ? "У вас нет подотчётных для передачи" : ""}
        >
          Передать
        </button>
      </div>

      <form onSubmit={submit} className="card grid">
        {kind === "expense" && (
          <div>
            <label>Подразделение</label>
            <select
              value={form.department_id}
              onChange={(e) => setForm({ ...form, department_id: e.target.value, category_id: "" })}
              required
            >
              <option value="">— выберите —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}
        {kind === "transfer" ? (
          <div>
            <label>Кому передать</label>
            <select
              value={form.transfer_to_user_id}
              onChange={(e) => setForm({ ...form, transfer_to_user_id: e.target.value ? Number(e.target.value) : "" })}
              required
            >
              <option value="">— выберите —</option>
              {recipients.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label>
              Категория{allowedIds ? " (только разрешённые)" : ""}
              {form.to_user_id ? " (необязательно при передаче)" : ""}
            </label>
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              required={!form.to_user_id}
            >
              <option value="">— выберите —</option>
              {visibleCats.map((c: any) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
            </select>
          </div>
        )}

        <div className="row" style={{ gap: 8 }}>
          <div style={{ flex: 2 }}>
            <label>Сумма</label>
            <input type="number" min="0.01" step="0.01" value={form.amount}
                   onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </div>
          {kind === "expense" && (
            <div style={{ flex: 1, minWidth: 110 }}>
              <label>Валюта</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="KGS">KGS — сом</option>
                <option value="USD">USD — $</option>
                <option value="RUB">RUB — ₽</option>
              </select>
            </div>
          )}
        </div>

        {kind === "expense" && colleagues.length > 0 && (
          <div>
            <label>Получатель (если деньги переданы сотруднику)</label>
            <select
              value={form.to_user_id}
              onChange={(e) => setForm({ ...form, to_user_id: e.target.value ? Number(e.target.value) : "" })}
            >
              <option value="">— нет, обычный расход —</option>
              {colleagues.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {form.to_user_id && form.currency !== "KGS" && (
              <div className="muted" style={{ fontSize: 12, color: "var(--warning)", marginTop: 4 }}>
                Передача получателю возможна только в KGS.
              </div>
            )}
            {form.to_user_id && (
              <div className="muted" style={{ fontSize: 11, marginTop: 4, color: "var(--accent-light)" }}>
                Это будет передача: с вашего баланса спишется, получатель получит на свой.
                В расход компании по категориям эта запись НЕ попадёт.
              </div>
            )}
          </div>
        )}

        <div>
          <label>{kind === "transfer" ? "Заметка (необязательно)" : "Описание"}</label>
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        {kind === "expense" && (
          <>
            <div>
              <label>Дата расхода</label>
              <input type="date" value={form.spent_at} onChange={(e) => setForm({ ...form, spent_at: e.target.value })} />
            </div>
            <div>
              <label>Фото чека{requiresReceipt && " (обязательно)"}</label>
              <input type="file" accept="image/*,application/pdf" capture="environment" onChange={onFile} />
              {uploading && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>загружаю...</div>}
              {form.receipt_url && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>✓ {form.receipt_url}</div>}
            </div>
          </>
        )}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          {onCancel && (
            <button type="button" className="ghost" onClick={onCancel}>Отмена</button>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "..." : (
              kind === "transfer" ? "Передать" :
              form.to_user_id ? "Выдать и записать" : "Записать расход"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
