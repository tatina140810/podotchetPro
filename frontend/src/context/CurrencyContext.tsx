import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type DisplayCurrency = "KGS" | "USD";

interface Ctx {
  display: DisplayCurrency;
  setDisplay: (c: DisplayCurrency) => void;
}

const STORAGE_KEY = "podotchet.displayCurrency";

const CurrencyCtx = createContext<Ctx>({ display: "KGS", setDisplay: () => {} });

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [display, setDisplayState] = useState<DisplayCurrency>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return saved === "USD" ? "USD" : "KGS";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, display);
  }, [display]);

  return (
    <CurrencyCtx.Provider value={{ display, setDisplay: setDisplayState }}>
      {children}
    </CurrencyCtx.Provider>
  );
}

export function useDisplayCurrency() {
  return useContext(CurrencyCtx);
}

/** Конвертирует сумму в KGS в выбранную валюту отображения и форматирует строку.
 *  Если выбран USD, но курс не задан — fallback на KGS, чтобы цифры не пропадали. */
export function formatMoney(
  amountKgs: number,
  display: DisplayCurrency,
  usdRate: number | null | undefined
): string {
  if (display === "USD" && usdRate && usdRate > 0) {
    const usd = amountKgs / usdRate;
    // Десятичных немного — для крупных сумм округляем до целых.
    const rounded = Math.abs(usd) >= 100 ? Math.round(usd) : Math.round(usd * 100) / 100;
    return `${rounded.toLocaleString("ru-RU")} $`;
  }
  return `${Math.round(amountKgs).toLocaleString("ru-RU")} с`;
}

/** Компактный тумблер с/$ для шапки. */
export function CurrencyToggle() {
  const { display, setDisplay } = useDisplayCurrency();
  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    fontSize: 13,
    fontWeight: active ? 700 : 400,
    background: active ? "var(--accent)" : "transparent",
    color: active ? "white" : "var(--muted)",
    border: "1px solid var(--border)",
    cursor: "pointer",
  });
  return (
    <div className="row" style={{ gap: 0, alignItems: "center" }} title="Валюта отчётов">
      <button style={{ ...btnStyle(display === "KGS"), borderRadius: "6px 0 0 6px" }} onClick={() => setDisplay("KGS")}>с</button>
      <button style={{ ...btnStyle(display === "USD"), borderLeft: "none", borderRadius: "0 6px 6px 0" }} onClick={() => setDisplay("USD")}>$</button>
    </div>
  );
}
