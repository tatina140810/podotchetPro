import { api } from "./client";

export interface CurrentRate {
  from_currency: string;
  to_currency: string;
  rate: string | null;   // null если курс ещё не задан
  date: string | null;
}

export interface ExchangeRate {
  id: number;
  org_id: number;
  from_currency: string;
  to_currency: string;
  rate: string;
  date: string;
}

export function getCurrentRate(
  from: string = "USD",
  to: string = "KGS"
): Promise<CurrentRate> {
  return api<CurrentRate>(`/api/exchange-rates/current?from=${from}&to=${to}`);
}

export function setRate(payload: {
  from_currency: string;
  to_currency: string;
  rate: number | string;
}): Promise<ExchangeRate> {
  return api<ExchangeRate>("/api/exchange-rates", { method: "POST", body: payload });
}

export function refreshFromNbkr(): Promise<ExchangeRate[]> {
  return api<ExchangeRate[]>("/api/exchange-rates/refresh-from-nbkr", { method: "POST" });
}

/** Загружает текущие курсы для нескольких валют одним пакетом. */
export async function getCurrentRates(
  pairs: { from: string; to?: string }[]
): Promise<Record<string, CurrentRate>> {
  const result: Record<string, CurrentRate> = {};
  await Promise.all(
    pairs.map(async ({ from, to = "KGS" }) => {
      result[from] = await getCurrentRate(from, to);
    })
  );
  return result;
}
