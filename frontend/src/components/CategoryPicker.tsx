/**
 * Кастомный выбор категории с выпадением подкатегорий сбоку (fly-out).
 * В основном списке — только корневые категории. У категории с подкатегориями справа
 * «›»; при наведении (или клике на планшете) сбоку выпадает список её подкатегорий +
 * «вся категория».
 *
 * Дропдаун и fly-out рендерятся через портал (position: fixed от кнопки), чтобы их не
 * обрезал overflow контейнера таблицы (импорт истории) или карточки формы.
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

export function CategoryPicker({ cats, value, onChange, placeholder = "— категория —", compact }: Props) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; flip: boolean }>({ top: 0, left: 0, width: PANEL_W, flip: false });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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
    const width = Math.max(b.width, PANEL_W);
    // Если справа мало места для fly-out — открываем подменю влево.
    const flip = b.left + width + PANEL_W + 12 > window.innerWidth;
    setPos({ top: b.bottom + 4, left: b.left, width, flip });
  }

  useLayoutEffect(() => {
    if (open) computePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false); setHover(null);
      }
    };
    const onScrollResize = () => { setOpen(false); setHover(null); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onScrollResize);
    // скролл любого контейнера закрывает (позиция fixed устарела бы)
    window.addEventListener("scroll", onScrollResize, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onScrollResize);
      window.removeEventListener("scroll", onScrollResize, true);
    };
  }, [open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setHover(null);
  }

  const itemPad = compact ? "7px 11px" : "9px 12px";
  const fontSize = compact ? 13 : 14;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "#1a1d2e",
          border: "1px solid rgba(255,255,255,.14)",
          borderRadius: 8,
          padding: compact ? "7px 10px" : "9px 12px",
          color: selected ? "#e8eaf2" : "#8a90a2",
          fontSize,
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label} <span style={{ float: "right", opacity: 0.6 }}>▾</span>
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            zIndex: 9999,
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: 340,
            overflowY: "auto",
            overflowX: "visible",
            background: "#171a2b",
            border: "1px solid rgba(255,255,255,.14)",
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(0,0,0,.55)",
            padding: 4,
          }}
        >
          <div
            onClick={() => choose("")}
            style={{ padding: itemPad, borderRadius: 6, cursor: "pointer", color: "#8a90a2", fontSize }}
          >
            {placeholder}
          </div>
          {roots.map((parent) => {
            const kids = kidsOf(parent.id);
            const hasKids = kids.length > 0;
            const isHover = hover === parent.id;
            return (
              <div
                key={parent.id}
                onMouseEnter={() => setHover(hasKids ? parent.id : null)}
                onClick={() => (hasKids ? setHover(isHover ? null : parent.id) : choose(String(parent.id)))}
                style={{
                  position: "relative",
                  padding: itemPad,
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize,
                  background: isHover ? "#6c5ce7" : "transparent",
                  color: "#e8eaf2",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parent.name}</span>
                {hasKids && <span style={{ opacity: 0.7 }}>›</span>}

                {hasKids && isHover && (
                  <div
                    style={{
                      position: "absolute",
                      top: -4,
                      [pos.flip ? "right" : "left"]: "100%",
                      [pos.flip ? "marginRight" : "marginLeft"]: 3,
                      width: PANEL_W,
                      maxHeight: 320,
                      overflowY: "auto",
                      background: "#1c2033",
                      border: "1px solid rgba(255,255,255,.16)",
                      borderRadius: 10,
                      boxShadow: "0 10px 30px rgba(0,0,0,.6)",
                      padding: 4,
                    }}
                  >
                    <div
                      onClick={(e) => { e.stopPropagation(); choose(String(parent.id)); }}
                      style={{ padding: itemPad, borderRadius: 6, cursor: "pointer", color: "#8a90a2", fontSize }}
                    >
                      вся «{parent.name}»
                    </div>
                    {kids.map((k) => (
                      <div
                        key={k.id}
                        onClick={(e) => { e.stopPropagation(); choose(String(k.id)); }}
                        style={{ padding: itemPad, borderRadius: 6, cursor: "pointer", fontSize, color: "#e8eaf2", whiteSpace: "nowrap" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#6c5ce7")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        {k.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
