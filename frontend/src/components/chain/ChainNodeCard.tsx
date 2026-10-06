import { useState } from "react";
import type { ChainNode } from "../../api/chainReport";
import { Chevron, OpsList, Section, fmtMoney } from "./ChainOps";

interface Props {
  node: ChainNode;
  childrenOf: Map<number | null, ChainNode[]>;
  sym: string;
  cur: string;
  defaultOpen?: boolean;
}

function Stat({ label, value, sym, tone }: { label: string; value: number; sym: string; tone?: string }) {
  return (
    <div className="cr-stat">
      <span className="cr-stat-label">{label}</span>
      <span className={`cr-stat-value${tone ? ` ${tone}` : ""}`}>{fmtMoney(value, sym)}</span>
    </div>
  );
}

/** Узел дерева: человек → цифры → разделы (получено / расходы / передано) → дети. */
export default function ChainNodeCard({ node, childrenOf, sym, cur, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const kids = childrenOf.get(node.user_id) || [];
  const received = node.in_internal + node.in_external;
  const gave = node.out_internal + node.out_external;
  // У не-корня приход извне = свои источники: его расходы — не только деньги цепочки.
  const ownSources = node.depth > 0 && node.in_external > 0;

  return (
    <div className="cr-node" style={{ marginLeft: node.depth ? 14 : 0 }}>
      <div className={`cr-node-card${node.depth === 0 ? " root" : ""}`}>
        <button type="button" className="cr-node-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="cr-node-name">
            <Chevron open={open} />
            {node.name}
            {kids.length > 0 && <span className="muted cr-node-sub"> · выдавал(а) {kids.length}</span>}
          </span>
          <span className="cr-badges">
            {node.pending > 0 && <span className="cr-tag warn">ждёт проверки {fmtMoney(node.pending, sym)}</span>}
            {ownSources && <span className="cr-tag">свои источники {fmtMoney(node.in_external, sym)}</span>}
            {!node.check_ok && <span className="cr-tag bad">не сходится на {fmtMoney(node.check_diff, sym)}</span>}
          </span>
        </button>
        <div className="cr-stats">
          <Stat label="На начало" value={node.opening} sym={sym} />
          <Stat label="Получено" value={received} sym={sym} tone="cr-in" />
          <Stat label="Потрачено" value={node.expenses} sym={sym} tone="cr-out" />
          <Stat label="Передано" value={gave} sym={sym} />
          <Stat label="Остаток" value={node.closing} sym={sym} tone={node.closing < 0 ? "cr-out" : "cr-accent"} />
        </div>

        {open && (
          <div className="cr-node-body">
            <Section title="Получено внутри цепочки" total={node.in_internal} sym={sym}
              count={node.incoming_internal.length}>
              <OpsList rows={node.incoming_internal} sym={sym} cur={cur} sign={1} />
            </Section>
            <Section title={node.depth ? "Получено из других источников" : "Приходы"}
              total={node.in_external} sym={sym} count={node.incoming_external.length}>
              <OpsList rows={node.incoming_external} sym={sym} cur={cur} sign={1} />
            </Section>
            <Section title="Расходы по категориям" total={node.expenses} sym={sym} sign={-1}
              count={node.categories.length} defaultOpen>
              {node.categories.map((c) => (
                <Section key={c.name} title={c.name} total={c.total} sym={sym} sign={-1} count={c.count}>
                  <OpsList rows={c.rows} sym={sym} cur={cur} sign={-1} showLabel={false} />
                </Section>
              ))}
            </Section>
            <Section title="Передано внутри цепочки" total={node.out_internal} sym={sym} sign={-1}
              count={node.outgoing_internal.length}>
              <OpsList rows={node.outgoing_internal} sym={sym} cur={cur} sign={-1} />
            </Section>
            {node.outgoing_external.length > 0 && (
              <Section title="Ушло за пределы цепочки" total={node.out_external} sym={sym} sign={-1}
                count={node.outgoing_external.length}>
                <OpsList rows={node.outgoing_external} sym={sym} cur={cur} sign={-1} />
              </Section>
            )}
          </div>
        )}
      </div>
      {kids.length > 0 && (
        <div className="cr-kids">
          {kids.map((k) => (
            <ChainNodeCard key={k.user_id} node={k} childrenOf={childrenOf} sym={sym} cur={cur} />
          ))}
        </div>
      )}
    </div>
  );
}
