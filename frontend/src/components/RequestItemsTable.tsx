/** Таблица строк заявки (только чтение) — вынесена из RequestDetail. */
import type { MoneyRequestItem } from "../api/requests";

export function RequestItemsTable({ items, total, curLabel }: {
  items: MoneyRequestItem[];
  total: string;
  curLabel: string;
}) {
  return (
    <div className="card" style={{ overflow: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Описание</th>
            <th>Категория</th>
            <th style={{ textAlign: "right" }}>Кол-во</th>
            <th style={{ textAlign: "right" }}>Сумма</th>
            <th style={{ textAlign: "right" }}>Итого</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const subtotal = Number(it.amount) * it.quantity;
            return (
              <tr key={it.id}>
                <td>{it.description}</td>
                <td className="muted">{it.category_name || "—"}</td>
                <td style={{ textAlign: "right" }}>{it.quantity}</td>
                <td style={{ textAlign: "right" }}>
                  {Number(it.amount).toLocaleString("ru-RU")} {curLabel}
                </td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>
                  {subtotal.toLocaleString("ru-RU")} {curLabel}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{ textAlign: "right", fontWeight: 600 }}>Итого по заявке:</td>
            <td style={{ textAlign: "right", fontWeight: 700, fontSize: 16 }}>
              {Number(total).toLocaleString("ru-RU")} {curLabel}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
