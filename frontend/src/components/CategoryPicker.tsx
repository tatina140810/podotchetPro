/**
 * Кастомный выбор категории с выпадением подкатегорий сбоку (fly-out).
 * В основном списке — только корневые категории. У категории с подкатегориями справа
 * показывается «›»; при наведении (или клике на планшете) сбоку выпадает список её
 * подкатегорий + пункт «вся категория». Заменяет нативный select, где подкатегории
 * были свалены в один плоский список.
 */
import { useEffect, useRef, useState } from "react";

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

export function CategoryPicker({ cats, value, onChange, placeholder = "— категория —", compact }: Props) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const roots = cats.filter((c) => !c.parent_id);
  const kidsOf = (pid: number) => cats.filter((c) => c.parent_id === pid);

  // Метка выбранного значения: «Родитель / Ребёнок» или просто «Категория».
  const selected = value ? cats.find((c) => String(c.id) === value) : null;
  let label = placeholder;
  if (selected) {
    const parent = selected.parent_id ? cats.find((c) => c.id === selected.parent_id) : null;
    label = parent ? `${parent.name} / ${selected.name}` : selected.name;
  }

  // Закрытие по клику вне компонента.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setHover(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setHover(null);
  }

  const itemPad = compact ? "6px 10px" : "8px 12px";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Поле-триггер, выглядит как select */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "var(--input-bg, #1a1d2e)",
          border: "1px solid var(--border, rgba(255,255,255,.14))",
          borderRadius: 8,
          padding: compact ? "7px 10px" : "9px 12px",
          color: selected ? "inherit" : "var(--muted, #8a90a2)",
          fontSize: compact ? 13 : 14,
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label} <span style={{ float: "right", opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 50,
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: "100%",
            maxHeight: 320,
            overflowY: "auto",
            background: "var(--card-bg, #12152280)",
            backdropFilter: "blur(8px)",
            border: "1px solid var(--border, rgba(255,255,255,.14))",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.4)",
            padding: 4,
          }}
        >
          <div
            onClick={() => choose("")}
            style={{ padding: itemPad, borderRadius: 6, cursor: "pointer", color: "var(--muted, #8a90a2)", fontSize: compact ? 13 : 14 }}
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
                  fontSize: compact ? 13 : 14,
                  background: isHover ? "var(--accent, #6c5ce7)" : "transparent",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parent.name}</span>
                {hasKids && <span style={{ opacity: 0.7 }}>›</span>}

                {/* Fly-out подкатегорий */}
                {hasKids && isHover && (
                  <div
                    style={{
                      position: "absolute",
                      left: "100%",
                      top: -4,
                      marginLeft: 2,
                      minWidth: 200,
                      maxHeight: 300,
                      overflowY: "auto",
                      background: "var(--card-solid, #171a2b)",
                      border: "1px solid var(--border, rgba(255,255,255,.14))",
                      borderRadius: 10,
                      boxShadow: "0 8px 24px rgba(0,0,0,.5)",
                      padding: 4,
                    }}
                  >
                    <div
                      onClick={(e) => { e.stopPropagation(); choose(String(parent.id)); }}
                      style={{ padding: itemPad, borderRadius: 6, cursor: "pointer", color: "var(--muted, #8a90a2)", fontSize: compact ? 13 : 14 }}
                    >
                      вся «{parent.name}»
                    </div>
                    {kids.map((k) => (
                      <div
                        key={k.id}
                        onClick={(e) => { e.stopPropagation(); choose(String(k.id)); }}
                        style={{
                          padding: itemPad,
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: compact ? 13 : 14,
                          whiteSpace: "nowrap",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent, #6c5ce7)")}
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
        </div>
      )}
    </div>
  );
}
