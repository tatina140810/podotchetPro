import { useEffect, useState } from "react";

interface Props {
  url: string | null | undefined;
}

export function ReceiptLink({ url }: Props) {
  const [open, setOpen] = useState(false);
  if (!url) return <span className="muted">—</span>;

  return (
    <>
      <button
        type="button"
        className="ghost"
        style={{ padding: "2px 8px", fontSize: 14 }}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Показать чек"
      >Чек</button>
      {open && <ReceiptModal url={url} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReceiptModal({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPdf = url.toLowerCase().endsWith(".pdf");

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <button onClick={onClose} className="ghost" style={{
        position: "absolute", top: 12, right: 12, fontSize: 18, padding: "6px 12px",
      }}>×</button>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "95vw", maxHeight: "90vh" }}>
        {isPdf ? (
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 16 }}>PDF-документ</div>
            <a href={url} target="_blank" rel="noreferrer">
              <button>Открыть в новой вкладке</button>
            </a>
          </div>
        ) : (
          <img
            src={url}
            alt="Чек"
            style={{ maxWidth: "95vw", maxHeight: "90vh", borderRadius: 8, display: "block" }}
          />
        )}
      </div>
    </div>
  );
}
