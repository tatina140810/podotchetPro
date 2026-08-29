import { api } from "./client";

// Расход отдаётся бэкендом как «широкий» объект (см. ExpenseOut). Здесь — только то,
// что нужно фронту для правки/удаления в «Истории»; остальное берём как any на месте.
export interface Expense {
  id: number;
  employee_id: number;
  category_id: number | null;
  category_name: string | null;
  department_id: number | null;
  amount: string;
  currency: "KGS" | "USD" | "EUR" | "RUB" | string;
  amount_kgs: string | null;
  description: string | null;
  status: "pending" | "approved" | "rejected";
  is_personal_contribution: boolean;
  spent_at: string;
}

export function updateExpense(
  id: number,
  payload: Partial<{
    category_id: number | null;
    department_id: number | null;
    amount: number | string;
    currency: "KGS" | "USD" | "EUR" | "RUB";
    description: string | null;
    spent_at: string;
    is_personal_contribution: boolean;
  }>
): Promise<Expense> {
  return api<Expense>(`/api/expenses/${id}`, { method: "PATCH", body: payload });
}

export function deleteExpense(id: number): Promise<void> {
  return api<void>(`/api/expenses/${id}`, { method: "DELETE" });
}
