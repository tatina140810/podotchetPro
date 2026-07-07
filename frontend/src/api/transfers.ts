import { api } from "./client";

export interface MoneyTransfer {
  id: number;
  org_id: number;
  from_user_id: number;
  from_user_name: string | null;
  to_user_id: number;
  to_user_name: string | null;
  amount: string;
  currency: "KGS" | "USD" | "EUR" | "RUB" | string;
  amount_kgs: string | null;
  note: string | null;
  created_at: string;
}

export interface BalanceTopUp {
  id: number;
  org_id: number;
  admin_id: number;
  admin_name: string | null;
  user_id: number;
  user_name: string | null;
  amount: string;
  currency: "KGS" | "USD" | "EUR" | "RUB" | string;
  amount_kgs: string | null;
  note: string | null;
  date: string;        // бизнес-дата операции
  category_id: number | null;
  category_name: string | null;
  department_id: number | null;
  department_name: string | null;
  created_at: string;  // когда запись внесли в систему
}

export function listTransfers(): Promise<MoneyTransfer[]> {
  return api<MoneyTransfer[]>("/api/transfers");
}

export function createTransfer(payload: {
  to_user_id: number;
  amount: number | string;
  currency?: "KGS" | "USD" | "EUR" | "RUB" | string;
  note?: string | null;
}): Promise<MoneyTransfer> {
  return api<MoneyTransfer>("/api/transfers", { method: "POST", body: payload });
}

export function topupUser(
  userId: number,
  payload: {
    amount: number | string;
    currency?: "KGS" | "USD" | "EUR" | "RUB";
    note?: string | null;
    date?: string;
    category_id?: number | null;
    department_id?: number | null;
    issued_by_id?: number | null;
  }
): Promise<BalanceTopUp> {
  return api<BalanceTopUp>(`/api/users/${userId}/topup`, {
    method: "POST",
    body: payload,
  });
}

export function listTopups(userId: number): Promise<BalanceTopUp[]> {
  return api<BalanceTopUp[]>(`/api/users/${userId}/topups`);
}

export function listMyIssuedTopups(): Promise<BalanceTopUp[]> {
  return api<BalanceTopUp[]>("/api/users/me/issued-topups");
}

export function updateTopup(
  id: number,
  payload: Partial<{
    amount: number | string;
    currency: "KGS" | "USD" | "EUR" | "RUB";
    note: string | null;
    date: string;
    user_id: number;
    admin_id: number;
    category_id: number | null;
    department_id: number | null;
  }>
): Promise<BalanceTopUp> {
  return api<BalanceTopUp>(`/api/users/topups/${id}`, { method: "PATCH", body: payload });
}

export function deleteTopup(id: number): Promise<void> {
  return api<void>(`/api/users/topups/${id}`, { method: "DELETE" });
}
