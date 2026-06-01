import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/Toast";

export default function EmployeeSpec() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();

  const [user, setUser] = useState<any>(null);
  const [cats, setCats] = useState<any[]>([]);
  const [form, setForm] = useState({
    monthly_limit: "" as string,
    single_limit: "" as string,
    allowed_categories: [] as number[],
    requires_receipt: false,
    requires_approval: true,
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api(`/api/users/${id}`).then(setUser),
      api("/api/categories").then(setCats),
      api(`/api/specs/${id}`).then((s: any) => setForm({
        monthly_limit: Number(s.monthly_limit) ? String(s.monthly_limit) : "",
        single_limit: Number(s.single_limit) ? String(s.single_limit) : "",
        allowed_categories: s.allowed_categories || [],
        requires_receipt: !!s.requires_receipt,
        requires_approval: !!s.requires_approval,
        notes: s.notes || "",
      })),
    ]).catch(() => {});
  }, [id]);

  function toggleCat(cid: number) {
    setForm((f) => ({
      ...f,
      allowed_categories: f.allowed_categories.includes(cid)
        ? f.allowed_categories.filter((x) => x !== cid)
        : [...f.allowed_categories, cid],
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/specs/${id}`, {
        method: "PUT",
        body: {
          ...form,
          monthly_limit: Number(form.monthly_limit) || 0,
          single_limit: Number(form.single_limit) || 0,
          allowed_categories: form.allowed_categories.length ? form.allowed_categories : null,
        },
      });
      toast.show("success", "Спецификация сохранена");
      nav(`/employees/${id}`);
    } catch (e: any) {
      toast.show("error", e.message);
    } finally { setBusy(false); }
  }

  if (!user) return <div className="container"><div className="muted">Загрузка...</div></div>;

  return (
    <div className="container" style={{ maxWidth: 600 }}>
      <h1 className="h1">Спецификация: {user.name}</h1>

      <form onSubmit={save} className="card grid">
        <div>
          <label>Лимит в месяц (сом). 0 = без ограничений</label>
          <input type="number" min={0} placeholder="0 = без ограничений" value={form.monthly_limit}
                 onChange={(e) => setForm({ ...form, monthly_limit: e.target.value })} />
        </div>
        <div>
          <label>Лимит одной выдачи (сом). 0 = без ограничений</label>
          <input type="number" min={0} placeholder="0 = без ограничений" value={form.single_limit}
                 onChange={(e) => setForm({ ...form, single_limit: e.target.value })} />
        </div>

        <div>
          <label>Разрешённые категории. Пусто = все.</label>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {cats.map((c: any) => (
              <label key={c.id} className="row" style={{ gap: 4, cursor: "pointer", margin: 0 }}>
                <input type="checkbox" style={{ width: "auto" }}
                       checked={form.allowed_categories.includes(c.id)}
                       onChange={() => toggleCat(c.id)} />
                <span>{c.display_name || c.name}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="row" style={{ gap: 8, margin: 0 }}>
          <input type="checkbox" style={{ width: "auto" }}
                 checked={form.requires_receipt}
                 onChange={(e) => setForm({ ...form, requires_receipt: e.target.checked })} />
          <span>Обязательное фото чека</span>
        </label>

        <label className="row" style={{ gap: 8, margin: 0 }}>
          <input type="checkbox" style={{ width: "auto" }}
                 checked={form.requires_approval}
                 onChange={(e) => setForm({ ...form, requires_approval: e.target.checked })} />
          <span>Требуется одобрение администратора</span>
        </label>

        <div>
          <label>Заметки бухгалтера (сотрудник не видит)</label>
          <textarea rows={3} value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="ghost" onClick={() => nav(-1)}>Отмена</button>
          <button type="submit" disabled={busy}>{busy ? "..." : "Сохранить"}</button>
        </div>
      </form>
    </div>
  );
}
