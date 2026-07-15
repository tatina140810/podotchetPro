/**
 * Кастомный выбор категории с выпадением подкатегорий сбоку (fly-out).
 * В основном списке — только корневые категории. У категории с подкатегориями справа
 * «›»; при наведении (или клике на планшете) сбоку выпадает список её подкатегорий +
 * «вся категория».
 *
 * И основной список, и fly-out рендерятся через ОТДЕЛЬНЫЕ порталы с position:fixed,
 * чтобы их не обрезал overflow контейнера таблицы/карточки и прокрутка самой панели.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface CatOpt {
  id: number;
  name: string;
  parent_id?: number | null;
}

interface Props {
  cats: CatOpt[];
  value: string;              // выбранный category_id ("" = не выбрано)
  onChange: (categoryId: string) => void;
  placeholder?: string;
  compact?: boolean;          // плотнее — для ячеек таблицы
}

const PANEL_W = 240;
type Rect = { top: number; left: number; right: number };

export function CategoryPicker({ cats, value, onChange, placeholder = "— категория —", compact }: Props) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverRect, setHoverRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: PANEL_W });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const roots = cats.filter((c) => !c.parent_id);
  const kidsOf = (pid: number) => cats.filter((c) => c.parent_id === pid);

  const selected = value ? cats.find((c) => String(c.id) === value) : null;
  let label = placeholder;
  if (selected) {
    const parent = selected.parent_id ? cats.find((c) => c.id === selected.parent_id) : null;
    label = parent ? `${parent.name} / ${selected.name}` : selected.name;
  }

  function computePos() {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    setPos({ top: b.bottom + 4, left: b.left, width: Math.max(b.width, PANEL_W) });
  }
  useLayoutEffect(() => { if (open) computePos(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(t) &&
        btnRef.current && !btnRef.current.contains(t) &&
        (!subRef.current || !subRef.current.contains(t))
      ) { close(); }
    };
    const onResize = () => close();
    // scroll слушаем в фазе перехвата, поэтому сюда прилетает и прокрутка самой панели —
    // её пропускаем, иначе список категорий закрывается при попытке его прокрутить.
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      const inPanel = !!(t && panelRef.current?.contains(t));
      const inSub = !!(t && subRef.current?.contains(t));
      if (inPanel || inSub) {
        if (inPanel) { setHover(null); setHoverRect(null); }  // fly-out привязан к строке — уехал бы
        return;
      }
      close();
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function close() { setOpen(false); setHover(null); setHoverRect(null); }
  function choose(id: string) { onChange(id); close(); }
  function openSub(id: number, el: HTMLElement) {
    window.clearTimeout(closeTimer.current);
    const r = el.getBoundingClientRect();
    setHover(id);
    setHoverRect({ top: r.top, left: r.left, right: r.right });
  }
  function scheduleClose() {
    closeTimer.current = window.setTimeout(() => { setHover(null); setHoverRect(null); }, 180);
  }
  function keepSub() { window.clearTimeout(closeTimer.current); }

  const itemPad = compact ? "7px 11px" : "9px 12px";
  const fontSize = compact ? 13 : 14;
  const hoverParent = hover != null ? roots.find((c) => c.id === hover) : null;
  // fly-out влево, если справа не помещается
  const flipLeft = hoverRect ? hoverRect.right + PANEL_W + 12 > window.innerWidth : false;

  const panelBox: React.CSSProperties = {
    position: "fixed", zIndex: 9999,
    background: "#171a2b", border: "1px solid rgba(255,255,255,.14)",
    borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,.55)", padding: 4,
    overscrollBehavior: "contain",  // докрутив список до конца, не прокручивать страницу под ним
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        style={{
          width: "100%", textAlign: "left", background: "#1a1d2e",
          border: "1px solid rgba(255,255,255,.14)", borderRadius: 8,
          padding: compact ? "7px 10px" : "9px 12px",
          color: selected ? "#e8eaf2" : "#8a90a2", fontSize,
          cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {label} <span style={{ float: "right", opacity: 0.6 }}>▾</span>
      </button>

      {open && createPortal(
        <div ref={panelRef} style={{ ...panelBox, top: pos.top, left: pos.left, width: pos.width, maxHeight: 340, overflowY: "auto" }}>
          <div onClick={() => choose("")} style={{ padding: itemPad, borderRadius: 6, cursor: "pointer", color: "#8a90a2", fontSize }}>
            {placeholder}
          </div>
          {roots.map((parent) => {
            const hasKids = kidsOf(parent.id).length > 0;
            const isHover = hover === parent.id;
            return (
              <div
                key={parent.id}
                onMouseEnter={(e) => (hasKids ? openSub(parent.id, e.currentTarget) : (setHover(null), setHoverRect(null)))}
                onMouseLeave={() => hasKids && scheduleClose()}
                onClick={(e) => (hasKids ? openSub(parent.id, e.currentTarget) : choose(String(parent.id)))}
                style={{
                  padding: itemPad, borderRadius: 6, cursor: "pointer", fontSize,
                  background: isHover ? "#6c5ce7" : "transparent", color: "#e8eaf2",
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parent.name}</span>
                {hasKids && <span style={{ opacity: 0.7 }}>›</span>}
              </div>
            );
          })}
        </div>,
        document.body,
      )}

      {open && hoverParent && hoverRect && createPortal(
        <div
          ref={subRef}
          onMouseEnter={keepSub}
          onMouseLeave={scheduleClose}
          style={{
            ...panelBox,
            top: hoverRect.top,
            left: flipLeft ? undefined : hoverRect.right + 3,
            right: flipLeft ? window.innerWidth - hoverRect.left + 3 : undefined,
            width: PANEL_W, maxHeight: 320, overflowY: "auto",
          }}
        >
          <div
            onClick={() => choose(String(hoverParent.id))}
            style={{ padding: itemPad, borderRadius: 6, cursor: "pointer", color: "#8a90a2", fontSize }}
          >
            вся «{hoverParent.name}»
          </div>
          {kidsOf(hoverParent.id).map((k) => (
            <div
              key={k.id}
              onClick={() => choose(String(k.id))}
              style={{ padding: itemPad, borderRadius: 6, cursor: "pointer", fontSize, color: "#e8eaf2", whiteSpace: "nowrap" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#6c5ce7")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {k.name}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
