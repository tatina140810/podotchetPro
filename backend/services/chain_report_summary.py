"""Числа и сверка для отчёта «Цепочка расходов» (дерево строит services.chain_report).

По каждому узлу: начало + получено (внутри цепочки и извне) − расходы − передано
(внутри и наружу) = конец. «Начало/конец» — compute_current_balance, то же число,
что в карточке сотрудника; расхождение > 5 тыйын помечается check_ok=False.
"""
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from models import User
from services.balance import compute_current_balance, load_org_rates
from services.permissions import masked_workspace_category_ids
from services.chain_report import (
    CHECK_TOLERANCE,
    HIDDEN_LABEL,
    LINK_KINDS,
    WS_MASK_LABEL,
    Move,
    Node,
)


def _r(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"))


def summarize(db: Session, org_id: int, nodes: list[Node], start: Optional[datetime],
              end: Optional[datetime], hidden: set[int], mask_ws: bool) -> dict:
    """Числа по каждому узлу и по цепочке в сомах (Decimal). Конвертация в валюту
    отображения и сериализация — на стороне роутера/Excel."""
    rates = load_org_rates(db, org_id)
    # Детали пространств (категория/комментарий) скрываем у расходов И выдач;
    # суммы остаются — иначе не сойдётся сверка.
    masked_cats = masked_workspace_category_ids(db, org_id) if mask_ws else set()
    members = {n.user_id for n in nodes}
    names = {n.user_id: n.name for n in nodes}
    all_names = {u.id: u.name for u in db.query(User).filter(User.org_id == org_id).all()}

    def who(uid: Optional[int]) -> str:
        if uid is None:
            return ""
        if uid in hidden:
            return HIDDEN_LABEL
        return names.get(uid) or all_names.get(uid) or f"#{uid}"

    out_nodes = []
    chain_cats: dict[str, dict] = {}
    tot = defaultdict(Decimal)
    for n in nodes:
        uid = n.user_id
        opening = compute_current_balance(db, org_id, uid, rates, end=start) if start else Decimal(0)
        closing = compute_current_balance(db, org_id, uid, rates, end=end)
        in_int, in_ext, out_int, out_ext, exp_rows = [], [], [], [], []
        for m in n.moves:
            row = _row(m, uid, who, mask_ws, masked_cats)
            if m.kind == "expense":
                exp_rows.append(row)
            elif m.dst == uid:
                (in_int if m.src in members else in_ext).append(row)
            elif m.src == uid:
                (out_int if m.dst in members else out_ext).append(row)

        cats: dict[str, dict] = {}
        for row in exp_rows:
            c = cats.setdefault(row["label"], {"name": row["label"], "total": Decimal(0), "count": 0, "rows": []})
            c["total"] += row["kgs"]
            c["count"] += 1
            c["rows"].append(row)
            cc = chain_cats.setdefault(row["label"], {"name": row["label"], "total": Decimal(0), "count": 0})
            cc["total"] += row["kgs"]
            cc["count"] += 1
        s = lambda rows: sum((r["kgs"] for r in rows), Decimal(0))
        nums = {
            "opening": opening, "in_internal": s(in_int), "in_external": s(in_ext),
            "expenses": s(exp_rows), "out_internal": s(out_int), "out_external": s(out_ext),
            "closing": closing,
        }
        diff = (nums["opening"] + nums["in_internal"] + nums["in_external"] - nums["expenses"]
                - nums["out_internal"] - nums["out_external"] - nums["closing"])
        for k, v in nums.items():
            tot[k] += v
        out_nodes.append({
            "user_id": uid, "name": n.name, "parent_id": n.parent_id, "depth": n.depth,
            **{k: _r(v) for k, v in nums.items()},
            "pending": _r(sum((r["kgs"] for r in exp_rows if r["status"] == "pending"), Decimal(0))),
            "check_diff": _r(diff), "check_ok": abs(diff) <= CHECK_TOLERANCE,
            "incoming_internal": _sorted(in_int), "incoming_external": _sorted(in_ext),
            "outgoing_internal": _sorted(out_int), "outgoing_external": _sorted(out_ext),
            "categories": sorted(
                ({**c, "total": _r(c["total"]), "rows": _sorted(c["rows"])} for c in cats.values()),
                key=lambda c: -c["total"],
            ),
        })

    chain_diff = (tot["opening"] + tot["in_external"] - tot["expenses"]
                  - tot["out_external"] - tot["closing"])
    internal_gap = tot["in_internal"] - tot["out_internal"]  # всегда 0 — контроль
    totals = {k: _r(v) for k, v in tot.items()}
    totals.update({
        "check_diff": _r(chain_diff),
        "check_ok": abs(chain_diff) <= CHECK_TOLERANCE * max(1, len(nodes))
        and abs(internal_gap) <= CHECK_TOLERANCE
        and all(n["check_ok"] for n in out_nodes),
        "people": len(out_nodes),
    })
    categories = sorted(
        ({**c, "total": _r(c["total"])} for c in chain_cats.values()), key=lambda c: -c["total"]
    )
    return {"nodes": out_nodes, "totals": totals, "categories": categories}


_KIND_IN = {"topup": "Выдача", "transfer": "Перевод", "request": "Заявка",
            "income": "Приход", "supplier_refund": "Возврат от поставщика"}
_KIND_OUT = {"topup": "Выдал", "transfer": "Перевёл", "request": "Выдал по заявке",
             "supplier_deposit": "Аванс поставщику", "expense": "Расход"}


def _row(m: Move, uid: int, who, mask_ws: bool, masked_cats: set) -> dict:
    incoming = m.dst == uid and m.kind != "expense"
    masked = mask_ws and (m.workspace_id is not None or m.category_id in masked_cats)
    if m.kind == "expense":
        counterparty = WS_MASK_LABEL if masked else m.label
    elif m.kind in LINK_KINDS:
        counterparty = who(m.src if incoming else m.dst)
    else:
        counterparty = m.label or ""
    return {
        "kind": m.kind,
        "type": (_KIND_IN if incoming else _KIND_OUT).get(m.kind, m.kind),
        "ref_id": m.ref_id,
        "date": m.date,
        "amount": _r(m.amount),
        "currency": m.currency or "KGS",
        "kgs": m.kgs,
        "counterparty": counterparty,
        "counterparty_id": (m.src if incoming else m.dst) if m.kind in LINK_KINDS else None,
        "label": WS_MASK_LABEL if masked else (m.label or "Без категории"),
        "note": None if masked else m.note,
        "status": m.status,
        "report_hold": m.report_hold,
        "auto": m.auto,
        "receipts": m.receipts,
    }


def _sorted(rows: list[dict]) -> list[dict]:
    return [{**r, "kgs": _r(r["kgs"])} for r in sorted(rows, key=lambda r: r["date"])]
