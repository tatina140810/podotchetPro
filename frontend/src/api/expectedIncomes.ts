import { api } from "./client";

export type ExpPeriodicity = "one_time" | "monthly" | "weekly";
export type ExpStatus = "pending" | "received";

export interface ExpectedIncome {
  id: number;
  user_id: number;
  name: string;
  amount: string;
  currency: "KGS" | "USD";
  amount_kgs: string | null;
  expected_date: string | null;
  periodicity: ExpPeriodicity;
  comment: string | null;
  status: ExpStatus;
  received_at: string | null;
  created_income_id: number | null;
  created_at: string;
}

export const EXP_PERIODICITY_RU: Record<ExpPeriodicity, string> = {
  one_time: "разово",
  monthly: "ежемесячно",
  weekly: "еженедельно",
};

export function listExpected(userId?: number): Promise<ExpectedIncome[]> {
  const q = userId ? `?user_id=${userId}` : "";
  return api<ExpectedIncome[]>(`/api/expected-incomes${q}`);
}

export function createExpected(payload: {
  name: string;
  amount: number | string;
  currency: "KGS" | "USD";
  expected_date?: string | null;
  periodicity: ExpPeriodicity;
  comment?: string | null;
}): Promise<ExpectedIncome> {
  return api<ExpectedIncome>("/api/expected-incomes", { method: "POST", body: payload });
}

export function updateExpected(
  id: number,
  payload: Partial<{
    name: string;
    amount: number | string;
    currency: "KGS" | "USD";
    expected_date: string | null;
    periodicity: ExpPeriodicity;
    comment: string | null;
  }>
): Promise<ExpectedIncome> {
  return api<ExpectedIncome>(`/api/expected-incomes/${id}`, { method: "PATCH", body: payload });
}

export function deleteExpected(id: number): Promise<void> {
  return api<void>(`/api/expected-incomes/${id}`, { method: "DELETE" });
}

export function receiveExpected(id: number): Promise<ExpectedIncome> {
  return api<ExpectedIncome>(`/api/expected-incomes/${id}/receive`, { method: "POST" });
}
