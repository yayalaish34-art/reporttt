"""The CRM's customers and their contacts, for the project form.

Read live from the CRM's own database, the same tables the reports system reads. Nothing
is written there. A CRM that cannot be reached returns an empty list, so the form still
works with the details typed in by hand.
"""

import logging
import re

import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, Depends, HTTPException, Query

from ..config import settings
from ..models import User
from ..security import current_user

router = APIRouter(prefix="/crm", tags=["crm"])
log = logging.getLogger(__name__)

# The CRM types that mean "an organisation", and so get a company line. POTENTIAL, the
# bucket for unclassified leads, is mostly homeowners and goes to the person side.
COMPANY_TYPES = {"COMPANY", "SUPPLIER", "PUBLIC"}
# The CRM's legacy import invented an address for every record that had none.
PLACEHOLDER_EMAIL = re.compile(r"@legacy\.import\.local$", re.IGNORECASE)
COLUMNS = 'id, name, "contactName", type, address, city, phone, email, "updatedAt"'


def _clean(value) -> str:
    return str(value or "").strip()


def _customer(row: dict) -> dict:
    """One CRM row as the recipient lines need it, the way the reports system reads it."""
    name = _clean(row["name"])
    contact = _clean(row["contactName"]) or name
    # A "company" whose contact is spelled like the company is a sole trader: a person.
    is_company = _clean(row["type"]).upper() in COMPANY_TYPES and contact != name
    address, city = _clean(row["address"]), _clean(row["city"])
    email = _clean(row["email"])
    return {
        "id": str(row["id"]),
        "kind": "company" if is_company else "private",
        "contactName": contact if is_company else name,
        "contactTitle": "",
        "companyName": name if is_company else "",
        "addressLine": "" if address == city else address,
        "city": city,
        "phone": _clean(row["phone"]),
        "email": "" if PLACEHOLDER_EMAIL.search(email) else email,
        "updatedAt": row["updatedAt"].isoformat() if row.get("updatedAt") else "",
    }


def _query(sql: str, params: tuple) -> list[dict]:
    if not settings.crm_database_url:
        return []
    try:
        # The CRM sits behind a transaction pooler, which cannot hold prepared statements.
        with psycopg.connect(settings.crm_database_url, connect_timeout=10, prepare_threshold=None) as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(sql, params)
                return cursor.fetchall()
    except psycopg.Error as error:
        log.warning("CRM query failed: %s", error)
        return []


@router.get("/customers")
def search(q: str = "", limit: int = Query(15, ge=1, le=50), _: User = Depends(current_user)):
    """By any of the names, the city or the contact details; a name that starts with the
    query ranks above one that only contains it."""
    text = q.strip()
    if not text:
        rows = _query(f'SELECT {COLUMNS} FROM "Customer" WHERE COALESCE(TRIM(name), \'\') <> \'\' ORDER BY "updatedAt" DESC NULLS LAST LIMIT %s', (limit,))
        return [_customer(row) for row in rows]
    pattern = "%" + re.sub(r"([%_\\])", r"\\\1", text) + "%"
    prefix = re.sub(r"([%_\\])", r"\\\1", text) + "%"
    rows = _query(
        f"""SELECT {COLUMNS} FROM "Customer"
             WHERE COALESCE(TRIM(name), '') <> ''
               AND (name ILIKE %s OR "contactName" ILIKE %s OR city ILIKE %s OR phone ILIKE %s OR email ILIKE %s)
             ORDER BY CASE WHEN name ILIKE %s OR "contactName" ILIKE %s THEN 0 ELSE 1 END,
                      "updatedAt" DESC NULLS LAST
             LIMIT %s""",
        (pattern, pattern, pattern, pattern, pattern, prefix, prefix, limit),
    )
    return [_customer(row) for row in rows]


@router.get("/customers/{customer_id}")
def customer(customer_id: str, _: User = Depends(current_user)):
    rows = _query(f'SELECT {COLUMNS} FROM "Customer" WHERE id = %s', (customer_id,))
    if not rows:
        raise HTTPException(404, "הלקוח לא נמצא ב-CRM")
    return _customer(rows[0])


@router.get("/customers/{customer_id}/contacts")
def contacts(customer_id: str, _: User = Depends(current_user)):
    rows = _query(
        """SELECT id, "fullName", COALESCE("roleTitle", '') AS "roleTitle",
                  COALESCE(NULLIF(mobile, ''), phone) AS phone, email, "isPrimary"
             FROM "CustomerContact"
            WHERE "customerId" = %s AND "isActive" = true AND COALESCE(TRIM("fullName"), '') <> ''
            ORDER BY "isPrimary" DESC, "fullName" ASC""",
        (customer_id,),
    )
    return [
        {
            "id": str(row["id"]),
            "fullName": _clean(row["fullName"]),
            "roleTitle": _clean(row["roleTitle"]),
            "phone": _clean(row["phone"]),
            "email": _clean(row["email"]),
            "isPrimary": row["isPrimary"] is True,
        }
        for row in rows
    ]
