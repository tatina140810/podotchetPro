const LABELS: Record<string, string> = {
  pending: "На проверке",
  approved: "Принят",
  rejected: "Отклонён",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{LABELS[status] || status}</span>;
}
