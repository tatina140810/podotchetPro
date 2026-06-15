import { api } from "./client";

export interface Department {
  id: number;
  org_id: number;
  name: string;
  created_at: string;
  employee_count: number;
  category_count: number;
}

export function listDepartments(): Promise<Department[]> {
  return api<Department[]>("/api/departments");
}

export function createDepartment(name: string): Promise<Department> {
  return api<Department>("/api/departments", { method: "POST", body: { name } });
}

export function deleteDepartment(id: number): Promise<void> {
  return api<void>(`/api/departments/${id}`, { method: "DELETE" });
}
