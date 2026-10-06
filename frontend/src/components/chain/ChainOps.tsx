import { useState, type ReactNode } from "react";
import type { ChainRow } from "../../api/chainReport";

export function fmtMoney(v: number, sym: string): string {
  const abs = Math.abs(v);
  const s = abs.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : ""}${s} ${sym}`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`cr-chevron${open ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

/** Раскрывающийся раздел: заголовок с суммой → содержимое. */
export function Section({ title, total, sym, count, children, sign = 1, defaultOpen = false }: {
  title: string;
  total: number;
  sym: string;
  count?: number;
  children: ReactNode;
  sign?: 1 | -1;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const empty = count === 0;
  return (
    <div className="cr-section">
      <button type="button" className="cr-section-head" onClick={() => !empty && setOpen(!open)}
        disabled={empty} aria-expanded={open}>
        <span className="cr-section-title">
          {!empty && <Chevron open={open} />}
          {title}
          {count !== undefined && <span className="muted"> · {count}</span>}
        </span>
        <span className={sign < 0 && total ? "cr-out" : "cr-in"}>{fmtMoney(sign * total, sym)}</span>
      </button>
      {open && !empty && <div className="cr-section-body">{children}</div>}
    </div>
  );
}

function marks(r: ChainRow): string[] {
  const out: string[] = [];
  if (r.status === "pending") out.push("ждёт проверки");
  if (r.report_hold) out.push("ждёт выпуска");
  if (r.auto) out.push("списано при выдаче");
  if (r.receipts) out.push(`чеков: ${r.receipts}`);
  return out;
}

/** Операции раздела. sign: +1 — пришло, −1 — ушло. showLabel — показывать
 *  контрагента (для выдач/приходов), для расходов внутри категории он не нужен. */
export function OpsList({ rows, sym, cur, sign, showLabel = true }: {
  rows: ChainRow[];
  sym: string;
  cur: string;  // валюта отчёта — исходную сумму показываем, только если она другая
  sign: 1 | -1;
  showLabel?: boolean;
}) {
  return (
    <div className="cr-ops">
      {rows.map((r) => {
        const foreign = r.currency !== cur;
        const tags = marks(r);
        return (
          <div className="cr-op" key={`${r.kind}-${r.ref_id}`}>
            <span className="cr-op-date muted">{fmtDate(r.date)}</span>
            <span className="cr-op-text">
              <span className="cr-op-main">
                {showLabel ? <b>{r.counterparty || r.label}</b> : null}
                {showLabel && <span className="muted"> · {r.type}</span>}
                {r.note ? <span className={showLabel ? "muted" : ""}>{showLabel ? " — " : ""}{r.note}</span> : null}
                {!showLabel && !r.note && <span className="muted">{r.type}</span>}
              </span>
              {tags.length > 0 && (
                <span className="cr-tags">
                  {tags.map((t) => <span key={t} className={`cr-tag${t === "ждёт проверки" ? " warn" : ""}`}>{t}</span>)}
                </span>
              )}
            </span>
            <span className="cr-op-sum">
              <span className={sign < 0 ? "cr-out" : "cr-in"}>{fmtMoney(sign * r.kgs, sym)}</span>
              {foreign && (
                <span className="muted cr-op-orig">
                  {r.amount.toLocaleString("ru-RU")} {r.currency}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
