import { useEffect, useState } from "react";
import { useToast } from "./Toast";
import { listColleagues } from "../api/users";
import { updateTransfer, type MoneyTransfer } from "../api/transfers";
import type { UserOut } from "../context/AuthContext";

interface Props {
  transfer: MoneyTransfer;
  onClose: () => void;
  onSaved: () => void;
}

/** Правка передачи (только отправитель). Валюта передач — KGS (арх. решение), не меняем.
 * Дату не редактируем (у MoneyTransfer нет бизнес-даты). */
export function EditTransferModal({ transfer, onClose, onSaved }: Props) {
  const toast = useToast();
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [form, setForm] = useState({
    to_user_id: String(transfer.to_user_id),
    amount: String(transfer.amount),
    note: transfer.note || "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    listColleagues().then(setColleagues).catch(() => {});
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(form.amount.replace(",", "."));
    if (!isFinite(amt) || amt <= 0) { toast.show("error", "Сумма должна быть больше 0"); return; }
    setBusy(true);
    try {
      await updateTransfer(transfer.id, {
        to_user_id: Number(form.to_user_id),
        amount: amt,
        note: form.note.trim() || null,
      });
      toast.show("success", "Передача обновлена");
      onSaved();
    } catch (e: any) {
      // 409 — получатель уже израсходовал средства; backend отдаёт понятный русский текст.
      toast.show("error", e.message || "Не удалось изменить передачу");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <form className="card" onClick={(e) => e.stopPropagation()} onSubmit={submit}
        style={{ maxWidth: 440, width: "100%", display: "grid", gap: 12 }}>
        <div className="row between">
          <h2 className="h2" style={{ margin: 0 }}>Изменить передачу</h2>
          <button type="button" className="ghost" onClick={onClose} style={{ padding: "4px 10px" }}>×</button>
        </div>

        <div>
          <label>Получатель</label>
          <select value={form.to_user_id} onChange={(e) => setForm({ ...form, to_user_id: e.target.value })}>
            {colleagues.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label>Сумма (KGS)</label>
          <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" />
        </div>

        <div>
          <label>Комментарий</label>
          <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} />
        </div>

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="submit" disabled={busy}>{busy ? "Сохраняю…" : "Сохранить изменения"}</button>
        </div>
      </form>
    </div>
  );
}
