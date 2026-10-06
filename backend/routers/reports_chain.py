"""Отчёт «Цепочка расходов»: дерево выдач от выбранного человека до конечных
расходов + Excel. Расчёт — services.chain_report / chain_report_summary.

Доступ: директор/админ/аудитор — любой корень (конфиденциальные скрыты,
ограниченный аудитор — только свои сотрудники); остальные — цепочка от себя или
своего подчинённого, и в ней только видимые им подотчётные. Кто недоступен — остаётся «за пределами
цепочки»: его получение видно у выдавшего как ушедшее наружу, итоги сходятся.
"""
import io
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from auth import get_current_user, is_director_or_auditor
from database import get_db
from models import User
from services.balance import load_org_rates
from services.chain_report import build_chain
from services.chain_report_summary import summarize
from services.chain_report_xlsx import build_chain_workbook
from services.permissions import (
    auditor_visible_user_ids,
    hidden_user_ids,
    owner_isolation_ws_id,
    visible_user_ids,
    workspace_details_hidden,
    workspace_member_ids,
)
from services.plan_limits import ensure_can_export

router = APIRouter(prefix="/api/reports", tags=["reports"])

_MONEY_KEYS = {
    "opening", "in_internal", "in_external", "expenses", "out_internal",
    "out_external", "closing", "pending", "check_diff", "total", "kgs",
}


def _period(date_from: Optional[date], date_to: Optional[date]):
    start = datetime.combine(date_from, time.min) if date_from else None
    end = datetime.combine(date_to + timedelta(days=1), time.min) if date_to else None
    return start, end


def _access(db: Session, me: User, root_id: int):
    """(root, allowed(uid), hidden, mask_ws) или 403/404."""
    root = db.get(User, root_id)
    hidden = hidden_user_ids(db, me)
    if not root or root.org_id != me.org_id or root_id in hidden:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")
    if is_director_or_auditor(me):
        aud = auditor_visible_user_ids(db, me)
        if aud is not None and root_id not in aud:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")

        def allowed(uid: int) -> bool:
            return uid not in hidden and (aud is None or uid in aud)
    else:
        # Как в прежней странице цепочки: свою или своих подчинённых (supervisor_id).
        vis = set(visible_user_ids(db, me) or [me.id])
        if root_id not in vis:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к этой цепочке")

        def allowed(uid: int) -> bool:
            return uid in vis and uid not in hidden
    # Владелец проектного пространства изолирован в своё пространство (как во всех
    # отчётах): и корень, и участники цепочки — только его участники.
    iso_ws = owner_isolation_ws_id(db, me)
    if iso_ws is not None:
        members = workspace_member_ids(db, iso_ws) | {me.id}
        if root_id not in members:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")
        base_allowed = allowed

        def allowed(uid: int) -> bool:  # noqa: F811 — сужаем правило выше
            return uid in members and base_allowed(uid)
    return root, allowed, hidden, workspace_details_hidden(db, me)


def _convert(obj, rate: Optional[Decimal]):
    """Сомы → валюта отображения; Decimal → float, datetime → ISO. Исходная сумма
    операции (amount) не трогается — она в своей валюте."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in _MONEY_KEYS and isinstance(v, Decimal):
                out[k] = round(float(v / rate if rate else v), 2)
            else:
                out[k] = _convert(v, rate)
        return out
    if isinstance(obj, list):
        return [_convert(v, rate) for v in obj]
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, datetime):
        return obj.date().isoformat()
    return obj


def _build(db: Session, me: User, root_id: int, date_from, date_to, currency: str) -> dict:
    root, allowed, hidden, mask_ws = _access(db, me, root_id)
    start, end = _period(date_from, date_to)
    nodes = build_chain(db, me.org_id, root.id, start, end, allowed)
    data = summarize(db, me.org_id, nodes, start, end, hidden, mask_ws)
    rate = None
    if currency != "KGS":
        rate = load_org_rates(db, me.org_id).get(currency)
        if not rate:
            currency = "KGS"  # курса нет — честно отдаём сомы
    result = _convert(data, rate)
    result.update({
        "root_id": root.id, "root_name": root.name, "currency": currency,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
    })
    return result


@router.get("/chain")
def chain_report(
    root_id: int,
    date_from: Optional[date] = Query(default=None, alias="from"),
    date_to: Optional[date] = Query(default=None, alias="to"),
    currency: str = Query(default="KGS", pattern="^(KGS|USD|EUR|RUB)$"),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    return _build(db, me, root_id, date_from, date_to, currency)


@router.get("/chain.xlsx")
def chain_report_xlsx(
    root_id: int,
    date_from: Optional[date] = Query(default=None, alias="from"),
    date_to: Optional[date] = Query(default=None, alias="to"),
    currency: str = Query(default="KGS", pattern="^(KGS|USD|EUR|RUB)$"),
    db: Session = Depends(get_db),
    me: User = Depends(get_current_user),
):
    ensure_can_export(db, me)
    data = _build(db, me, root_id, date_from, date_to, currency)
    wb = build_chain_workbook(data)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    period = f"{data['date_from'] or 'начало'}_{data['date_to'] or 'сегодня'}"
    fname = f"Цепочка_{data['root_name']}_{period}.xlsx".replace('"', "'")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"chain_{root_id}.xlsx\"; filename*=UTF-8''{quote(fname)}"},
    )
