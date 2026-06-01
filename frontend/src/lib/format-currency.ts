/**
 * Форматирование суммы с конвертацией в эквивалент.
 * rate — курс USD/KGS (сколько сом за 1 USD). null если не задан.
 *
 *   "300 000 сом  (~3 460 $)"
 *   "1 200 $  (~103 920 сом)"
 *   "150 сом" (без эквивалента, если rate=null или сумма родная не KGS/USD)
 */
export const SYMBOL: Record<string, string> = {
  KGS: "сом",
  USD: "$",
  RUB: "₽",
  EUR: "€",
};

export function formatAmountWithEquivalent(
  amount: number | string,
  currency: string,
  usdKgsRate: number | null
): string {
  const n = Number(amount);
  if (!isFinite(n)) return String(amount);
  const native = `${n.toLocaleString("ru-RU")} ${SYMBOL[currency] || currency}`;

  if (!usdKgsRate || usdKgsRate <= 0) return native;

  if (currency === "KGS") {
    const usd = n / usdKgsRate;
    return `${native}  (~${Math.round(usd).toLocaleString("ru-RU")} $)`;
  }
  if (currency === "USD") {
    const kgs = n * usdKgsRate;
    return `${native}  (~${Math.round(kgs).toLocaleString("ru-RU")} сом)`;
  }
  return native;  // RUB/EUR — без эквивалента (нет курса)
}
