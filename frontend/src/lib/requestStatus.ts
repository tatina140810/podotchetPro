// Подписи и цвета статусов заявки — одни на список и карточку.
import type { RequestStatus } from "../api/requests";

export const STATUS_RU: Record<RequestStatus, string> = {
  draft: "Черновик",
  pending: "На одобрении",
  approved: "Одобрена",
  rejected: "Отклонена",
  // Упрощённые заявки (2026-09-28)
  accepted: "Одобрена, не выдана",
  issued: "Выдано, ждём чек",
  closed: "Закрыта",
};

// Для заявителя «issued» — это «Получил деньги»: он видит свою сторону.
export function statusLabel(status: RequestStatus, isRequester: boolean): string {
  if (status === "issued" && isRequester) return "Получил деньги, ждём чек";
  return STATUS_RU[status] ?? status;
}

export const STATUS_CLS: Record<RequestStatus, string> = {
  draft: "pending",
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  accepted: "pending",
  issued: "approved",
  closed: "approved",
};
