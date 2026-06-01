export type CurrencyCode = "KGS" | "USD" | "EUR" | "RUB";

export const CURRENCIES: { code: CurrencyCode; label: string; symbol: string }[] = [
  { code: "KGS", label: "сом",   symbol: "с"  },
  { code: "USD", label: "$ USD", symbol: "$"  },
  { code: "EUR", label: "€ EUR", symbol: "€"  },
  { code: "RUB", label: "₽ RUB", symbol: "₽"  },
];

export const CURRENCY_SYMBOL: Record<string, string> = {
  KGS: "с", USD: "$", EUR: "€", RUB: "₽",
};

export function fmtAmount(n: string | number, currency = "KGS"): string {
  return Number(n || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) +
    " " + (CURRENCY_SYMBOL[currency] || currency);
}
