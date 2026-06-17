import { useEffect, useState } from "react";
import {
  IncomeSource,
  listIncomeSources,
  createIncomeSource,
  updateIncomeSource,
  deleteIncomeSource,
} from "../api/incomeSources";
import { useToast } from "../components/Toast";

export default function IncomeSources() {
  const [list, setList] = useState<IncomeSource[] | null>(null);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const reload = () => listIncomeSources().then(setList).catch(() => setList([]));
  useEffect(() => { reload(); }, []);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createIncomeSource(name.trim());
      toast.show("success", "Источник добавлен");
      setName("");
      setAdding(false);
      reload();
    } catch (e: any) {
      toast.show("error", e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: IncomeSource) {
    try {
      await updateIncomeSource(s.id, { is_active: !s.is_active });
      reload();
    } catch (e: any) {
      toast.show("error", e.message);
    }
  }

  async function remove(s: IncomeSource) {
    if (!confirm(`Удалить источник «${s.name}»?`)) return;
    try {
      await deleteIncomeSource(s.id);
      toast.show("success", "Источник удалён");
      reload();
    } catch (e: any) {
      toast.show("error", e.message);
    }
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 16 }}>
        <h1 className="h1" style={{ margin: 0 }}>Источники дохода</h1>
        <button onClick={() => { setAdding(true); setName(""); }}>+ Добавить источник</button>
      </div>

      <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Источники появляются в выпадающем списке при записи прихода и в отчёте по
        источникам. Выключенный источник прячется из списков, но история приходов
        по нему сохраняется.
      </div>

      <div className="grid" style={{ gap: 8 }}>
        {(list || []).map((s) => (
          <div key={s.id} className="card" style={{ padding: 14, opacity: s.is_active ? 1 : 0.55 }}>
            <div className="row between">
              <div className="row" style={{ gap: 12 }}>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                {!s.is_active && <span className="muted" style={{ fontSize: 12 }}>выключен</span>}
                <span className="muted" style={{ fontSize: 12 }}>
                  приходов: {s.income_count}
                </span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="ghost"
                  style={{ padding: "6px 12px", fontSize: 13 }}
                  onClick={() => toggleActive(s)}
                >
                  {s.is_active ? "Выключить" : "Включить"}
                </button>
                <button
                  className="danger"
                  style={{ padding: "6px 12px", fontSize: 13 }}
                  onClick={() => remove(s)}
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>
        ))}
        {list && list.length === 0 && (
          <div className="card muted">Источников пока нет</div>
        )}
      </div>

      {adding && (
        <div onClick={() => setAdding(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: "100%" }}>
            <h2 className="h2">Новый источник</h2>
            <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid">
              <div>
                <label>Название</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={1}
                  autoFocus
                  placeholder="Например: Обменка"
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
