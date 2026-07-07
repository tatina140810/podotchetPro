import { api } from "./client";

export interface Income {
  id: number;
  org_id: number;
  amount: string;
  currency: "KGS" | "USD" | "EUR" | "RUB";
  source: string;
  source_id: number | null;
  description: string | null;
  received_by_id: number;
  received_by_name: string | null;
  created_by_id: number;
  created_by_name: string | null;
  date: string;
  created_at: string;
}

export function listIncomes(params: {
  date_from?: string;
  date_to?: string;
} = {}): Promise<Income[]> {
  const qs = new URLSearchParams();
  if (params.date_from) qs.set("date_from", params.date_from);
  if (params.date_to) qs.set("date_to", params.date_to);
  const q = qs.toString();
  return api<Income[]>(`/api/income${q ? `?${q}` : ""}`);
}

export function createIncome(payload: {
  amount: number | string;
  currency: "KGS" | "USD" | "EUR" | "RUB";
  source?: string | null;
  source_id?: number | null;
  description?: string | null;
  received_by_id: number;
  date?: string;
}): Promise<Income> {
  return api<Income>("/api/income", { method: "POST", body: payload });
}

export function deleteIncome(id: number): Promise<void> {
  return api<void>(`/api/income/${id}`, { method: "DELETE" });
}

export function updateIncome(
  id: number,
  payload: Partial<{
    amount: number | string;
    currency: "KGS" | "USD" | "EUR" | "RUB";
    source: string;
    source_id: number | null;
    description: string | null;
    received_by_id: number;
    date: string;
  }>
): Promise<Income> {
  return api<Income>(`/api/income/${id}`, { method: "PATCH", body: payload });
}
