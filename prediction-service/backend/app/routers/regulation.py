from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import record
from ..db import get_db
from ..models import RegulationRule, User, utcnow
from ..schemas import ActivateIn, RegulationRuleIn, RegulationRulePatch
from ..security import approver_user, current_user
from fastapi.responses import FileResponse

from ..services.regulation_rules import REQUIRED_TO_ACTIVATE, regulation_document
from .common import row_dict

router = APIRouter(prefix="/regulation/rules", tags=["regulation"])
document_router = APIRouter(prefix="/regulation", tags=["regulation"])


@document_router.get("/document")
def document(_: User = Depends(current_user)):
    """The guideline the rules in force come from, as the authority published it."""
    details = regulation_document()
    return FileResponse(
        details["path"], media_type="application/pdf", filename="moep-magnetic-field-exposure-2020.pdf", content_disposition_type="inline"
    )


@document_router.get("/summary")
def summary(_: User = Depends(current_user)):
    details = {k: v for k, v in regulation_document().items() if k not in ("path", "file")}
    # The guideline's own table: the field allowed beside an installation, by hours of stay.
    return {**details, "allowed_by_hours": [{"hours": t, "allowed_mg": round(72 / t + 1, 1)} for t in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 18, 24)]}


def _get(db: Session, rule_id: str) -> RegulationRule:
    rule = db.get(RegulationRule, rule_id)
    if rule is None:
        raise HTTPException(404, "הכלל לא נמצא")
    return rule


@router.get("")
def list_rules(_: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(RegulationRule).order_by(RegulationRule.document_name, RegulationRule.effective_date))
    return [row_dict(row) for row in rows]


@router.post("", status_code=201)
def add_rule(body: RegulationRuleIn, user: User = Depends(approver_user), db: Session = Depends(get_db)):
    rule = RegulationRule(**body.model_dump(), active=False)
    db.add(rule)
    db.flush()
    record(db, user, None, "regulation_rule", rule.id, "created", None, body.model_dump())
    db.commit()
    return row_dict(rule)


@router.patch("/{rule_id}")
def update_rule(rule_id: str, body: RegulationRulePatch, user: User = Depends(approver_user), db: Session = Depends(get_db)):
    rule = _get(db, rule_id)
    changes = body.model_dump(exclude_unset=True, exclude={"reason"})
    substantive = set(changes) - {"notes", "superseded_at"}
    for field, value in changes.items():
        if getattr(rule, field) != value:
            record(db, user, None, "regulation_rule", rule.id, field, getattr(rule, field), value, body.reason)
            setattr(rule, field, value)
    # An edited rule is no longer the rule that was checked against its document.
    if substantive and rule.active:
        record(db, user, None, "regulation_rule", rule.id, "active", True, False, "הכלל נערך ודורש אימות מחדש")
        rule.active = False
        rule.verified_at = None
        rule.verified_by = None
    db.commit()
    return row_dict(rule)


@router.post("/{rule_id}/activation")
def set_activation(rule_id: str, body: ActivateIn, user: User = Depends(approver_user), db: Session = Depends(get_db)):
    rule = _get(db, rule_id)
    if body.active:
        missing = [field for field in REQUIRED_TO_ACTIVATE if not getattr(rule, field)]
        if rule.threshold_type == "TIME_AVERAGED" and not rule.averaging_hours:
            missing.append("averaging_hours")
        if missing:
            raise HTTPException(409, {"message": "לא ניתן להפעיל כלל בלי מקור מלא", "missing": missing})
    record(db, user, None, "regulation_rule", rule.id, "active", rule.active, body.active, body.reason)
    rule.active = body.active
    rule.verified_by = user.id if body.active else None
    rule.verified_at = utcnow() if body.active else None
    db.commit()
    return row_dict(rule)
