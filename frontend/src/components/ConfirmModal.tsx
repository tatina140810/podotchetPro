import { useEffect } from "react";

interface Row {
  label: string;
  value: string;
}

interface Props {
  title: string;
  /** Конкретика удаляемой записи: сумма, категория, дата, описание. */
  rows: Row[];
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Переиспользуемое подтверждение (вместо window.confirm). Красная кнопка для danger. */
export function ConfirmModal({ title, rows, message, confirmLabel = "Удалить", danger = true, busy, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  return (
    <div onClick={() => !busy && onCancel()} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 70,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, width: "100%" }}>
        <h2 className="h2" style={{ marginTop: 0, marginBottom: 10 }}>{title}</h2>
        {message && <div style={{ marginBottom: 12, fontSize: 14 }}>{message}</div>}
        <div className="grid" style={{ gap: 6, marginBottom: 16 }}>
          {rows.map((r) => (
            <div key={r.label} className="row between" style={{ gap: 12 }}>
              <span className="muted" style={{ fontSize: 13 }}>{r.label}</span>
              <span style={{ fontSize: 14, fontWeight: 500, textAlign: "right", wordBreak: "break-word" }}>{r.value}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ghost" onClick={onCancel} disabled={busy}>Отмена</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={danger ? { background: "var(--danger, #dc2626)", color: "#fff" } : undefined}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
