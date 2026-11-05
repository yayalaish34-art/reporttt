"""The Hebrew PDF report. It reports stored results and calculates nothing."""

import io
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

from bidi import get_display
from PIL import Image as PilImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import storage
from ..models import (
    CalculationResult,
    CalculationRun,
    Document,
    ElectricalSource,
    Floor,
    Project,
    Recommendation,
    ReportVersion,
    Room,
    User,
)
from .calculation import floor_points
from .hebrew import ARRANGEMENTS, BUILDING_TYPES, COMBINATIONS, CURRENT_BASES, DOCUMENT_TYPES, MODELS, SOURCE_TYPES, STATUSES, USES, he
from .source_model import is_line
from .visualization import BANDS, draw_heatmap, render_page_png

FONTS = Path(__file__).resolve().parents[2] / "assets" / "fonts"
pdfmetrics.registerFont(TTFont("Arimo", str(FONTS / "Arimo-Regular.ttf")))
pdfmetrics.registerFont(TTFont("Arimo-Bold", str(FONTS / "Arimo-Bold.ttf")))

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 2 * cm
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN
BRAND = colors.HexColor("#14532d")

BODY = ParagraphStyle("body", fontName="Arimo", fontSize=10.5, leading=15, alignment=TA_RIGHT)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=8.5, leading=11)
CELL_HEAD = ParagraphStyle("cellHead", parent=SMALL, fontName="Arimo-Bold", textColor=colors.white)
H1 = ParagraphStyle("h1", parent=BODY, fontName="Arimo-Bold", fontSize=14, leading=19, textColor=BRAND, spaceBefore=12, spaceAfter=6)
H2 = ParagraphStyle("h2", parent=BODY, fontName="Arimo-Bold", fontSize=11, leading=15, spaceBefore=6, spaceAfter=3)
TITLE = ParagraphStyle("title", parent=H1, fontSize=24, leading=30, alignment=TA_CENTER)
CENTER = ParagraphStyle("center", parent=BODY, alignment=TA_CENTER, fontSize=12, leading=18)

STATUS_LABELS = {
    "PASS": "עומד בכלל",
    "FAIL": "חורג מהכלל",
    "REGULATION_REVIEW_REQUIRED": "נדרשת בדיקה רגולטורית",
}
OCCUPANCY_LABELS = {
    "CONTINUOUS_OCCUPANCY": "שהייה ממושכת",
    "NON_CONTINUOUS_OCCUPANCY": "שהייה לא ממושכת",
    "UNKNOWN": "לא ידוע",
}
REPORT_STATUS_LABELS = {"DRAFT": "טיוטה", "UNDER_REVIEW": "בבדיקה", "APPROVED": "מאושר", "ISSUED": "הונפק"}
INSTRUMENT_LABELS = {
    "LAW": "חוק",
    "REGULATION": "תקנות",
    "PROCEDURE": "נוהל",
    "PERMIT": "היתר",
    "RECOMMENDATION": "המלצה",
    "GUIDELINE": "קו מנחה",
}

METHOD_PARAGRAPHS = [
    "השדה המגנטי חושב במנוע פיזיקלי דטרמיניסטי, ללא שימוש במודל שפה. כל מוליך מיוצג כמקטעים ישרים סופיים, והתרומה של כל מקטע מחושבת בצורה סגורה של חוק ביו-סבר.",
    "כל זרם מיוצג כפאזור, בהתחשב בזווית הפאזה של L1, L2 ו-L3. בתוך קבוצה בעלת קשר פאזה ידוע התרומות מחוברות וקטורית כפאזורים. התוצאה היא ערך ה-RMS השקול, שורש סכום ריבועי שלושת הרכיבים.",
    "בין קבוצות ללא קשר פאזה ידוע השילוב הוא שורש סכום הריבועים (RSS). התרחישים השמרניים משתמשים בחיבור אריתמטי, שהוא חסם עליון.",
    "שנאים ולוחות אינם מחושבים מעקרונות ראשונים. הם מיוצגים כתיבה בתוספת עקומת ייחוס שהוזנה, כשהשדה פרופורציוני לזרם והמרחק נמדד מפני התיבה.",
    "כל מקור ונקודת חישוב מוגדרים בקואורדינטות X, Y, Z, ולכן נלקחים בחשבון מקורות באותה קומה, בקומה מעל ובקומה מתחת.",
]
LIMITATIONS = [
    "המודל מניח תווך לא מגנטי. ברזל מבני, גופי פלדה ומיגון קיים אינם מומדלים, אלא אם צוין אחרת.",
    "ההרמוניות של הזרם אינן מומדלות. החישוב מתייחס לתדר 50 Hz סינוסי.",
    "השדה של שנאי ולוח נקבע לפי נתוני הייחוס שהוזנו בלבד, ודיוקו תלוי בהם.",
    "דיוק הגאומטריה תלוי בדיוק התוכניות, בכיול ובהצבה הידנית של המקורות.",
    "הערכת החשיפה מתבצעת מול הערך המרבי ברשת החישוב בכל חדר, ולא מול עמדה ספציפית.",
    "מנוע החישוב נבדק מול פתרונות אנליטיים. נכון לגרסה זו טרם הושלמה השוואה מתועדת למדידות שטח או לתוכנות חיזוי אחרות.",
    "החיזוי אינו מחליף מדידה לאחר הקמה.",
]


_BRACKETS = {")": "(", "]": "[", "}": "{"}
_OPENING = {opening: closing for closing, opening in _BRACKETS.items()}


def mirror_inverted_brackets(visual: str) -> str:
    """python-bidi reorders a pair inside right-to-left text without mirroring it.

    "(mG)" comes back as ")mG(". A closing bracket with nothing open before it can only
    be such an inverted pair, so it and its partner are swapped. Pairs inside
    left-to-right runs, like f(x), are already correct and stay as they are.
    """
    characters = list(visual)
    normal: list[str] = []
    inverted: list[int] = []
    for index, character in enumerate(characters):
        if character in _BRACKETS:
            if normal and normal[-1] == _BRACKETS[character]:
                normal.pop()
            else:
                inverted.append(index)
        elif character in _OPENING:
            if inverted and characters[inverted[-1]] == _OPENING[character]:
                start = inverted.pop()
                characters[start], characters[index] = character, characters[start]
            else:
                normal.append(character)
    return "".join(characters)


def _visual(text: str) -> str:
    return escape(mirror_inverted_brackets(get_display(text)))


def _split_long_word(word: str, font: str, size: float, width: float) -> list[str]:
    """Breaks an identifier at its underscores, rather than wherever ReportLab would."""
    if pdfmetrics.stringWidth(word, font, size) <= width or "_" not in word:
        return [word]
    parts, current = [], ""
    for piece in word.replace("_", "_\n").split("\n"):
        if current and pdfmetrics.stringWidth(current + piece, font, size) > width:
            parts.append(current)
            current = piece
        else:
            current += piece
    return parts + [current]


def _wrap(text: str, font: str, size: float, width: float) -> list[str]:
    lines = []
    for block in str(text).split("\n"):
        current = ""
        words = [part for word in block.split() for part in _split_long_word(word, font, size, width)]
        for word in words:
            candidate = f"{current} {word}".strip()
            if current and pdfmetrics.stringWidth(candidate, font, size) > width:
                lines.append(current)
                current = word
            else:
                current = candidate
        lines.append(current)
    return lines


def rtl(text, style=BODY, width: float = CONTENT_WIDTH) -> Paragraph:
    """Wraps in logical order, then reorders each line: bidi works per line, not per block."""
    # A hair narrower than the frame so ReportLab never re-wraps an already visual line.
    lines = _wrap(text, style.fontName, style.fontSize, width - 2)
    return Paragraph("<br/>".join(_visual(line) for line in lines), style)


def _num(value, digits: int = 2) -> str:
    return f"{value:.{digits}f}" if value is not None else "חסר נתון"


def _table(headers: list[str], rows: list[list], widths: list[float], flags: list | None = None) -> Table:
    """First column sits at the right. Widths are fractions of the content width."""
    actual = [fraction * CONTENT_WIDTH for fraction in widths]
    data = [[rtl(h, CELL_HEAD, w - 8) for h, w in zip(headers, actual)][::-1]]
    for row in rows:
        data.append([rtl(cell if cell is not None else "—", SMALL, w - 8) for cell, w in zip(row, actual)][::-1])
    table = Table(data, colWidths=actual[::-1], repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), BRAND),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9ca3af")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    table.setStyle(TableStyle(style + (flags or [])))
    return table


def _key_values(pairs: list[tuple[str, str]]) -> Table:
    return _table(["שדה", "ערך"], [[k, v or "—"] for k, v in pairs], [0.3, 0.7])


def _bullets(items: list[str]) -> list:
    return [rtl(f"• {item}") for item in items]


def _legend() -> Table:
    swatches = [[Paragraph(escape(band["label"]), ParagraphStyle("legend", parent=SMALL, alignment=TA_CENTER)) for band in BANDS]]
    table = Table(swatches, colWidths=[CONTENT_WIDTH / len(BANDS)] * len(BANDS))
    table.setStyle(
        TableStyle([("BACKGROUND", (i, 0), (i, 0), colors.HexColor(band["color"])) for i, band in enumerate(BANDS)])
    )
    return table


def _heatmaps(db: Session, project: Project, run: CalculationRun) -> list:
    story = []
    floors = list(db.scalars(select(Floor).where(Floor.project_id == project.id).order_by(Floor.sort_order)))
    rooms = list(db.scalars(select(Room).where(Room.project_id == project.id)))
    sources = list(db.scalars(select(ElectricalSource).where(ElectricalSource.project_id == project.id)))
    for floor in floors:
        for height in run.heights_m:
            points = floor_points(db, run.id, floor.id, height)
            if not points:
                continue
            title = f"{floor.name}, גובה חישוב {height:g} מ׳"
            document = db.get(Document, floor.plan_document_id) if floor.plan_document_id else None
            if document is None or floor.scale_m_per_px is None or not floor.origin_px:
                story += [rtl(title, H2), rtl("לקומה זו אין תוכנית מכוילת, ולכן אין תצוגה על גבי תוכנית.")]
                continue
            with storage.local_copy(render_page_png(document, floor.plan_page)) as plan:
                image = draw_heatmap(
                    plan,
                    floor.scale_m_per_px,
                    floor.origin_px,
                    run.grid_step_m,
                    points,
                    [{"polygon_m": r.polygon_m, "holes_m": r.holes_m} for r in rooms if r.floor_id == floor.id],
                    [
                        {"tag": s.tag, "points": s.geometry["points"], "is_box": not is_line(s.source_type)}
                        for s in sources
                        if s.floor_id == floor.id and len(s.geometry.get("points") or []) >= 2
                    ],
                )
            image.thumbnail((1800, 1800), PilImage.LANCZOS)
            buffer = io.BytesIO()
            # A scanned A0 sheet as PNG runs to megabytes a page; JPEG keeps the report small.
            image.convert("RGB").save(buffer, "JPEG", quality=82, optimize=True)
            buffer.seek(0)
            scale = min(CONTENT_WIDTH / image.width, 16 * cm / image.height)
            story.append(
                KeepTogether(
                    [
                        rtl(title, H2),
                        Image(buffer, width=image.width * scale, height=image.height * scale),
                        Spacer(1, 4),
                        _legend(),
                        rtl("ערכים ב-mG. טווחי הצבעים לתצוגה בלבד, ואינם מעידים על סטטוס רגולטורי.", SMALL),
                        Spacer(1, 8),
                    ]
                )
            )
    return story


def build_report_pdf(
    db: Session,
    project: Project,
    run: CalculationRun,
    comparison: CalculationRun | None,
    report: ReportVersion,
) -> bytes:
    snapshot = run.input_snapshot
    results = list(
        db.scalars(
            select(CalculationResult)
            .where(CalculationResult.run_id == run.id)
            .order_by(CalculationResult.floor_name, CalculationResult.room_name, CalculationResult.height_m)
        )
    )
    recommendations = list(db.scalars(select(Recommendation).where(Recommendation.run_id == run.id)))
    approver = db.get(User, report.approved_by) if report.approved_by else None
    records = {record["tag"]: record for record in snapshot["source_records"]}
    worst = max((r.max_mg for r in results if r.max_mg is not None), default=None)
    failing = [r for r in results if r.status == "FAIL"]
    review = [r for r in results if r.status == "REGULATION_REVIEW_REQUIRED"]
    final_view = report.is_final and report.status in ("APPROVED", "ISSUED")

    story = [Spacer(1, 3 * cm), rtl("גלית – החברה לאיכות הסביבה", CENTER), Spacer(1, 14), rtl("דוח חיזוי שדות מגנטיים", TITLE)]
    # 1. Cover
    story += [
        rtl("ELF, 50 Hz", CENTER),
        Spacer(1, 1 * cm),
        rtl(project.project_name, CENTER),
        rtl(project.address, CENTER),
        Spacer(1, 1 * cm),
        rtl(f"גרסה {report.version} | סטטוס: {REPORT_STATUS_LABELS[report.status]}", CENTER),
        rtl(f"תאריך הפקה: {date.today().strftime('%d/%m/%Y')}", CENTER),
    ]
    if approver:
        story.append(rtl(f"אושר על ידי: {approver.full_name or approver.email}", CENTER))
    if report.blockers:
        story += [Spacer(1, 1 * cm), rtl("לא ניתן להנפיק דוח חיזוי סופי. מידע חסר:", H2)]
        story += _bullets([item["message"] for item in report.blockers][:25])
    story.append(PageBreak())

    # 2-3
    story += [
        rtl("1. פרטי המזמין", H1),
        _key_values(
            [
                ("לקוח", project.client_name),
                ("מזמין העבודה", project.ordered_by),
                ("טלפון", project.contact_phone),
                ("דוא״ל", project.contact_email),
            ]
        ),
        rtl("2. פרטי הפרויקט", H1),
        _key_values(
            [
                ("שם הפרויקט", project.project_name),
                ("מספר פרויקט", project.project_number),
                ("כתובת", project.address),
                ("סוג מבנה", he(BUILDING_TYPES, project.building_type)),
                ("מהנדס חשמל", project.electrical_engineer),
                ("אדריכל", project.architect),
                ("תאריך", project.project_date.strftime("%d/%m/%Y") if project.project_date else ""),
            ]
        ),
        # 4
        rtl("3. מטרת החיזוי", H1),
        rtl("מטרת הדוח היא לחזות את השדה המגנטי בתדר רשת החשמל בחללי המבנה, ולזהות אזורים הדורשים טיפול לפני הקמה או אכלוס."),
    ]

    # 5
    story += [rtl("4. מסמכים שהתקבלו", H1)]
    documents = snapshot["documents"]
    story.append(
        _table(["קובץ", "סוג", "גרסה"], [[d["file_name"], he(DOCUMENT_TYPES, d["document_type"]), d["revision"]] for d in documents], [0.6, 0.25, 0.15])
        if documents
        else rtl("לא הועלו מסמכים.")
    )

    # 6
    floors = snapshot["floors"]
    story += [
        rtl("5. תיאור המבנה", H1),
        rtl(project.description or "לא הוזן תיאור."),
        Spacer(1, 4),
        _table(
            ["קומה", "גובה מפלס (מ׳)"],
            [[f["name"], _num(f["elevation_m"])] for f in floors],
            [0.6, 0.4],
        ),
    ]

    # 7-8
    source_rows = []
    design_rows = []
    for source in snapshot["sources"]:
        record = records.get(source["id"], {})
        model = he(MODELS, source.get("model_type") or source["kind"])
        source_rows.append([source["id"], he(SOURCE_TYPES, record.get("source_type")), model])
        spacing = source.get("spacing_m")
        design_rows.append(
            [
                source["id"],
                _num(record.get("current_a")),
                he(CURRENT_BASES, record.get("current_basis")) or "חסר נתון",
                _num(record.get("load_factor")) if record.get("load_factor") is not None else "לא הוחל",
                he(ARRANGEMENTS, source.get("arrangement")) or "—",
                _num(spacing) if spacing is not None else "—",
            ]
        )
    story += [
        rtl("6. מקורות הקרינה", H1),
        _table(["תג", "סוג", "מודל חישוב"], source_rows, [0.2, 0.35, 0.45]),
    ]
    if run.excluded_sources:
        story += [Spacer(1, 4), rtl("מקורות שלא נכללו בחישוב:", H2)]
        story += _bullets([f"{e['tag']}: {e['reason']}" for e in run.excluded_sources])
    story += [
        rtl("7. נתוני התכנון", H1),
        _table(["תג", "זרם (A)", "בסיס", "מקדם עומס", "סידור", "מרווח (מ׳)"], design_rows, [0.16, 0.14, 0.2, 0.14, 0.22, 0.14]),
    ]

    # 9
    story += [rtl("8. הנחות", H1)]
    assumptions = snapshot["assumptions"]
    if assumptions:
        story.append(
            _table(
                ["סטטוס", "הנחה", "נימוק"],
                [[he(STATUSES, a["status"]), a["statement"], a["justification"]] for a in assumptions],
                [0.28, 0.36, 0.36],
            )
        )
    else:
        story.append(rtl("לא נרשמו הנחות הנדסיות."))

    # 10
    scenario = snapshot["scenario"]
    story += [rtl("9. שיטת החישוב", H1)]
    story += [rtl(text) for text in METHOD_PARAGRAPHS]
    story += [
        Spacer(1, 4),
        _key_values(
            [
                ("תרחיש", scenario["name"]),
                ("מקדם זרם בתרחיש", f"{scenario['current_factor']:g}"),
                ("צעד רשת", f"{run.grid_step_m:g} מ׳"),
                ("גובהי חישוב", ", ".join(f"{h:g}" for h in run.heights_m) + " מ׳"),
                ("שיטת שילוב", he(COMBINATIONS, run.combination_method)),
                ("גרסת מנוע", run.engine_version),
                ("חתימת קלט", run.input_hash[:24]),
            ]
        ),
    ]

    # 11
    story += [rtl("10. קריטריונים והמלצות רגולטוריות", H1)]
    rules = snapshot["regulation_rules"]
    if rules:
        story.append(
            _table(
                ["מסמך", "סוג מסמך", "גרסה", "תחילה", "סף", "מקור"],
                [
                    [
                        r["document_name"],
                        INSTRUMENT_LABELS.get(r["instrument_type"], r["instrument_type"]),
                        r["document_version"],
                        r["effective_date"],
                        f"{r['threshold']:g} {r['threshold_unit']}",
                        r["source_url"],
                    ]
                    for r in rules
                ],
                [0.26, 0.11, 0.09, 0.13, 0.11, 0.3],
            )
        )
    else:
        story.append(rtl("לא הוזן כלל רגולטורי מאומת ותקף. לכן לא נקבע סטטוס רגולטורי, וכל התוצאות מסומנות כנדרשות בדיקה רגולטורית."))
    if any(r.get("background_mg") for r in rules):
        story += [
            Spacer(1, 4),
            rtl(
                "לפי ההנחיה, החשיפה הממוצעת ביממה עם צריכת חשמל טיפוסית מרבית חייבת להיות נמוכה מ-4 mG, כשבשאר שעות היממה "
                "החשיפה היא 1 mG. לכן השדה המותר סמוך למתקן חשמל בשהייה של T שעות ביממה הוא 72/T + 1. "
                "החישוב בדוח נעשה בזרם האופייני (60% מהזרם המרבי), כפי שההנחיה קובעת. שעות השהייה לפי סוג החלל: "
                "בדירה 24 שעות, במשרד או בחנות 9 שעות, במסדרון, לובי, חדר מדרגות, מעלית, חניה ומחסן שעה אחת, "
                "ובפיר, בחדר טכני ובסביבת ציוד חשמלי אין שהייה."
            ),
            Spacer(1, 4),
            _table(
                ["שעות שהייה ביממה", *[str(t) for t in (1, 2, 3, 4, 5, 6, 8, 10, 12, 18, 24)]],
                [["שדה מותר (mG)", *[f"{72 / t + 1:.3g}" for t in (1, 2, 3, 4, 5, 6, 8, 10, 12, 18, 24)]]],
                [0.2] + [0.8 / 11] * 11,
            ),
        ]

    # 12-13: a floor holds dozens of rooms, so per floor first, then the highest values.
    per_room = _worst_per_room(results)
    continuous = [r for r in per_room if r.occupancy_classification == "CONTINUOUS_OCCUPANCY"]
    passing_through = [r for r in per_room if r.occupancy_classification != "CONTINUOUS_OCCUPANCY"]
    floor_order = [f["name"] for f in sorted(floors, key=lambda f: f["elevation_m"] if f["elevation_m"] is not None else 0)]
    story += [
        rtl("11. סיווג אזורי שהייה", H1),
        rtl("בתוך דירה, משרד או חנות השהייה ממושכת. מסדרון, לובי, חדר מדרגות, מעלית, פיר, מחסן, חדר טכני וחניה: שהייה לא ממושכת."),
        Spacer(1, 4),
        _table(
            ["קומה", "חללי שהייה ממושכת", "חללי שהייה לא ממושכת"],
            [
                [
                    name,
                    f"{sum(1 for r in continuous if r.floor_name == name)} חללים",
                    f"{sum(1 for r in passing_through if r.floor_name == name)} חללים",
                ]
                for name in floor_order
            ],
            [0.3, 0.35, 0.35],
        ),
    ]

    def highest(rows, name):
        on_floor = [r for r in rows if r.floor_name == name and r.max_mg is not None]
        return max(on_floor, key=lambda r: r.max_mg) if on_floor else None

    worst_continuous = max((r for r in continuous if r.max_mg is not None), key=lambda r: r.max_mg, default=None)
    story += [
        rtl("12. תוצאות חיזוי", H1),
        rtl(
            f"השדה המרבי בחללי שהייה ממושכת: {_num(worst_continuous.max_mg)} mG ({worst_continuous.floor_name}, {worst_continuous.room_name})."
            if worst_continuous
            else "לא התקבל ערך מחושב בחללי שהייה ממושכת."
        ),
        rtl(f"השדה המרבי בכל החללים: {_num(worst)} mG." if worst is not None else ""),
        Spacer(1, 4),
        _table(
            ["קומה", "מרבי בשהייה ממושכת (mG)", "היכן", "מרבי בשהייה לא ממושכת (mG)", "היכן"],
            [
                [
                    name,
                    _num(a.max_mg) if (a := highest(continuous, name)) else "—",
                    a.room_name if a else "",
                    _num(b.max_mg) if (b := highest(passing_through, name)) else "—",
                    b.room_name if b else "",
                ]
                for name in floor_order
            ],
            [0.16, 0.16, 0.26, 0.16, 0.26],
        ),
    ]

    # 14-15
    story += [PageBreak(), rtl("13. מפות השדה המגנטי על התוכניות", H1)]
    story += _heatmaps(db, project, run) or [rtl("אין נקודות חישוב להצגה.")]
    story += _views_3d(db, run)

    # 16
    def allowed(hours):
        if hours is None:
            return "—"
        if hours <= 0:
            return "אין שהייה"
        return f"{72 / hours + 1:.3g}"

    failing_rooms = sorted([r for r in per_room if r.status == "FAIL"], key=lambda r: -(r.max_mg or 0))
    shown = failing_rooms[:100]
    shown += sorted([r for r in continuous if r.status != "FAIL" and (r.max_mg or 0) >= 1.0], key=lambda r: -(r.max_mg or 0))[: max(0, 80 - len(shown))]
    shown += sorted([r for r in passing_through if r.status != "FAIL" and (r.max_mg or 0) >= 10.0], key=lambda r: -(r.max_mg or 0))[:30]
    story += [
        rtl("14. טבלת תוצאות", H1),
        rtl(
            "קודם החללים החורגים מהסף, ואחריהם חללי שהייה ממושכת מ-1 mG ומעלה וחללים ללא שהייה ממושכת מ-10 mG ומעלה, מהגבוה לנמוך. כל החללים שמורים במערכת.",
            SMALL,
        ),
        Spacer(1, 4),
        _table(
            ["מס׳", "קומה", "חלל", "שעות שהייה", "סף מותר (mG)", "שדה מרבי (mG)", "מקור עיקרי", "סטטוס"],
            [
                [
                    str(i),
                    r.floor_name,
                    r.room_name,
                    _num(r.occupancy_hours, 0) if r.occupancy_hours is not None else "—",
                    allowed(r.occupancy_hours),
                    _num(r.max_mg),
                    r.dominant_source_tag,
                    STATUS_LABELS.get(r.status, r.status),
                ]
                for i, r in enumerate(shown, 1)
            ]
            or [["—", "", "אין חללים מעל הספים", "", "", "", "", ""]],
            [0.05, 0.11, 0.24, 0.09, 0.1, 0.11, 0.1, 0.2],
        ),
    ]

    # 17
    story += [rtl("15. אזורים הדורשים טיפול", H1)]
    if failing:
        story += _bullets([f"{r.floor_name} / {r.room_name}: {_num(r.max_mg)} mG בגובה {r.height_m:g} מ׳" for r in failing])
    elif review:
        story.append(rtl("לא נקבעה חריגה, אך קיימים חללים שלא הוערכו מול כלל ודורשים בדיקה רגולטורית."))
    else:
        story.append(rtl("לא זוהו חריגות מהכללים שהוחלו."))

    # 18
    story += [rtl("16. המלצות", H1)]
    if recommendations:
        for item in recommendations:
            story += [rtl(item.explanation, H2)]
            story.append(
                _table(
                    ["חלופה", "השפעה צפויה", "מורכבות", "נתון נדרש", "חישוב חוזר"],
                    [
                        [
                            o["title"],
                            o["expected_effect"],
                            o["engineering_complexity"],
                            o["required_input"],
                            "נדרש" if o["requires_recalculation"] else "לא נדרש",
                        ]
                        for o in item.options
                    ],
                    [0.24, 0.32, 0.1, 0.24, 0.1],
                )
            )
    else:
        story.append(rtl("אין המלצות, מאחר שלא נקבעה חריגה מכלל תקף."))

    # 19
    story += [rtl("17. תוצאות לאחר פתרון מוצע", H1)]
    if comparison is not None:
        from ..routers.calculation import comparison_rows

        story.append(rtl(f"השוואה לתרחיש: {comparison.scenario_name}"))
        story.append(
            _table(
                ["קומה", "חדר", "לפני (mG)", "אחרי (mG)", "הפחתה"],
                [
                    [
                        row["floor_name"],
                        f"{row['room_name']} ({row['height_m']:g} מ׳)",
                        _num(row["before_mg"]),
                        _num(row["after_mg"]),
                        f"{row['reduction_pct']:.1f}%" if row["reduction_pct"] is not None else "—",
                    ]
                    for row in comparison_rows(db, run, comparison)
                ],
                [0.15, 0.35, 0.17, 0.17, 0.16],
            )
        )
        shielded = [
            override.get("attenuation_source")
            for override in comparison.input_snapshot["scenario"]["source_overrides"].values()
            if override.get("attenuation_factor") is not None
        ]
        if shielded:
            story.append(rtl(f"מקדמי המיגון הוזנו ולא חושבו. מקור המקדמים: {'; '.join(shielded)}.", SMALL))
    else:
        story.append(rtl("לא חושב תרחיש לאחר פתרון."))

    # 20-22
    story += [rtl("18. מגבלות החיזוי", H1)] + _bullets(LIMITATIONS)
    story += [rtl("19. מסקנות", H1)]
    if not final_view:
        story.append(rtl("דוח זה אינו דוח סופי. המסקנות יינתנו לאחר השלמת המידע החסר ואישור בעל מקצוע."))
    elif failing:
        story.append(rtl(f"נמצאו {len(failing)} תוצאות החורגות מהכללים שהוחלו. נדרש טיפול לפי סעיף ההמלצות."))
    else:
        story.append(rtl("לפי המודל, הנתונים והכללים המפורטים בדוח זה, לא נחזו חריגות מהכללים שהוחלו."))

    story += [
        rtl("20. נספחים", H1),
        rtl("נספח א׳: מדדי מעקב. כל ערך בדוח נשמר בריצת החישוב, ואפשר להתחקות אחריו במערכת."),
        _key_values(
            [
                ("מזהה ריצה", run.id),
                ("חתימת קלט", run.input_hash),
                ("גרסת מנוע", run.engine_version),
                ("מזהה תרחיש", scenario["id"]),
            ]
        ),
    ]

    watermark = None if report.status == "ISSUED" else ("טיוטה – לא הונפק" if report.is_final else "טיוטה – לא דוח סופי")

    def decorate(canvas, doc):
        canvas.saveState()
        if watermark:
            canvas.setFont("Arimo-Bold", 60)
            canvas.setFillColor(colors.Color(0.8, 0.1, 0.1, alpha=0.1))
            canvas.translate(PAGE_WIDTH / 2, PAGE_HEIGHT / 2)
            canvas.rotate(45)
            canvas.drawCentredString(0, 0, get_display(watermark))
            canvas.rotate(-45)
            canvas.translate(-PAGE_WIDTH / 2, -PAGE_HEIGHT / 2)
        canvas.setFont("Arimo", 8)
        canvas.setFillColor(colors.grey)
        canvas.drawCentredString(PAGE_WIDTH / 2, 1 * cm, f"{doc.page} | Galit ELF Projection | v{report.version}")
        canvas.restoreState()

    buffer = io.BytesIO()
    SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        title=f"דוח חיזוי שדות מגנטיים - גרסה {report.version}",
    ).build(story, onFirstPage=decorate, onLaterPages=decorate)
    return buffer.getvalue()


def _views_3d(db: Session, run: CalculationRun) -> list:
    """The building in 3D, a page for each group of floors, bottom up."""
    from .view3d import building_view, floor_groups

    floors = list(db.scalars(select(Floor).where(Floor.project_id == run.project_id)))
    story = [PageBreak(), rtl("תצוגה תלת-ממדית", H1)]
    story.append(
        rtl(
            "כל קומה מוצגת כמישור, צבוע לפי השדה המגנטי בגובה החישוב, והקומות מסודרות זו מעל זו. "
            "המרווח בין הקומות הוגדל כדי שכל מישור ייראה. המקורות מוצגים במקומם: שנאים ולוחות כגוף, קווי הזנה בגובה התקרה, ופירים כקו אנכי בין הקומות.",
            SMALL,
        )
    )
    for group in floor_groups(floors):
        image = building_view(db, run, group, run.heights_m[0])
        if image is None:
            continue
        image.thumbnail((1500, 2200), PilImage.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=85, optimize=True)
        buffer.seek(0)
        scale = min(CONTENT_WIDTH / image.width, 22 * cm / image.height)
        names = " · ".join(f.name for f in sorted(group, key=lambda f: f.elevation_m or 0))
        story.append(KeepTogether([rtl(names, H2), Image(buffer, width=image.width * scale, height=image.height * scale)]))
    return story


def _worst_per_room(results: list[CalculationResult]) -> list[CalculationResult]:
    """One row per room, at whichever height gave the highest field."""
    chosen: dict = {}
    for result in results:
        key = result.room_id or result.room_name
        current = chosen.get(key)
        if current is None or (result.max_mg or 0) > (current.max_mg or 0):
            chosen[key] = result
    return list(chosen.values())
