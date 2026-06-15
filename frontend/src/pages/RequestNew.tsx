import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { UserOut } from "../context/AuthContext";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import {
  createRequest,
  submitRequest,
  type MoneyRequestItemIn,
} from "../api/requests";
import { listColleagues } from "../api/users";
import { listDepartments, type Department } from "../api/departments";

interface Category {
  id: number;
  name: string;
  department_id?: number | null;
}

interface DraftItem {
  description: string;
  category_id: number | null;
  quantity: string;
  amount: string;
}

const EMPTY_ITEM: DraftItem = { description: "", category_id: null, quantity: "1", amount: "" };

export default function RequestNew() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [approverId, setApproverId] = useState<number | "">("");
  const [departmentId, setDepartmentId] = useState<number | "">("");
  const [currency, setCurrency] = useState<"KGS" | "USD" | "RUB">("KGS");
  const [items, setItems] = useState<DraftItem[]>([{ ...EMPTY_ITEM }]);
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [busy, setBusy] = useState(false);
  const [isExpenseOnApprove, setIsExpenseOnApprove] = useState(false);
  const [expenseCategoryId, setExpenseCategoryId] = useState<number | "">("");

  useEffect(() => {
    listColleagues().then(setColleagues).catch(() => {});
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
    listDepartments()
      .then((ds) => {
        setDepartments(ds);
        // Если подразделение одно — подставляем автоматически.
        if (ds.length === 1) setDepartmentId(ds[0].id);
      })
      .catch(() => {});
  }, []);

  // Категории: общие (department_id=null) + категории выбранного подразделения.
  const visibleCategories = useMemo(() => {
    if (!departmentId) return categories;
    return categories.filter((c) => c.department_id == null || c.department_id === departmentId);
  }, [categories, departmentId]);

  // Список допустимых approver: для accountable — supervisor + директоры/аудиторы/admin;
  // для auditor — только директоры/admin.
  const possibleApprovers = useMemo(() => {
    if (!user) return [] as UserOut[];
    if (user.role === "accountable") {
      return colleagues.filter(
        (c) =>
          c.id === user.supervisor_id ||
          c.role === "gen_director" ||
          c.role === "auditor" ||
          c.role === "admin" ||
          c.role === "superadmin"
      );
    }
    if (user.role === "auditor") {
      return colleagues.filter(
        (c) => c.role === "gen_director" || c.role === "admin" || c.role === "superadmin"
      );
    }
    return colleagues;
  }, [colleagues, user]);

  const total = useMemo(
    () =>
      items.reduce((sum, it) => {
        const a = parseFloat(it.amount.replace(",", "."));
        const q = parseInt(it.quantity, 10) || 0;
        return sum + (isFinite(a) ? a * q : 0);
      }, 0),
    [items]
  );

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }
  function removeItem(idx: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function buildPayload() {
    if (!title.trim()) {
      toast.show("error", "Введите название");
      return null;
    }
    if (!approverId) {
      toast.show("error", "Выберите кому отправить");
      return null;
    }
    if (!departmentId) {
      toast.show("error", "Выберите подразделение");
      return null;
    }
    if (isExpenseOnApprove && !expenseCategoryId) {
      toast.show("error", "Для заявки на расход выберите категорию");
      return null;
    }
    const built: MoneyRequestItemIn[] = [];
    for (const it of items) {
      const amount = parseFloat(it.amount.replace(",", "."));
      const quantity = parseInt(it.quantity, 10) || 1;
      if (!it.description.trim() || !isFinite(amount) || amount <= 0) continue;
      built.push({
        description: it.description.trim(),
        category_id: it.category_id,
        amount,
        quantity,
      });
    }
    if (built.length === 0) {
      toast.show("error", "Добавьте хотя бы одну строку с суммой");
      return null;
    }
    return {
      title: title.trim(),
      approver_id: Number(approverId),
      department_id: Number(departmentId),
      currency,
      items: built,
      is_expense_on_approve: isExpenseOnApprove,
      expense_category_id: isExpenseOnApprove ? Number(expenseCategoryId) : null,
    };
  }

  async function saveDraft() {
    const payload = buildPayload();
    if (!payload) return;
    setBusy(true);
    try {
      const created = await createRequest(payload);
      toast.show("success", "Черновик сохранён");
      nav(`/requests/${created.id}`);
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function saveAndSubmit() {
    const payload = buildPayload();
    if (!payload) return;
    setBusy(true);
    try {
      const created = await createRequest(payload);
      await submitRequest(created.id);
      toast.show("success", "Заявка отправлена на одобрение");
      nav(`/requests/${created.id}`);
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <h1 className="h1">Новая заявка</h1>

      <div className="card grid">
        <div>
          <label>Тип заявки</label>
          <div className="row" style={{ gap: 16, flexWrap: "wrap", marginTop: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="radio"
                name="req_type"
                checked={!isExpenseOnApprove}
                onChange={() => setIsExpenseOnApprove(false)}
              />
              💰 Выдача под отчёт <span className="muted" style={{ fontSize: 12 }}>(получу деньги, отчитаюсь позже)</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="radio"
                name="req_type"
                checked={isExpenseOnApprove}
                onChange={() => setIsExpenseOnApprove(true)}
              />
              📋 Заявка на расход <span className="muted" style={{ fontSize: 12 }}>(деньги сразу спишутся как расход)</span>
            </label>
          </div>
        </div>
        <div>
          <label>Название заявки</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Закупка канцелярии"
          />
        </div>
        <div>
          <label>Подразделение <span style={{ color: "var(--danger)" }}>*</span></label>
          <select
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value ? Number(e.target.value) : "");
              // Сбрасываем выбранные категории — могут не относиться к новому подразделению.
              setItems((prev) => prev.map((it) => ({ ...it, category_id: null })));
              setExpenseCategoryId("");
            }}
          >
            <option value="">— выберите —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 2 }}>
            <label>Кому отправить</label>
            <select
              value={approverId}
              onChange={(e) => setApproverId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">— Выбрать —</option>
              {possibleApprovers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({roleLabel(c.role)})
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <label>Валюта</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as "KGS" | "USD" | "RUB")}>
              <option value="KGS">KGS</option>
              <option value="USD">USD</option>
              <option value="RUB">RUB</option>
            </select>
          </div>
        </div>
        {isExpenseOnApprove && (
          <div>
            <label>Категория расхода <span style={{ color: "var(--danger)" }}>*</span></label>
            <select
              value={expenseCategoryId}
              onChange={(e) => setExpenseCategoryId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">— Выбрать —</option>
              {visibleCategories.map((c: any) => (
                <option key={c.id} value={c.id}>{c.display_name || c.name}</option>
              ))}
            </select>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              При одобрении создастся расход на ваше имя в этой категории.
            </div>
          </div>
        )}
      </div>

      <h2 className="h2" style={{ marginTop: 18 }}>Строки заявки</h2>
      <div className="card" style={{ overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Описание</th>
              <th>Категория</th>
              <th style={{ width: 80 }}>Кол-во</th>
              <th style={{ width: 140, textAlign: "right" }}>Сумма</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td>
                  <input
                    value={it.description}
                    onChange={(e) => updateItem(idx, { description: e.target.value })}
                    placeholder="Бумага A4"
                  />
                </td>
                <td>
                  <select
                    value={it.category_id ?? ""}
                    onChange={(e) =>
                      updateItem(idx, {
                        category_id: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">—</option>
                    {visibleCategories.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.display_name || c.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                    inputMode="numeric"
                  />
                </td>
                <td>
                  <input
                    value={it.amount}
                    onChange={(e) => updateItem(idx, { amount: e.target.value })}
                    inputMode="decimal"
                    style={{ textAlign: "right" }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => removeItem(idx)}
                    disabled={items.length === 1}
                    style={{ padding: "4px 8px" }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 10 }}>
          <button type="button" className="ghost" onClick={addItem}>
            + Добавить строку
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row between">
          <span className="h2" style={{ margin: 0 }}>Итого:</span>
          <span style={{ fontSize: 24, fontWeight: 700 }}>
            {total.toLocaleString("ru-RU")} {currency === "KGS" ? "с" : currency}
          </span>
        </div>
      </div>

      <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
        <button type="button" className="ghost" onClick={saveDraft} disabled={busy}>
          Сохранить черновик
        </button>
        <button type="button" onClick={saveAndSubmit} disabled={busy}>
          {isExpenseOnApprove ? "Отправить заявку на расход" : "Отправить"}
        </button>
      </div>
    </div>
  );
}

function roleLabel(role: string): string {
  return (
    {
      superadmin: "суперадмин",
      admin: "admin",
      gen_director: "ген. директор",
      auditor: "аудитор",
      accountable: "подотчётный",
    } as Record<string, string>
  )[role] || role;
}
