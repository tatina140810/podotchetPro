// Раскрывающаяся развёртка операций сотрудника за выбранный период
// (содержимое строки-аккордеона в «Отчёте по сотрудникам»).

const KIND_RU: Record<string, string> = {
  topup: "Выдача (получил)",
  topup_out: "Выдача (отдал)",
  income: "Приход",
  transfer_in: "↙ Получил перевод",
  transfer_out: "↗ Передал",
  request_approved: "Заявка (получено)",
  request_approved_out: "Заявка (выдал)",
  expense: "Расход",
};

export default function EmployeeDetailRows({ entries }: { entries: any[] | null | undefined }) {
  if (entries === undefined) return <div className="muted">Загрузка деталей...</div>;
  if (!entries || entries.length === 0) return <div className="muted">Деталей нет</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>Дата</th>
          <th>Тип</th>
          <th>Кто/Категория</th>
          <th style={{ textAlign: "right" }}>Сумма</th>
          <th>Описание</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((d: any, idx: number) => {
          const amt = Number(d.amount);
          const cur = (d.currency || "KGS") as string;
          const symNative = cur === "USD" ? "$" : cur === "RUB" ? "₽" : cur === "EUR" ? "€" : "с";
          return (
            <tr key={idx}>
              <td className="muted" style={{ fontSize: 12 }}>
                {d.created_at ? new Date(d.created_at).toLocaleDateString("ru-RU") : ""}
              </td>
              <td style={{ fontSize: 12 }}>{KIND_RU[d.kind] || d.kind}</td>
              <td style={{ fontSize: 12 }}>{d.counterparty || "—"}</td>
              <td style={{
                textAlign: "right", fontWeight: 600,
                color: amt < 0 ? "var(--danger)" : "var(--success)",
              }}>
                {amt > 0 ? "+" : ""}{amt.toLocaleString("ru-RU")} {symNative}
              </td>
              <td className="muted" style={{ fontSize: 12 }}>{d.note || ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
