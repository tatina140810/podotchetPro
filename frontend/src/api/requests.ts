import { api } from "./client";

// accepted/issued/closed — упрощённые заявки (flow="simple", 2026-09-28):
// одобрена с разноской → выдано (ждём чек) → закрыта.
export type RequestStatus = "draft" | "pending" | "approved" | "rejected" | "accepted" | "issued" | "closed";

export interface MoneyRequestItem {
  id: number;
  request_id: number;
  category_id: number | null;
  category_name: string | null;
  description: string;
  amount: string;  // Decimal сериализуется как строка
  quantity: number;
  customer?: string | null;
  comment?: string | null;
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
  // Упрощённая заявка
  flow?: string | null;
  handler_category_id?: number | null;
  handler_category_name?: string | null;
  handler_payment_method?: "cash" | "bank" | null;
  handler_amount?: string | null;
  handler_currency?: string | null;
  handler_date?: string | null;
  handler_comment?: string | null;
  issued_at?: string | null;
  issued_by_name?: string | null;
  issue_topup_id?: number | null;
  no_receipt?: boolean;
  no_receipt_comment?: string | null;
  closed_at?: string | null;
  expense_id?: number | null;
  returned_comment?: string | null;
  returned_at?: string | null;
}

// ===== Упрощённые заявки (2026-09-28) =====
export interface RequestsConfig {
  handler_id: number | null; handler_name: string | null; simple_form: boolean;
  is_reviewer?: boolean; reviewer_name?: string | null;
}
export interface SimpleItemIn { description: string; customer?: string; quantity: number; amount: string; comment?: string }
export interface AcceptPayload {
  category_id: number; department_id: number; payment_method: "cash" | "bank";
  amount: string; currency: string; spent_date: string; comment?: string;
}

export function getRequestsConfig(): Promise<RequestsConfig> {
  return api<RequestsConfig>("/api/requests/config");
}
export function createSimpleRequest(payload: { currency: string; items: SimpleItemIn[] }): Promise<MoneyRequest> {
  return api<MoneyRequest>("/api/requests/simple", { method: "POST", body: payload });
}
export function acceptRequest(id: number, payload: AcceptPayload): Promise<MoneyRequest> {
  return api<MoneyRequest>(`/api/requests/${id}/accept`, { method: "POST", body: payload });
}
export function closeRequest(id: number, body: { amount?: string; no_receipt?: boolean; no_receipt_comment?: string }): Promise<MoneyRequest> {
  return api<MoneyRequest>(`/api/requests/${id}/close`, { method: "POST", body });
}
export function issueRequest(id: number): Promise<MoneyRequest> {
  return api<MoneyRequest>(`/api/requests/${id}/issue`, { method: "POST" });
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

// ===== Отчёт принимающего на одобрении у владельца (шаг 3) =====
export interface HandlerReportRow {
  expense_id: number; request_id: number; request_title: string; requester_name: string | null;
  items: MoneyRequestItem[]; category_id: number | null; category_name: string | null;
  department_id: number | null; department_name: string | null; payment_method: "cash" | "bank" | null;
  amount: string; currency: string; amount_kgs: string | null; issued_amount: string | null;
  spent_at: string; status: string; description: string | null; receipts: MoneyRequestReceipt[];
  no_receipt: boolean; no_receipt_comment: string | null; recorded_by_name: string | null; reviewed_by_name: string | null;
  report_hold?: boolean; released_at?: string | null;
}
export function releaseHandlerReport(body: { amount: string; currency: string; payment_method: "cash" | "bank"; note?: string }): Promise<{ ok: boolean; released: number }> {
  return api("/api/requests/handler-report/release", { method: "POST", body });
}
export interface HandlerReportEdit {
  category_id?: number; department_id?: number; payment_method?: "cash" | "bank";
  amount?: string; spent_date?: string; description?: string;
}
export function getHandlerReport(status: "pending" | "approved" | "all"): Promise<HandlerReportRow[]> {
  return api<HandlerReportRow[]>(`/api/requests/handler-report?status=${status}`);
}
export function editHandlerReportRow(id: number, body: HandlerReportEdit): Promise<HandlerReportRow> {
  return api<HandlerReportRow>(`/api/requests/handler-report/${id}`, { method: "PATCH", body });
}
export function approveHandlerReport(ids: number[]): Promise<HandlerReportRow[]> {
  return api<HandlerReportRow[]>("/api/requests/handler-report/approve", { method: "POST", body: { expense_ids: ids } });
}
export function rejectHandlerReportRow(id: number, comment: string): Promise<{ ok: boolean }> {
  return api(`/api/requests/handler-report/${id}/reject`, { method: "POST", body: { comment } });
}
