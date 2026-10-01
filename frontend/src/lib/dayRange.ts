/**
 * Границы дня для фильтров по дате (Тати 2026-10-01: «нужны точные выгрузки»).
 *
 * Время операций в базе хранится как местное время учёта (Asia/Bishkek), без пояса:
 * импорт истории кладёт день как 00:00. Раньше фильтры слали `new Date(d).toISOString()`
 * — это полночь по Гринвичу (= 06:00 по Бишкеку), и операции первого дня с 00:00 до
 * 05:59 выпадали из отчёта и Excel (июль Адика: потерялось всё 01.07, 116 600 ₽).
 * Теперь шлём дату как есть — «2026-07-01T00:00:00» без пояса: сервер сравнивает её
 * с тем же местным временем, и день попадает целиком.
 */
const pad = (n: number) => String(n).padStart(2, "0");

/** Начало дня `YYYY-MM-DD` без пояса. */
export function dayStart(ymd: string): string {
  return `${ymd}T00:00:00`;
}

/** Начало СЛЕДУЮЩЕГО дня — для границы «по» включительно, когда сервер ждёт «строго меньше». */
export function nextDayStart(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T00:00:00`;
}

/** Первое число месяца (month 1–12); month 13 → январь следующего года. */
export function monthStart(year: number, month: number): string {
  const t = new Date(Date.UTC(year, month - 1, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01T00:00:00`;
}
