import { api } from "./client";

export type AdvanceStatus = "active" | "depleted" | "closed";
export type AdvanceTxType = "deposit" | "purchase" | "refund";

export interface SupplierAdvanceTransaction {
  id: number;
  advance_id: number;
  type: AdvanceTxType;
  amount: string;
  expense_id: number | null;
  date: string;
  created_by_id: number | null;
  category_name?: string | null;
  department_name?: string | null;
  description?: string | null;
  receipt_url?: string | null;
}

export interface SupplierAdvance {
  id: number;
  org_id: number;
  workspace_id: number | null;
  employee_id: number;
  supplier_name: string;
  initial_amount: string;
  currency: string;
  status: AdvanceStatus;
  comment: string | null;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
  deposited: string;
  spent: string;
  refunded: string;
  remaining: string;
  employee_name?: string | null;
  transactions: SupplierAdvanceTransaction[];
}

export interface CreateAdvancePayload {
  employee_id?: number;
  supplier_name: string;
  amount: number;
  currency?: string;
  date?: string;
  comment?: string | null;
}

export function listSupplierAdvances(activeOnly = false): Promise<SupplierAdvance[]> {
  return api<SupplierAdvance[]>(`/api/supplier-advances${activeOnly ? "?active_only=true" : ""}`);
}

export function getSupplierAdvance(id: number): Promise<SupplierAdvance> {
  return api<SupplierAdvance>(`/api/supplier-advances/${id}`);
}

export function createSupplierAdvance(payload: CreateAdvancePayload): Promise<SupplierAdvance> {
  return api<SupplierAdvance>("/api/supplier-advances", { method: "POST", body: payload });
}

export function depositToAdvance(
  id: number,
  payload: { amount: number; date?: string; comment?: string | null },
): Promise<SupplierAdvance> {
  return api<SupplierAdvance>(`/api/supplier-advances/${id}/deposit`, { method: "POST", body: payload });
}

export function refundAdvance(
  id: number,
  payload: { amount: number; date?: string; comment?: string | null },
): Promise<SupplierAdvance> {
  return api<SupplierAdvance>(`/api/supplier-advances/${id}/refund`, { method: "POST", body: payload });
}

export function closeAdvance(id: number): Promise<SupplierAdvance> {
  return api<SupplierAdvance>(`/api/supplier-advances/${id}/close`, { method: "POST" });
}

export function updateSupplierAdvance(
  id: number,
  payload: { supplier_name?: string; comment?: string | null },
): Promise<SupplierAdvance> {
  return api<SupplierAdvance>(`/api/supplier-advances/${id}`, { method: "PATCH", body: payload });
}

export function deleteSupplierAdvance(id: number): Promise<void> {
  return api<void>(`/api/supplier-advances/${id}`, { method: "DELETE" });
}
