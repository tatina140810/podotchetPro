import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getCurrentRates } from "../api/exchange";

/** Валюта отображения отчётов. Тумблер в шапке: с / $ / ₽.
 *  KGS — «родная» валюта учёта: все суммы хранятся в KGS-эквиваленте (amount_kgs),
 *  остальные получаются делением на курс валюты к сому. */
export type DisplayCurrency = "KGS" | "USD" | "RUB";

const DISPLAY_CURRENCIES: DisplayCurrency[] = ["KGS", "USD", "RUB"];

/** Символы всех валют системы (не только тумблера) — для подписей сумм. */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  KGS: "с", USD: "$", EUR: "€", RUB: "₽",
};

export function currencySymbol(cur: string | null | undefined): string {
  return CURRENCY_SYMBOLS[cur || "KGS"] || cur || "с";
}

/** «KGS (с)» — подпись выбранной валюты под заголовком отчёта. */
export function currencyLabel(cur: string | null | undefined): string {
  const c = cur || "KGS";
  return `${c} (${currencySymbol(c)})`;
}

interface Ctx {
  display: DisplayCurrency;
  setDisplay: (c: DisplayCurrency) => void;
  /** Курс выбранной валюты к сому (сколько сомов за 1 единицу). Для KGS — 1. */
  rate: number | null;
  /** Курсы всех валют тумблера: { USD: 89.2, RUB: 1.07 }. */
  rates: Record<string, number | null>;
}

const STORAGE_KEY = "podotchet.displayCurrency";

const CurrencyCtx = createContext<Ctx>({
  display: "KGS", setDisplay: () => {}, rate: 1, rates: {},
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [display, setDisplayState] = useState<DisplayCurrency>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return DISPLAY_CURRENCIES.includes(saved as DisplayCurrency) ? (saved as DisplayCurrency) : "KGS";
  });
  const [rates, setRates] = useState<Record<string, number | null>>({});

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, display);
  }, [display]);

  useEffect(() => {
    // Курсы нужны всем страницам (подписи «курс X», пересчёт сумм на клиенте),
    // поэтому грузим один раз на уровне провайдера. Ошибку глотаем: без курса
    // суммы останутся в сомах, но экран не падает.
    getCurrentRates([{ from: "USD" }, { from: "RUB" }])
      .then((r) => setRates({
        USD: r.USD?.rate ? Number(r.USD.rate) : null,
        RUB: r.RUB?.rate ? Number(r.RUB.rate) : null,
      }))
      .catch(() => {});
  }, []);

  const rate = display === "KGS" ? 1 : (rates[display] ?? null);

  return (
    <CurrencyCtx.Provider value={{ display, setDisplay: setDisplayState, rate, rates }}>
      {children}
    </CurrencyCtx.Provider>
  );
}

export function useDisplayCurrency() {
  return useContext(CurrencyCtx);
}

/** Конвертирует сумму в KGS в выбранную валюту отображения и форматирует строку.
 *  Если валюта не сом, но курс не задан — fallback на KGS, чтобы цифры не пропадали. */
export function formatMoney(
  amountKgs: number,
  display: DisplayCurrency,
  rate: number | null | undefined
): string {
  if (display !== "KGS" && rate && rate > 0) {
    const value = amountKgs / rate;
    // Десятичных немного — для крупных сумм округляем до целых.
    const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
    return `${rounded.toLocaleString("ru-RU")} ${currencySymbol(display)}`;
  }
  return `${Math.round(amountKgs).toLocaleString("ru-RU")} с`;
}

/** Компактный тумблер с / $ / ₽ для шапки. */
export function CurrencyToggle() {
  const { display, setDisplay } = useDisplayCurrency();
  const btnStyle = (active: boolean, first: boolean, last: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    fontSize: 13,
    fontWeight: active ? 700 : 400,
    background: active ? "var(--accent)" : "transparent",
    color: active ? "white" : "var(--muted)",
    border: "1px solid var(--border)",
    borderLeft: first ? "1px solid var(--border)" : "none",
    borderRadius: first ? "6px 0 0 6px" : last ? "0 6px 6px 0" : "0",
    cursor: "pointer",
  });
  return (
    <div className="row" style={{ gap: 0, alignItems: "center" }} title="Валюта отчётов">
      {DISPLAY_CURRENCIES.map((c, i) => (
        <button
          key={c}
          style={btnStyle(display === c, i === 0, i === DISPLAY_CURRENCIES.length - 1)}
          onClick={() => setDisplay(c)}
        >
          {currencySymbol(c)}
        </button>
      ))}
    </div>
  );
}
