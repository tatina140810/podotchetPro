import { api } from "./client";

export type RequestStatus = "draft" | "pending" | "approved" | "rejected";

export interface MoneyRequestItem {
  id: number;
  request_id: number;
  category_id: number | null;
  category_name: string | null;
  description: string;
  amount: string;  // Decimal сериализуется как строка
  quantity: number;
}

export interface MoneyRequestItemIn {
  category_id?: number | null;
  description: string;
  amount: number | string;
  quantity?: number;
}

export interface MoneyRequestReceipt {
  id: number;
  request_id: number;
  file_url: string;
  file_name: string | null;
  uploaded_by_id: number;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface MoneyRequest {
  id: number;
  org_id: number;
  requester_id: number;
  requester_name: string | null;
  approver_id: number;
  approver_name: string | null;
  status: RequestStatus;
  title: string;
  total_amount: string;
  currency: string;
  comment: string | null;
  is_expense_on_approve: boolean;
  expense_category_id: number | null;
  expense_category_name: string | null;
  department_id: number | null;
  department_name: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  items: MoneyRequestItem[];
  receipts: MoneyRequestReceipt[];
}

export function listRequests(params: {
  status?: RequestStatus;
  date_from?: string;
  date_to?: string;
} = {}): Promise<MoneyRequest[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.date_from) qs.set("date_from", params.date_from);
  if (params.date_to) qs.set("date_to", params.date_to);
  const q = qs.toString();
  return api<MoneyRequest[]>(`/api/requests${q ? `?${q}` : ""}`);
}

export function getRequest(id: number): Promise<MoneyRequest> {
  return api<MoneyRequest>(`/api/requests/${id}`);
}

export function createRequest(payload: {
  title: string;
  approver_id: number;
  department_id?: number | null;
  currency?: string;
  items: MoneyRequestItemIn[];
  is_expense_on_approve?: boolean;
  expense_category_id?: number | null;
}): Promise<MoneyRequest> {
  return api<MoneyRequest>("/api/requests", { method: "POST", body: payload });
}

export function updateRequest(
  id: number,
  payload: {
    title?: string;
    approver_id?: number;
    currency?: string;
    is_expense_on_approve?: boolean;
    expense_category_id?: number | null;
  }
): Promise<MoneyRequest> {
  return api<MoneyRequest>(`/api/requests/${id}`, { method: "PATCH", body: payload });
}

export function addItem(requestId: number, item: MoneyRequestItemIn) {
  return api<MoneyRequestItem>(`/api/requests/${requestId}/items`, {
    method: "POST",
    body: item,
  });
}

export function updateItem(requestId: number, itemId: number, item: MoneyRequestItemIn) {
  return api<MoneyRequestItem>(`/api/requests/${requestId}/items/${itemId}`, {
    method: "PUT",
    body: item,
  });
}

export function deleteItem(requestId: number, itemId: number) {
  return api<void>(`/api/requests/${requestId}/items/${itemId}`, { method: "DELETE" });
}

export function submitRequest(id: number) {
  return api<MoneyRequest>(`/api/requests/${id}/submit`, { method: "POST" });
}

/** Правки, которые адресат вносит прямо при одобрении. Всё необязательное:
 *  без них — обычное одобрение. Сумма правится строками, итог считает сервер. */
export interface ApproveEditItem {
  id?: number;              // без id — новая строка
  category_id?: number | null;
  description: string;
  amount: string | number;
  quantity?: number;
}

export interface ApproveEdits {
  title?: string;
  currency?: string;
  department_id?: number | null;
  is_expense_on_approve?: boolean;
  expense_category_id?: number | null;
  comment?: string;
  items?: ApproveEditItem[];
}

export function approveRequest(id: number, edits?: ApproveEdits) {
  return api<MoneyRequest>(`/api/requests/${id}/approve`, {
    method: "POST",
    ...(edits ? { body: edits } : {}),
  });
}

export function rejectRequest(id: number, comment: string) {
  return api<MoneyRequest>(`/api/requests/${id}/reject`, {
    method: "POST",
    body: { comment },
  });
}

export function deleteRequest(id: number) {
  return api<void>(`/api/requests/${id}`, { method: "DELETE" });
}

/** Чеки/документы одобренной заявки. Файл сначала грузится через uploadReceipt
 *  (общий эндпоинт загрузки), сюда привязывается уже полученный url. */
export function listRequestReceipts(requestId: number): Promise<MoneyRequestReceipt[]> {
  return api<MoneyRequestReceipt[]>(`/api/requests/${requestId}/receipts`);
}

export function addRequestReceipt(
  requestId: number,
  file_url: string,
  file_name: string | null,
): Promise<MoneyRequestReceipt> {
  return api<MoneyRequestReceipt>(`/api/requests/${requestId}/receipts`, {
    method: "POST",
    body: { file_url, file_name },
  });
}

export function deleteRequestReceipt(requestId: number, receiptId: number): Promise<void> {
  return api<void>(`/api/requests/${requestId}/receipts/${receiptId}`, { method: "DELETE" });
}
