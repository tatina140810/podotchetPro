/**
 * Переиспользуемая форма расхода/передачи.
 * Встраивается в /expenses, /my-expenses (сверху списка) и /expenses/new (полная страница).
 *
 * Props:
 *   onSaved — вызывается после успешного создания (родитель решает: reload список / nav).
 *   onCancel — опционально, для рендера кнопки «Отмена».
 *   compact — слегка плотнее (для встраивания в страницу).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, uploadReceipt } from "../api/client";
import { useToast } from "../components/Toast";
import {
  useAuth,
  type UserOut,
} from "../context/AuthContext";
import { listColleagues } from "../api/users";
import { listDepartments, type Department } from "../api/departments";
import { createTransfer, topupUser } from "../api/transfers";
import { createIncome } from "../api/income";
import { listSupplierAdvances, type SupplierAdvance } from "../api/supplierAdvances";
import { CategoryPicker } from "./CategoryPicker";

type Kind = "expense" | "income" | "transfer";

interface Props {
  onSaved?: () => void;
  onCancel?: () => void;
  compact?: boolean;
}

export function NewExpenseForm({ onSaved, onCancel, compact }: Props) {
  const toast = useToast();
  const { user: me } = useAuth();

  const [kind, setKind] = useState<Kind>("expense");
  const [cats, setCats] = useState<any[]>([]);
  // Источник оплаты: с баланса (по умолчанию) или с депозита у поставщика.
  const [advances, setAdvances] = useState<SupplierAdvance[]>([]);
  const [paySource, setPaySource] = useState<"balance" | "supplier_advance">("balance");
  const [advanceId, setAdvanceId] = useState<string>("");
  const [spec, setSpec] = useState<any>(null);
  const [colleagues, setColleagues] = useState<UserOut[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  // Admin mode: вносим от лица другого пользователя. "" = себя.
  const [onBehalfOf, setOnBehalfOf] = useState<number | "">("");
  const [form, setForm] = useState({
    category_id: "" as any,
    department_id: "" as any,
    transfer_to_user_id: "" as number | "",
    source: "",
    amount: "" as any,
    currency: "KGS",
    description: "",
    receipt_url: "" as string | null,
    spent_at: new Date().toISOString().slice(0, 10),
    is_personal_contribution: false,
  });
  const [busy, setBusy] = useState(false);
  // Синхронный замок от двойной отправки: setBusy(state) применяется не сразу,
  // и быстрый повторный клик/ре-файр успевает проскочить до пере-рендера кнопки —
  // тогда создаются два одинаковых расхода (double-submit). Ref срабатывает сразу.
  const submittingRef = useRef(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!me) return;
    api(`/api/specs/${me.id}`).then(setSpec).catch(() => {});
    api("/api/categories").then(setCats).catch(() => {});
    listColleagues().then(setColleagues).catch(() => {});
    listSupplierAdvances(true).then(setAdvances).catch(() => {});
    // Подотчётный выбирает только СВОИ подразделения (директор/админ видят все —
    // это уже разруливает бэкенд по роли). Назначить подразделение сотруднику
    // можно в его профиле («Сотрудники» → «Изменить»).
    listDepartments(true).then((ds) => {
      setDepartments(ds);
      // Если подразделение одно — подставляем автоматически (типичный случай).
      if (ds.length === 1) setForm((s) => ({ ...s, department_id: String(ds[0].id) }));
    }).catch(() => {});
  }, [me?.id]);

  // Передать можно любому коллеге в организации (деньги уходят только с баланса
  // отправителя — бэкенд это разрешает всем ролям, включая подотчётного).
  const recipients = colleagues;

  const allowedIds: number[] | null = spec?.allowed_categories || null;
  const visibleCats = useMemo(() => {
    let out = allowedIds ? cats.filter((c: any) => allowedIds.includes(c.id)) : cats;
    // После выбора подразделения — показываем общие (department_id=null) + его категории.
    if (form.department_id) {
      const did = Number(form.department_id);
      out = out.filter((c: any) => c.department_id == null || c.department_id === did);
    }
    return out;
  }, [cats, allowedIds, form.department_id]);
  const selectedAdvance = advances.find((a) => String(a.id) === advanceId) || null;
  const requiresReceipt = !!spec?.requires_receipt;

  function resetForm() {
    setForm({
      category_id: "",
      department_id: "",
      transfer_to_user_id: "",
      source: "",
      amount: "",
      currency: "KGS",
      description: "",
      receipt_url: "",
      spent_at: new Date().toISOString().slice(0, 10),
      is_personal_contribution: false,
    });
    setPaySource("balance");
    setAdvanceId("");
    // onBehalfOf не сбрасываем — admin часто вносит подряд несколько записей за одного
  }

  const isAdmin = me?.role === "admin" || me?.role === "superadmin";
  // Кто может «передать с категорией» (через механизм выдачи BalanceTopUp): director-level.
  // Категория «Подотчёт» (системная) → деньги остаются на балансе получателя; обычная
  // категория → у получателя сразу авто-расход на неё. Рядовой accountable передаёт
  // без категории (обычный MoneyTransfer).
  const canCategorizeTransfer =
    me?.role === "admin" || me?.role === "superadmin" || me?.role === "gen_director";
  const onBehalfName = onBehalfOf
    ? colleagues.find((c) => c.id === onBehalfOf)?.name
    : null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const { url } = await uploadReceipt(f);
      setForm((s) => ({ ...s, receipt_url: url }));
      toast.show("success", "Чек загружен");
    } catch (err: any) {
      toast.show("error", err.message);
    } finally { setUploading(false); }
  }

  async function submitExpense() {
    if (requiresReceipt && !form.receipt_url) {
      toast.show("error", "Прикрепите фото чека");
      return false;
    }
    if (!form.department_id) {
      toast.show("error", "Выберите подразделение");
      return false;
    }
    if (paySource === "supplier_advance") {
      if (!advanceId) {
        toast.show("error", "Выберите депозит поставщика");
        return false;
      }
      const rem = Number(selectedAdvance?.remaining || 0);
      if (Number(form.amount) > rem) {
        toast.show("error", `Сумма больше остатка депозита (${rem.toLocaleString("ru-RU")} ${selectedAdvance?.currency || "KGS"})`);
        return false;
      }
    }
    await api("/api/expenses", {
      method: "POST",
      body: {
        category_id: form.category_id ? Number(form.category_id) : null,
        department_id: Number(form.department_id),
        amount: Number(form.amount),
        currency: form.currency,
        description: form.description || null,
        receipt_url: form.receipt_url || null,
        spent_at: form.spent_at ? new Date(form.spent_at).toISOString() : null,
        on_behalf_of_user_id: isAdmin && onBehalfOf ? Number(onBehalfOf) : null,
        is_personal_contribution: form.is_personal_contribution,
        payment_source: paySource,
        supplier_advance_id: paySource === "supplier_advance" && advanceId ? Number(advanceId) : null,
      },
    });
    const msgPart = onBehalfName ? ` (от лица ${onBehalfName})` : "";
    toast.show("success", "Расход добавлен" + msgPart);
    return true;
  }

  async function submitTransfer() {
    if (!form.transfer_to_user_id) {
      toast.show("error", "Выберите получателя");
      return false;
    }
    if (canCategorizeTransfer) {
      // Передача через выдачу (BalanceTopUp) с категорией: списывается с баланса
      // отправителя, зачисляется получателю. «Подотчёт» (системная) → остаётся на его
      // балансе; обычная категория → авто-расход у получателя на эту категорию.
      await topupUser(Number(form.transfer_to_user_id), {
        amount: Number(form.amount),
        currency: form.currency as "KGS" | "USD" | "EUR" | "RUB",
        note: form.description.trim() || null,
        category_id: form.category_id ? Number(form.category_id) : null,
        issued_by_id: isAdmin && onBehalfOf ? Number(onBehalfOf) : null,
      });
    } else {
      await createTransfer({
        to_user_id: Number(form.transfer_to_user_id),
        amount: Number(form.amount),
        currency: form.currency,
        note: form.description.trim() || null,
      });
    }
    toast.show("success", "Передано");
    return true;
  }

  async function submitIncome() {
    if (!form.source.trim()) {
      toast.show("error", "Укажите источник прихода");
      return false;
    }
    // Подотчётный пишет приход на себя; admin в режиме «от лица» — на выбранного.
    const receiverId = isAdmin && onBehalfOf ? Number(onBehalfOf) : me!.id;
    await createIncome({
      amount: Number(form.amount),
      currency: form.currency as "KGS" | "USD" | "EUR" | "RUB",
      source: form.source.trim(),
      description: form.description.trim() || null,
      received_by_id: receiverId,
      date: form.spent_at ? new Date(form.spent_at).toISOString() : undefined,
    });
    const msgPart = onBehalfName ? ` (от лица ${onBehalfName})` : "";
    toast.show("success", "Приход записан" + msgPart);
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Синхронный замок: второй (быстрый) вызов выходит немедленно, ещё до setBusy.
    if (submittingRef.current) return;
    if (!Number(form.amount) || Number(form.amount) <= 0) {
      toast.show("error", "Введите сумму больше 0");
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    try {
      const ok =
        kind === "transfer" ? await submitTransfer() :
        kind === "income" ? await submitIncome() :
        await submitExpense();
      if (ok) {
        resetForm();
        onSaved?.();
      }
    } catch (err: any) {
      toast.show("error", err.message);
    } finally { submittingRef.current = false; setBusy(false); }
  }

  return (
    <div style={compact ? undefined : { maxWidth: 520 }}>
      {/* Admin mode: «Вношу от лица». Видно только админу. */}
      {isAdmin && (
        <div
          className="card"
          style={{
            marginBottom: 10,
            padding: "10px 14px",
            borderColor: onBehalfOf ? "var(--warning)" : undefined,
            borderWidth: onBehalfOf ? 2 : 1,
            background: onBehalfOf ? "rgba(253, 203, 110, 0.08)" : undefined,
          }}
        >
          <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14 }}>Вношу от лица:</span>
            <select
              value={onBehalfOf}
              onChange={(e) => setOnBehalfOf(e.target.value ? Number(e.target.value) : "")}
              style={{ width: "auto", flex: "0 1 220px" }}
            >
              <option value="">Себя ({me?.name || "admin"})</option>
              {colleagues.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          {onBehalfOf && (
            <div style={{ fontSize: 12, color: "var(--warning)", marginTop: 6 }}>
              Запись будет создана от имени <strong>{onBehalfName}</strong>.
              Аудит пометит вас как фактического автора.
            </div>
          )}
        </div>
      )}

      {/* Переключатель типа операции */}
      <div className="row" style={{ marginBottom: 10, gap: 0 }}>
        <button
          type="button"
          className={kind === "expense" ? "" : "ghost"}
          onClick={() => setKind("expense")}
          style={{ flex: 1, borderRadius: "10px 0 0 10px", fontSize: compact ? 13 : 15 }}
        >
          Расход
        </button>
        <button
          type="button"
          className={kind === "income" ? "" : "ghost"}
          onClick={() => setKind("income")}
          style={{ flex: 1, borderRadius: 0, fontSize: compact ? 13 : 15 }}
        >
          Приход
        </button>
        <button
          type="button"
          className={kind === "transfer" ? "" : "ghost"}
          onClick={() => setKind("transfer")}
          style={{ flex: 1, borderRadius: "0 10px 10px 0", fontSize: compact ? 13 : 15 }}
          disabled={recipients.length === 0}
          title={recipients.length === 0 ? "Нет сотрудников для передачи" : ""}
        >
          Передать
        </button>
      </div>

      <form onSubmit={submit} className="card grid">
        {kind === "expense" && (
          <div>
            <label>Подразделение</label>
            <select
              value={form.department_id}
              onChange={(e) => setForm({ ...form, department_id: e.target.value, category_id: "" })}
              required
            >
              <option value="">— выберите —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}
        {kind === "transfer" ? (
          <>
            <div>
              <label>Кому передать</label>
              <select
                value={form.transfer_to_user_id}
                onChange={(e) => setForm({ ...form, transfer_to_user_id: e.target.value ? Number(e.target.value) : "" })}
                required
              >
                <option value="">— выберите —</option>
                {recipients.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            {canCategorizeTransfer && (
              <>
                <div>
                  <label>Категория выдачи</label>
                  <CategoryPicker
                    cats={visibleCats}
                    value={form.category_id}
                    onChange={(id) => setForm({ ...form, category_id: id })}
                    placeholder="— выберите (или «Подотчёт») —"
                  />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Без категории («Подотчёт») деньги остаются на балансе получателя — он сам
                  разнесёт расходы. С конкретной категорией сумма сразу спишется на неё.
                </div>
              </>
            )}
          </>
        ) : kind === "income" ? (
          <div>
            <label>Источник прихода</label>
            <input
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="напр. «Возврат», «Поступление от клиента»"
              required
            />
          </div>
        ) : (
          <div>
            <label>
              Категория{allowedIds ? " (только разрешённые)" : ""}
            </label>
            <CategoryPicker
              cats={visibleCats}
              value={form.category_id}
              onChange={(id) => setForm({ ...form, category_id: id })}
            />
          </div>
        )}

        {kind === "expense" && advances.length > 0 && (
          <div>
            <label>Источник оплаты</label>
            <div className="row" style={{ gap: 0 }}>
              <button
                type="button"
                className={paySource === "balance" ? "" : "ghost"}
                onClick={() => { setPaySource("balance"); setAdvanceId(""); }}
                style={{ flex: 1, borderRadius: "10px 0 0 10px", fontSize: 13 }}
              >
                С баланса
              </button>
              <button
                type="button"
                className={paySource === "supplier_advance" ? "" : "ghost"}
                onClick={() => setPaySource("supplier_advance")}
                style={{ flex: 1, borderRadius: "0 10px 10px 0", fontSize: 13 }}
              >
                С аванса поставщику
              </button>
            </div>
            {paySource === "supplier_advance" && (
              <select
                value={advanceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setAdvanceId(id);
                  const a = advances.find((x) => String(x.id) === id);
                  if (a) setForm((s) => ({ ...s, currency: a.currency }));
                }}
                required
                style={{ marginTop: 8 }}
              >
                <option value="">— выберите депозит —</option>
                {advances.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.supplier_name} · остаток {Number(a.remaining).toLocaleString("ru-RU")} {a.currency}
                  </option>
                ))}
              </select>
            )}
            {selectedAdvance && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Оплата с депозита не меняет баланс сотрудника. Остаток после покупки: {(Number(selectedAdvance.remaining) - (Number(form.amount) || 0)).toLocaleString("ru-RU")} {selectedAdvance.currency}
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ gap: 8 }}>
          <div style={{ flex: 2 }}>
            <label>Сумма</label>
            <input type="number" min="0.01" step="0.01" value={form.amount}
                   onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <label>Валюта</label>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option value="KGS">KGS — сом</option>
              <option value="USD">USD — $</option>
              <option value="EUR">EUR — €</option>
              <option value="RUB">RUB — ₽</option>
            </select>
          </div>
        </div>

        <div>
          <label>{kind === "transfer" ? "Заметка (необязательно)" : kind === "income" ? "Комментарий (необязательно)" : "Описание"}</label>
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        {kind !== "transfer" && (
          <div>
            <label>{kind === "income" ? "Дата прихода" : "Дата расхода"}</label>
            <input type="date" value={form.spent_at} onChange={(e) => setForm({ ...form, spent_at: e.target.value })} />
          </div>
        )}
        {kind === "expense" && (
          <div>
            <label>Фото чека{requiresReceipt && " (обязательно)"}</label>
            <input type="file" accept="image/*,application/pdf,.xls,.xlsx,.doc,.docx,.csv" capture="environment" onChange={onFile} />
            {uploading && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>загружаю...</div>}
            {form.receipt_url && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>✓ {form.receipt_url}</div>}
          </div>
        )}
        {kind === "expense" && (
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={form.is_personal_contribution}
                onChange={(e) => setForm({ ...form, is_personal_contribution: e.target.checked })}
                style={{ width: "auto", margin: 0 }}
              />
              Расход из личных средств в счёт подразделения
            </label>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Отметьте, если сотрудник оплатил из личных средств без подотчёта. Сумма
              учтётся как вклад в бюджет подразделения (и приход, и расход) — личный
              баланс и приходы сотрудника не меняются.
            </div>
          </div>
        )}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          {onCancel && (
            <button type="button" className="ghost" onClick={onCancel}>Отмена</button>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "..." : (
              kind === "transfer" ? "Передать" :
              kind === "income" ? "Записать приход" :
              "Записать расход"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
