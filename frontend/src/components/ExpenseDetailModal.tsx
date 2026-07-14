import { useEffect, useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { api, uploadReceipt } from "../api/client";
import { useToast } from "./Toast";
import { formatAmountWithEquivalent } from "../lib/format-currency";

interface Receipt {
  id: number;
  file_url: string;
  file_name?: string | null;
}

interface Props {
  expense: any;
  usdKgs: number | null;
  /** Можно ли редактировать сам расход (свой + pending). Также разрешает удаление чеков. */
  canEdit: boolean;
  /** Можно ли доклеивать чеки (владелец расхода) — даже после проверки. */
  canAttach: boolean;
  onClose: () => void;
  onEdit: () => void;
  /** Вызывается после прикрепления/удаления чека, чтобы родитель перезагрузил данные. */
  onChanged?: () => void;
}

export function ExpenseDetailModal({ expense, usdKgs, canEdit, canAttach, onClose, onEdit, onChanged }: Props) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  // Локальная копия списка чеков — чтобы галерея обновлялась без перезагрузки всей страницы.
  const [receipts, setReceipts] = useState<Receipt[]>(() => normalizeReceipts(expense));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    ev.target.value = ""; // позволяет загрузить тот же файл повторно
    if (!f) return;
    setUploading(true);
    try {
      const { url } = await uploadReceipt(f);
      const r = await api<Receipt>(`/api/expenses/${expense.id}/receipts`, {
        method: "POST",
        body: { file_url: url, file_name: f.name },
      });
      setReceipts((prev) => [...prev, r]);
      toast.show("success", "Чек прикреплён");
      onChanged?.();
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось прикрепить чек");
    } finally {
      setUploading(false);
    }
  }

  async function removeReceipt(id: number) {
    if (!confirm("Удалить этот чек?")) return;
    try {
      await api(`/api/expenses/${expense.id}/receipts/${id}`, { method: "DELETE" });
      setReceipts((prev) => prev.filter((r) => r.id !== id));
      toast.show("success", "Чек удалён");
      onChanged?.();
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось удалить чек");
    }
  }

  const hasReceipts = receipts.length > 0;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 60,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{
        maxWidth: 760, width: "100%", maxHeight: "92vh", overflow: "auto",
      }}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 className="h2" style={{ margin: 0 }}>Расход</h2>
          <button type="button" className="ghost" onClick={onClose} style={{ padding: "4px 10px" }}>×</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: hasReceipts ? "1fr 1fr" : "1fr", gap: 16 }}>
          {/* Левая колонка: галерея чеков/документов */}
          {hasReceipts && (
            <div style={{ display: "grid", gap: 8 }}>
              {receipts.map((r) => (
                <ReceiptThumb
                  key={r.id}
                  receipt={r}
                  canDelete={canEdit}
                  onDelete={() => removeReceipt(r.id)}
                />
              ))}
            </div>
          )}

          {/* Правая колонка: информация */}
          <div className="grid" style={{ gap: 10 }}>
            <Field label="Дата" value={new Date(expense.spent_at).toLocaleDateString("ru-RU")} />
            <Field label="Сотрудник" value={expense.employee_name || "—"} />
            <Field label="Категория" value={expense.category_name || "—"} />
            <Field
              label="Сумма"
              value={formatAmountWithEquivalent(expense.amount, expense.currency || "KGS", usdKgs)}
              bold
            />
            {expense.description && <Field label="Описание" value={expense.description} multiline />}
            <div>
              <label>Статус</label>
              <div><StatusBadge status={expense.status} /></div>
              {expense.review_comment && (
                <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>
                  Комментарий: {expense.review_comment}
                </div>
              )}
            </div>
            {expense.is_verified && (
              <div style={{ fontSize: 13, color: "var(--success)" }}>
                ✓ Верифицировано аудитором
              </div>
            )}
            {expense.recorded_by_name && (
              <div className="muted" style={{ fontSize: 12 }}>
                Внёс: {expense.recorded_by_name}
              </div>
            )}
            {!hasReceipts && (
              <div className="muted" style={{ fontSize: 13 }}>Чеки не прикреплены</div>
            )}
            {canAttach && (
              <div>
                <label
                  className="ghost"
                  style={{ display: "inline-block", cursor: uploading ? "default" : "pointer", padding: "8px 12px", borderRadius: 8 }}
                >
                  {uploading ? "Загрузка…" : "Прикрепить чек"}
                  <input
                    type="file"
                    accept="image/*,application/pdf,.xls,.xlsx,.doc,.docx,.csv"
                    onChange={onFile}
                    disabled={uploading}
                    style={{ display: "none" }}
                  />
                </label>
                {expense.status !== "pending" && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Расход проверен — можно только добавить чек, без изменения суммы.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
          <button type="button" className="ghost" onClick={onClose}>Закрыть</button>
          {canEdit && (
            <button type="button" onClick={onEdit}>Редактировать</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Собирает список чеков: новое поле receipts[], с откатом на legacy receipt_url. */
function normalizeReceipts(expense: any): Receipt[] {
  if (Array.isArray(expense.receipts) && expense.receipts.length > 0) {
    return expense.receipts.map((r: any) => ({ id: r.id, file_url: r.file_url, file_name: r.file_name }));
  }
  if (expense.receipt_url) {
    // Старые данные без id — удалять нельзя (id=0), только просмотр.
    return [{ id: 0, file_url: expense.receipt_url, file_name: null }];
  }
  return [];
}

function ReceiptThumb({ receipt, canDelete, onDelete }: { receipt: Receipt; canDelete: boolean; onDelete: () => void }) {
  const url = receipt.file_url;
  const isPdf = url.toLowerCase().endsWith(".pdf");
  return (
    <div style={{ position: "relative", background: "rgba(0,0,0,0.25)", borderRadius: 10, padding: 8, minHeight: 80 }}>
      {canDelete && receipt.id > 0 && (
        <button
          type="button"
          className="ghost"
          onClick={onDelete}
          title="Удалить чек"
          style={{ position: "absolute", top: 4, right: 4, padding: "2px 8px", zIndex: 1, background: "rgba(0,0,0,0.5)" }}
        >×</button>
      )}
      <a href={url} target="_blank" rel="noreferrer" title="Открыть в полном размере" style={{ display: "block" }}>
        {isPdf ? (
          <div style={{ textAlign: "center", padding: "16px 8px" }}>
            <div style={{ fontSize: 40 }}></div>
            <div style={{ fontSize: 12 }}>{receipt.file_name || "PDF-документ"}</div>
          </div>
        ) : (
          <img src={url} alt={receipt.file_name || "Чек"} style={{ maxWidth: "100%", maxHeight: "40vh", borderRadius: 6, display: "block", margin: "0 auto" }} />
        )}
      </a>
    </div>
  );
}

function Field({ label, value, bold, multiline }: { label: string; value: string; bold?: boolean; multiline?: boolean }) {
  return (
    <div>
      <label>{label}</label>
      <div style={{
        fontWeight: bold ? 600 : 400,
        whiteSpace: multiline ? "pre-wrap" : "normal",
        wordBreak: "break-word",
      }}>{value}</div>
    </div>
  );
}
