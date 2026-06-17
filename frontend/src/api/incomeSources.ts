import { api } from "./client";

export interface IncomeSource {
  id: number;
  org_id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  income_count: number;
}

export function listIncomeSources(activeOnly = false): Promise<IncomeSource[]> {
  const q = activeOnly ? "?active_only=true" : "";
  return api<IncomeSource[]>(`/api/income-sources${q}`);
}

export function createIncomeSource(name: string): Promise<IncomeSource> {
  return api<IncomeSource>("/api/income-sources", { method: "POST", body: { name } });
}

export function updateIncomeSource(
  id: number,
  payload: Partial<{ name: string; is_active: boolean }>
): Promise<IncomeSource> {
  return api<IncomeSource>(`/api/income-sources/${id}`, { method: "PATCH", body: payload });
}

export function deleteIncomeSource(id: number): Promise<void> {
  return api<void>(`/api/income-sources/${id}`, { method: "DELETE" });
}
