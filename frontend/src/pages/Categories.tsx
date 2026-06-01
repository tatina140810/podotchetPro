import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useToast } from "../components/Toast";

interface Category {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  is_active: boolean;
  is_operational: boolean;
  parent_id: number | null;
  parent_name?: string | null;
  display_name?: string | null;
}

const PRESET_COLORS = ["#6c5ce7", "#00b894", "#fdcb6e", "#e17055", "#0984e3", "#a29bfe", "#74b9ff", "#636e72"];

export default function Categories() {
  const [list, setList] = useState<Category[] | null>(null);
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const toast = useToast();

  const reload = () => api<Category[]>("/api/categories").then(setList);

  useEffect(() => { reload(); }, []);

  // Корневые категории (parent_id = null) — для селекта «Родительская»
  const rootCategories = useMemo(
    () => (list || []).filter((c) => c.parent_id === null),
    [list]
  );

  // Группировка: для каждой корневой — список её подкатегорий
  const grouped = useMemo(() => {
    if (!list) return [];
    const roots = list.filter((c) => c.parent_id === null);
    return roots.map((root) => ({
      root,
      children: list.filter((c) => c.parent_id === root.id),
    }));
  }, [list]);

  // Осиротевшие подкатегории (родитель удалён → parent_id != null, но родителя нет в списке)
  const orphans = useMemo(() => {
    if (!list) return [];
    const rootIds = new Set(list.filter((c) => c.parent_id === null).map((c) => c.id));
    return list.filter((c) => c.parent_id !== null && !rootIds.has(c.parent_id));
  }, [list]);

  async function save() {
    if (!editing) return;
    try {
      if (editing.id) {
        await api(`/api/categories/${editing.id}`, {
          method: "PATCH",
          body: {
            name: editing.name,
            color: editing.color,
            icon: editing.icon,
            is_operational: editing.is_operational ?? false,
            parent_id: editing.parent_id ?? null,
          },
        });
        toast.show("success", "Сохранено");
      } else {
        await api("/api/categories", {
          method: "POST",
          body: {
            name: editing.name,
            color: editing.color || "#6c5ce7",
            icon: editing.icon || null,
            is_operational: editing.is_operational ?? false,
            parent_id: editing.parent_id ?? null,
          },
        });
        toast.show("success", editing.parent_id ? "Подкатегория добавлена" : "Категория добавлена");
      }
      setEditing(null);
      reload();
    } catch (e: any) { toast.show("error", e.message); }
  }

  async function remove(c: Category) {
    if (!confirm(`Скрыть категорию «${c.name}»? Старые расходы не пострадают.`)) return;
    try {
      await api(`/api/categories/${c.id}`, { method: "DELETE" });
      toast.show("success", "Категория скрыта");
      reload();
    } catch (e: any) { toast.show("error", e.message); }
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 16 }}>
        <h1 className="h1" style={{ margin: 0 }}>Категории</h1>
        <button onClick={() => setEditing({ name: "", color: "#6c5ce7" })}>+ Добавить</button>
      </div>

      <div className="grid" style={{ gap: 8 }}>
        {grouped.map(({ root, children }) => (
          <div key={root.id} className="card" style={{ padding: 14 }}>
            <div className="row between">
              <div className="row" style={{ gap: 12 }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 4,
                  background: root.color || "#6c5ce7", display: "inline-block",
                }} />
                <span style={{ fontWeight: 600 }}>{root.name}</span>
                {root.icon && <span className="muted" style={{ fontSize: 12 }}>{root.icon}</span>}
                {root.is_operational && (
                  <span className="badge approved" style={{ fontSize: 11 }}>операционная</span>
                )}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="ghost"
                  style={{ padding: "6px 10px", fontSize: 12 }}
                  onClick={() => setEditing({ name: "", color: root.color || "#6c5ce7", parent_id: root.id })}
                  title="Добавить подкатегорию"
                >+ подкат.</button>
                <button className="ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setEditing(root)}>Изменить</button>
                <button className="danger" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => remove(root)}>Скрыть</button>
              </div>
            </div>
            {children.length > 0 && (
              <div className="grid" style={{ gap: 6, marginTop: 10, paddingLeft: 24, borderLeft: "2px solid var(--border)" }}>
                {children.map((sub) => (
                  <div key={sub.id} className="row between" style={{ paddingLeft: 8 }}>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="muted" style={{ fontSize: 14 }}>↳</span>
                      <span style={{
                        width: 10, height: 10, borderRadius: 3,
                        background: sub.color || root.color || "#6c5ce7", display: "inline-block",
                      }} />
                      <span>{sub.name}</span>
                      {sub.icon && <span className="muted" style={{ fontSize: 12 }}>{sub.icon}</span>}
                      {sub.is_operational && (
                        <span className="badge approved" style={{ fontSize: 11 }}>операционная</span>
                      )}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setEditing(sub)}>Изменить</button>
                      <button className="danger" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => remove(sub)}>Скрыть</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {orphans.length > 0 && (
          <div className="card" style={{ padding: 14, borderColor: "var(--danger)" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              ⚠ Подкатегории без родителя (родитель удалён):
            </div>
            <div className="grid" style={{ gap: 6 }}>
              {orphans.map((c) => (
                <div key={c.id} className="row between">
                  <span>{c.name}</span>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setEditing(c)}>Изменить</button>
                    <button className="danger" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => remove(c)}>Скрыть</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {list && list.length === 0 && <div className="card muted">Категорий пока нет</div>}
      </div>

      {editing && (
        <div onClick={() => setEditing(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: "100%" }}>
            <h2 className="h2">
              {editing.id
                ? "Редактировать"
                : editing.parent_id
                  ? "Новая подкатегория"
                  : "Новая категория"}
            </h2>
            <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid">
              <div>
                <label>Название</label>
                <input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required minLength={1} />
              </div>
              <div>
                <label>Родительская категория (необязательно)</label>
                <select
                  value={editing.parent_id ?? ""}
                  onChange={(e) => setEditing({ ...editing, parent_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">— нет (корневая) —</option>
                  {rootCategories
                    .filter((c) => c.id !== editing.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Можно вложить только в корневую (2 уровня вложенности).
                </div>
              </div>
              <div>
                <label>Иконка (эмодзи или название, необязательно)</label>
                <input value={editing.icon || ""} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} placeholder="🚗" />
              </div>
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!editing.is_operational}
                    onChange={(e) => setEditing({ ...editing, is_operational: e.target.checked })}
                  />
                  Операционная категория (попадает в раздел «Операционные расходы»)
                </label>
              </div>
              <div>
                <label>Цвет</label>
                <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {PRESET_COLORS.map((col) => (
                    <button key={col} type="button"
                            onClick={() => setEditing({ ...editing, color: col })}
                            style={{
                              width: 32, height: 32, borderRadius: 6, padding: 0,
                              background: col, border: editing.color === col ? "2px solid white" : "2px solid transparent",
                            }} />
                  ))}
                </div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="ghost" onClick={() => setEditing(null)}>Отмена</button>
                <button type="submit">Сохранить</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
