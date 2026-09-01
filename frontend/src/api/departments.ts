import { api } from "./client";

export type DepartmentCurrency = "KGS" | "USD" | "EUR" | "RUB";

export interface Department {
  id: number;
  org_id: number;
  name: string;
  /** Валюта подразделения; null = сомы. Влияет на валюту профиля и форм. */
  currency: DepartmentCurrency | null;
  created_at: string;
  employee_count: number;
  category_count: number;
}

/** all=true — все подразделения org (для выпадающего списка при создании операции;
 * подотчётный может выбрать любое, даже если не привязан к нему). */
export function listDepartments(all = false): Promise<Department[]> {
  return api<Department[]>(`/api/departments${all ? "?all=true" : ""}`);
}

export function createDepartment(name: string, currency: DepartmentCurrency | null = null): Promise<Department> {
  return api<Department>("/api/departments", { method: "POST", body: { name, currency } });
}

export function updateDepartmentCurrency(id: number, currency: DepartmentCurrency | null): Promise<Department> {
  return api<Department>(`/api/departments/${id}`, { method: "PATCH", body: { currency } });
}

export function deleteDepartment(id: number): Promise<void> {
  return api<void>(`/api/departments/${id}`, { method: "DELETE" });
}
