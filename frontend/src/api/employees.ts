import { api, downloadFile } from "./client";

export interface ReceivedRow {
  id: number; kind?: string; date: string;
  from_name: string | null; from_id: number | null; department_id: number | null;
  amount: number; currency: string; amount_kgs: number; comment: string | null;
}
export interface TransferredRow {
  id: number; date: string; to_name: string | null; to_user_id: number | null;
  department_id: number | null; category: string | null; category_id: number | null;
  amount: number; currency: string; amount_kgs: number; comment: string | null;
}
export interface ExpenseRow {
  id: number; date: string; category: string | null; category_id: number | null;
  department_id: number | null;
  amount: number; currency: string; amount_kgs: number; comment: string | null;
}
export interface RequestOwnRow {
  id: number; date: string; category: string | null; amount: number;
  currency: string; amount_kgs: number; status: string; comment: string | null;
}
export interface RequestApprovedRow extends RequestOwnRow {
  employee_name: string | null;
}

export interface EmployeeProfile {
  employee: { id: number; name: string; role: string; department: string | null; department_ids: number[] };
  period: { month: number; year: number };
  currency: "KGS" | "USD";
  summary: {
    received: { total: number; count: number };
    transferred: { total: number; count: number };
    spent: { total: number; count: number };
    balance: number;
    debt: number;
  };
  received: ReceivedRow[];
  transferred: TransferredRow[];
  expenses: ExpenseRow[];
  requests_own: RequestOwnRow[];
  requests_approved_by: RequestApprovedRow[];
}

export function getEmployeeProfile(
  id: number, month: number, year: number, currency: string,
): Promise<EmployeeProfile> {
  return api<EmployeeProfile>(
    `/api/employees/${id}/profile?month=${month}&year=${year}&currency=${currency}&_t=${Date.now()}`,
  );
}

export function exportEmployeeProfile(
  id: number, month: number, year: number, currency: string, name: string,
): Promise<void> {
  const safe = name.replace(/[^\wа-яА-ЯёЁ-]+/g, "_");
  return downloadFile(
    `/api/employees/${id}/profile/export?month=${month}&year=${year}&currency=${currency}`,
    `profile_${safe}_${year}_${String(month).padStart(2, "0")}.xlsx`,
  );
}

// ===================== Мутации inline-редактирования =====================
// Используют реальные эндпоинты (topups/incomes/expenses/requests).

const J = (body: any) => ({ method: "PATCH", body } as const);

export const profileApi = {
  // PATCH
  updateTopup: (id: number, body: any) => api(`/api/users/topups/${id}`, J(body)),
  updateIncome: (id: number, body: any) => api(`/api/incomes/${id}`, J(body)),
  updateExpense: (id: number, body: any) => api(`/api/expenses/${id}`, J(body)),
  updateRequestComment: (id: number, comment: string) =>
    api(`/api/requests/${id}`, J({ comment })),
  // DELETE
  deleteTopup: (id: number) => api(`/api/users/topups/${id}`, { method: "DELETE" }),
  deleteIncome: (id: number) => api(`/api/incomes/${id}`, { method: "DELETE" }),
  deleteExpense: (id: number) => api(`/api/expenses/${id}`, { method: "DELETE" }),
  deleteRequest: (id: number) => api(`/api/requests/${id}`, { method: "DELETE" }),
  // CREATE (POST)
  // Приход сотруднику empId (admin_id = issuedById или текущий пользователь).
  createReceived: (empId: number, body: any) =>
    api(`/api/users/${empId}/topup`, { method: "POST", body }),
  // «Передал дальше»: выдача от лица empId получателю toId (issued_by_id = empId).
  createTransfer: (toId: number, empId: number, body: any) =>
    api(`/api/users/${toId}/topup`, { method: "POST", body: { ...body, issued_by_id: empId } }),
  // Расход от лица empId.
  createExpense: (empId: number, body: any) =>
    api(`/api/expenses`, { method: "POST", body: { ...body, on_behalf_of_user_id: empId } }),
  // Приход-Income (для Undo удаления income-строки).
  createIncome: (empId: number, body: any) =>
    api(`/api/incomes`, { method: "POST", body: { ...body, received_by_id: empId } }),
};
