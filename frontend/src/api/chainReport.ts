import { api, downloadFile } from "./client";

/** Операция в узле цепочки. kgs — сумма в валюте отчёта (имя поля историческое),
 *  amount/currency — исходная сумма операции. */
export interface ChainRow {
  kind: string;
  type: string;
  ref_id: number;
  date: string;
  amount: number;
  currency: string;
  kgs: number;
  counterparty: string | null;
  counterparty_id: number | null;
  label: string;
  note: string | null;
  status: string | null;
  report_hold: boolean;
  auto: boolean;
  receipts: number;
}

export interface ChainCategory {
  name: string;
  total: number;
  count: number;
  rows: ChainRow[];
}

export interface ChainNode {
  user_id: number;
  name: string;
  parent_id: number | null;
  depth: number;
  opening: number;
  in_internal: number;
  in_external: number;
  expenses: number;
  out_internal: number;
  out_external: number;
  closing: number;
  pending: number;
  check_diff: number;
  check_ok: boolean;
  incoming_internal: ChainRow[];
  incoming_external: ChainRow[];
  outgoing_internal: ChainRow[];
  outgoing_external: ChainRow[];
  categories: ChainCategory[];
}

export interface ChainTotals {
  opening: number;
  in_internal: number;
  in_external: number;
  expenses: number;
  out_internal: number;
  out_external: number;
  closing: number;
  check_diff: number;
  check_ok: boolean;
  people: number;
}

export interface ChainReport {
  root_id: number;
  root_name: string;
  currency: string;
  date_from: string | null;
  date_to: string | null;
  nodes: ChainNode[];
  totals: ChainTotals;
  categories: { name: string; total: number; count: number }[];
}

export interface ChainParams {
  rootId: number;
  from: string | null;
  to: string | null;
  currency: string;
}

function query(p: ChainParams): string {
  const q = new URLSearchParams({ root_id: String(p.rootId), currency: p.currency });
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  return q.toString();
}

export function getChainReport(p: ChainParams): Promise<ChainReport> {
  return api<ChainReport>(`/api/reports/chain?${query(p)}`);
}

export function downloadChainXlsx(p: ChainParams): Promise<void> {
  return downloadFile(`/api/reports/chain.xlsx?${query(p)}`, `chain_${p.rootId}.xlsx`);
}
