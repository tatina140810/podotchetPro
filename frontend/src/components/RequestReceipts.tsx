/**
 * Чеки и документы одобренной заявки: множественная загрузка, список, удаление.
 *
 * Права дублируются на бэкенде (POST/DELETE /api/requests/{id}/receipts) —
 * здесь только прячем кнопки. Удалять можно свой документ; директор — любой.
 */
import { useState } from "react";
import { uploadReceipts } from "../api/client";
import {
  addRequestReceipt,
  deleteRequestReceipt,
  type MoneyRequestReceipt,
} from "../api/requests";
import { useToast } from "./Toast";

interface Props {
  requestId: number;
  receipts: MoneyRequestReceipt[];
  /** Может ли текущий пользователь прикреплять документы (заявитель / адресат / директор). */
  canAttach: boolean;
  /** Может ли удалить конкретный документ. */
  canDelete: (r: MoneyRequestReceipt) => boolean;
  onChanged: (receipts: MoneyRequestReceipt[]) => void;
}

export function RequestReceipts({ requestId, receipts, canAttach, canDelete, onChanged }: Props) {
  const toast = useToast();
  const [progress, setProgress] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  /** Грузим файлы по очереди и привязываем каждый сразу: если канал оборвётся,
   *  уже прикреплённые документы останутся на сервере. */
  async function onFiles(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    setProgress(`0/${list.length}`);
    const added: MoneyRequestReceipt[] = [];
    try {
      const uploaded = await uploadReceipts(list, (done, total) => setProgress(`${done}/${total}`));
      for (const u of uploaded) {
        added.push(await addRequestReceipt(requestId, u.url, u.name));
      }
      toast.show("success", added.length === 1 ? "Документ прикреплён" : `Прикреплено: ${added.length}`);
    } catch (e: any) {
      toast.show("error", e.message || "Не удалось прикрепить часть документов");
    } finally {
      if (added.length > 0) onChanged([...receipts, ...added]);
      setProgress(null);
    }
  }

  async function onRemove(r: MoneyRequestReceipt) {
    if (!confirm(`Убрать «${r.file_name || "документ"}»?`)) return;
    setRemoving(r.id);
    try {
      await deleteRequestReceipt(requestId, r.id);
      onChanged(receipts.filter((x) => x.id !== r.id));
      toast.show("success", "Убрано");
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 className="h2" style={{ margin: 0 }}>Чеки и документы</h2>
        <span className="muted" style={{ fontSize: 12 }}>{receipts.length}</span>
      </div>

      {receipts.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }}>Пока не прикреплено.</div>
      )}

      {receipts.length > 0 && (
        <div className="grid" style={{ gap: 6 }}>
          {receipts.map((r) => (
            <div key={r.id} className="row between" style={{ alignItems: "center", gap: 8 }}>
              <div style={{ overflow: "hidden" }}>
                <a
                  href={r.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={r.file_name || r.file_url}
                >
                  {r.file_name || "документ"}
                </a>
                <div className="muted" style={{ fontSize: 11 }}>
                  {r.uploaded_by_name || "—"} · {new Date(r.created_at).toLocaleDateString("ru-RU")}
                </div>
              </div>
              {canDelete(r) && (
                <button
                  type="button"
                  className="ghost"
                  style={{ fontSize: 12, padding: "2px 8px" }}
                  disabled={removing === r.id}
                  onClick={() => onRemove(r)}
                >
                  {removing === r.id ? "…" : "убрать"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canAttach && (
        <label
          style={{ display: "inline-block", marginTop: 10, cursor: progress ? "default" : "pointer", color: "var(--accent)" }}
        >
          {progress
            ? `загружаю ${progress}...`
            : receipts.length > 0
              ? "+ ещё чек/документ"
              : "прикрепить чек/документ"}
          <input
            type="file"
            multiple
            accept="image/*,application/pdf,.xls,.xlsx,.doc,.docx,.csv"
            style={{ display: "none" }}
            disabled={!!progress}
            onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }}
          />
        </label>
      )}
    </div>
  );
}
