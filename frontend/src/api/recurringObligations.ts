import { api } from "./client";

export type Periodicity = "monthly" | "weekly" | "one_time";

export interface RecurringObligation {
  id: number;
  user_id: number;
  name: string;
  amount: string;          // Decimal приходит строкой
  periodicity: Periodicity;
  comment: string | null;
  sort_order: number;
  created_at: string;
}

export const PERIODICITY_RU: Record<Periodicity, string> = {
  monthly: "ежемесячно",
  weekly: "еженедельно",
  one_time: "разово",
};

export function listObligations(userId?: number): Promise<RecurringObligation[]> {
  const q = userId ? `?user_id=${userId}` : "";
  return api<RecurringObligation[]>(`/api/recurring-obligations${q}`);
}

export function createObligation(payload: {
  name: string;
  amount: number | string;
  periodicity: Periodicity;
  comment?: string | null;
}): Promise<RecurringObligation> {
  return api<RecurringObligation>("/api/recurring-obligations", { method: "POST", body: payload });
}

export function updateObligation(
  id: number,
  payload: Partial<{ name: string; amount: number | string; periodicity: Periodicity; comment: string | null }>
): Promise<RecurringObligation> {
  return api<RecurringObligation>(`/api/recurring-obligations/${id}`, { method: "PATCH", body: payload });
}

export function deleteObligation(id: number): Promise<void> {
  return api<void>(`/api/recurring-obligations/${id}`, { method: "DELETE" });
}

export function reorderObligations(ids: number[]): Promise<RecurringObligation[]> {
  return api<RecurringObligation[]>("/api/recurring-obligations/reorder", {
    method: "POST",
    body: { ids },
  });
}
