import { useEffect, useState } from "react";
import {
  Department,
  listDepartments,
  createDepartment,
  deleteDepartment,
} from "../api/departments";
import { useToast } from "../components/Toast";

export default function Departments() {
  const [list, setList] = useState<Department[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const reload = () => listDepartments().then(setList);

  useEffect(() => { reload(); }, []);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createDepartment(name.trim());
      toast.show("success", "Подразделение добавлено");
      setName("");
      setAdding(false);
      reload();
    } catch (e: any) {
      toast.show("error", e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(d: Department) {
    if (!confirm(`Удалить подразделение «${d.name}»?`)) return;
    try {
      await deleteDepartment(d.id);
      toast.show("success", "Подразделение удалено");
      reload();
    } catch (e: any) {
      toast.show("error", e.message);
    }
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 16 }}>
        <h1 className="h1" style={{ margin: 0 }}>Подразделения</h1>
        <button onClick={() => { setAdding(true); setName(""); }}>+ Добавить подразделение</button>
      </div>

      <div className="grid" style={{ gap: 8 }}>
        {(list || []).map((d) => (
          <div key={d.id} className="card" style={{ padding: 14 }}>
            <div className="row between">
              <div className="row" style={{ gap: 12 }}>
                <span style={{ fontWeight: 600 }}>{d.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  👥 {d.employee_count} · 🏷 {d.category_count}
                </span>
              </div>
              <button
                className="danger"
                style={{ padding: "6px 12px", fontSize: 13 }}
                onClick={() => remove(d)}
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
        {list && list.length === 0 && (
          <div className="card muted">Подразделений пока нет</div>
        )}
      </div>

      {adding && (
        <div onClick={() => setAdding(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: "100%" }}>
            <h2 className="h2">Новое подразделение</h2>
            <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid">
              <div>
                <label>Название</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={1}
                  autoFocus
                  placeholder="Например: AVA Pay"
                />
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="ghost" onClick={() => setAdding(false)}>Отмена</button>
                <button type="submit" disabled={saving}>Сохранить</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
