"""Explains an exceedance from stored results. It computes nothing of its own."""

from ..models import CalculationResult, CalculationRun, Recommendation

_LINE_KINDS = ("THREE_PHASE", "BUSBAR")


def _options(kind: str | None, arrangement: str | None) -> list[dict]:
    options = [
        {
            "code": "RELOCATE",
            "title": "העתקת המקור",
            "expected_effect": "הפחתה עד לערך 'ללא המקור' שבהסבר, לפי המיקום החדש",
            "engineering_complexity": "גבוהה",
            "required_input": "מיקום חדש ותיאום עם מתכנן החשמל",
            "requires_recalculation": True,
        },
        {
            "code": "INCREASE_SEPARATION",
            "title": "הגדלת המרחק מהאזור המאוכלס",
            "expected_effect": "תלוי במרחק החדש. נקבע בחישוב חוזר",
            "engineering_complexity": "בינונית",
            "required_input": "המרחק האפשרי בפועל",
            "requires_recalculation": True,
        },
    ]
    if kind in _LINE_KINDS and arrangement != "TREFOIL":
        options.append(
            {
                "code": "RECONFIGURE_PHASES",
                "title": "שינוי סידור הפאזות או הקטנת המרווח",
                "expected_effect": "הקטנת השדה דרך ביטול פאזות. נקבע בחישוב חוזר",
                "engineering_complexity": "בינונית",
                "required_input": "סידור ומרווח אפשריים לפי מתכנן החשמל",
                "requires_recalculation": True,
            }
        )
    options += [
        {
            "code": "SHIELDING",
            "title": "מיגון מגנטי (למשל silicon steel או aluminum)",
            "expected_effect": "לא מובטח שיעור הפחתה. דרוש מקדם ממדידה, יצרן או מודל מאומת",
            "engineering_complexity": "גבוהה",
            "required_input": "חומר, גאומטריה ומקדם הפחתה עם מקור",
            "requires_recalculation": True,
        },
        {
            "code": "CHANGE_USE",
            "title": "שינוי ייעוד החדר או העתקת עמדות",
            "expected_effect": "שינוי סיווג השהייה. לא משנה את השדה עצמו",
            "engineering_complexity": "תלוי בתכנון",
            "required_input": "אישור האדריכל והמזמין",
            "requires_recalculation": True,
        },
    ]
    return options


def build_recommendations(run: CalculationRun, results: list[CalculationResult], snapshot: dict) -> list[Recommendation]:
    sources_by_tag = {source["id"]: source for source in snapshot["sources"]}
    records_by_tag = {record["tag"]: record for record in snapshot["source_records"]}
    recommendations = []
    for result in results:
        if result.status != "FAIL" or not result.dominant_source_tag:
            continue
        tag = result.dominant_source_tag
        source = sources_by_tag.get(tag, {})
        record = records_by_tag.get(tag, {})
        current = f", זרם {record['current_a']:g} A" if record.get("current_a") is not None else ""
        explanation = (
            f"התרומה הדומיננטית בחדר {result.room_name} ({result.floor_name}) בגובה {result.height_m:g} מ׳ "
            f"היא של המקור {tag}{current}, במרחק {result.dominant_distance_m:.2f} מ׳ מנקודת המרבי. "
            f"השדה המרבי {result.max_mg:.2f} mG, ותרומת המקור לבדו {result.dominant_source_mg:.2f} mG. "
            f"ללא מקור זה השדה באותה נקודה יהיה {result.without_dominant_mg:.2f} mG."
        )
        recommendations.append(
            Recommendation(
                run_id=run.id,
                result_id=result.id,
                room_name=result.room_name,
                dominant_source_tag=tag,
                explanation=explanation,
                options=_options(source.get("kind"), source.get("arrangement")),
            )
        )
    return recommendations
