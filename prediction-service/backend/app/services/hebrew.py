"""Hebrew for every term the system stores in English, so the report reads in one language."""

SOURCE_TYPES = {
    "THREE_PHASE_CABLE": "קו הזנה תלת-פאזי",
    "CABLE_BUNDLE": "צרור כבלים",
    "CABLE_TRAY": "תעלת כבלים",
    "RISER": "פיר הזנה",
    "ELECTRICAL_SHAFT": "פיר חשמל",
    "BUSBAR": "פס צבירה",
    "TRANSFORMER": "שנאי",
    "LV_BOARD": "לוח מונים",
    "MAIN_DISTRIBUTION_BOARD": "לוח חלוקה ראשי",
    "GENERATOR": "גנרטור",
    "UPS": "אל-פסק",
    "INVERTER": "ממיר",
    "EV_CHARGING": "לוח טעינת רכבים",
    "PV_INFRASTRUCTURE": "מערכת סולארית",
}
MODELS = {
    "TRANSFORMER_EMPIRICAL": "שנאי, עקומת ייחוס",
    "TRANSFORMER_MANUFACTURER_DATA": "שנאי, נתוני יצרן",
    "TRANSFORMER_MEASURED_REFERENCE": "שנאי, מדידת ייחוס",
    "PANEL_EMPIRICAL": "לוח, עקומת ייחוס",
    "PANEL_MANUFACTURER_DATA": "לוח, נתוני יצרן",
    "PANEL_MEASURED_REFERENCE": "לוח, מדידת ייחוס",
    "PANEL_CONSERVATIVE_APPROXIMATION": "לוח, קירוב שמרני",
    "THREE_PHASE": "מעגל תלת-פאזי (ביו-סבר)",
    "BUSBAR": "פס צבירה (ביו-סבר)",
}
ARRANGEMENTS = {"TREFOIL": "משולש", "FLAT_HORIZONTAL": "שטוח אופקי", "FLAT_VERTICAL": "שטוח אנכי"}
CURRENT_BASES = {"RATED": "נקוב", "DESIGN": "תכנוני", "MEASURED": "נמדד", "ESTIMATED": "מוערך"}
DOCUMENT_TYPES = {
    "ARCHITECTURAL": "גרמושקה",
    "ELECTRICAL": "תוכנית חשמל",
    "SINGLE_LINE": "סכמה חד-קווית",
    "TRANSFORMER_ROOM": "חדר שנאים",
    "CABLE_LAYOUT": "תוואי כבלים",
    "SITE_PLAN": "תוכנית מגרש",
    "OTHER": "אחר",
}
BUILDING_TYPES = {
    "Residential": "מגורים",
    "Office": "משרדים",
    "Commercial": "מסחר",
    "Hospital": "בית חולים",
    "School": "בית ספר",
    "Kindergarten": "גן ילדים",
    "Industrial": "תעשייה",
    "Hotel": "מלון",
    "Mixed use": "שימוש מעורב",
    "Other": "אחר",
}
STATUSES = {
    "PASS": "עומד בכלל",
    "FAIL": "חורג מהכלל",
    "REGULATION_REVIEW_REQUIRED": "נדרשת בדיקה רגולטורית",
    "MISSING_DATA": "חסר נתון",
    "ENGINEERING_ASSUMPTION": "הנחה הנדסית",
}
COMBINATIONS = {
    "RSS_BETWEEN_GROUPS": "שורש סכום הריבועים בין קבוצות",
    "ARITHMETIC": "חיבור אריתמטי (חסם עליון)",
}
USES = {
    "PARKING": "חניון",
    "RESIDENTIAL": "מגורים",
    "OFFICE": "משרדים",
    "COMMERCIAL": "מסחר",
    "PUBLIC": "ציבורי",
    "TECHNICAL": "טכני",
    "MIXED": "מעורב",
}


def he(table: dict, value) -> str:
    """The Hebrew for a stored value, or the value itself when it is free text."""
    if value is None:
        return ""
    return table.get(value, str(value))
