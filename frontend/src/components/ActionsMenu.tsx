import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ActionItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Тултип (например причина, почему пункт disabled). */
  title?: string;
}

/** Меню действий на карточке (иконка ⋮). Выпадашка рендерится через ПОРТАЛ в body
 * с фиксированным позиционированием — иначе её перекрывает соседняя карточка
 * (у .card backdrop-filter создаёт stacking-контекст). Пункты могут быть disabled
 * с тултипом (для approved-записей: видно, но недоступно). */
export function ActionsMenu({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = btnRef.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="ghost"
        aria-label="Действия"
        onClick={toggle}
        style={{ padding: "2px 8px", fontSize: 18, lineHeight: 1 }}
      >
        ⋮
      </button>
      {open && pos && createPortal(
        <div
          className="card"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed", top: pos.top, right: pos.right, zIndex: 1000,
            minWidth: 180, padding: 6, display: "grid", gap: 2,
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              className="ghost"
              title={it.title}
              disabled={it.disabled}
              onClick={() => { if (!it.disabled) { setOpen(false); it.onClick(); } }}
              style={{
                textAlign: "left", padding: "8px 10px", borderRadius: 6,
                color: it.disabled ? "var(--muted, #888)" : it.danger ? "var(--danger, #dc2626)" : undefined,
                cursor: it.disabled ? "not-allowed" : "pointer",
                opacity: it.disabled ? 0.6 : 1,
              }}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
