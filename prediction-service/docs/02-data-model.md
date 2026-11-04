# שלב 2 — מודל נתונים

המימוש: [backend/app/models.py](../backend/app/models.py). הטבלה הזו מסכמת את הכוונה.

## עקרונות

1. **ערך חסר הוא `NULL`, אף פעם לא ברירת מחדל.** זרם, גובה קומה ושעות שהייה הם nullable, ו-`NULL` מוצג כ-`MISSING_DATA`.
2. **הנחה היא שורה ב-`assumptions`**, עם סטטוס `ENGINEERING_ASSUMPTION`, נימוק ומחבר. היא מופיעה תמיד בדוח.
3. **הצעה ואישור נפרדים.** `suggested_occupancy` לעולם לא נכנס לחישוב הסטטוס. רק `occupancy_classification` עם `occupancy_confirmed=true` נחשב.
4. **ערך מקור נשמר לצד ערך מומר.** נתוני µT נשמרים ב-`original_value` ו-`original_unit` לצד הערך ב-mG.
5. **תוצאה קפואה.** כל ריצה שומרת `input_snapshot`, `input_hash` ו-`engine_version`, ואפשר להתחקות אחריה גם אחרי שינוי במודל.

## טבלאות

| טבלה | תפקיד | שדות מרכזיים |
|---|---|---|
| `users` | משתמשים ותפקידים | email, password_hash, role |
| `projects` | פרויקט | שם לקוח ופרויקט, כתובת, מספר, מזמין, מהנדס חשמל, אדריכל, תאריך, building_type, model_verified |
| `documents` | מסמכים בגרסאות | file_name, file_type, document_type, revision, upload_date, uploaded_by, status, page_count |
| `floors` | קומות | elevation_m, ceiling_height_m, plan_document_id, plan_page, כיול (scale_m_per_px, origin_px) |
| `rooms` | חדרים | polygon_m, area_m2, usage_type, suggested_occupancy, occupancy_classification, occupancy_confirmed, confidence |
| `occupancy_profiles` | משך שהייה לחדר | hours_per_day, days_per_week, source_note |
| `electrical_sources` | מקור בסיס | tag, source_type, model_type, floor_id, geometry, current_a, current_basis, voltage_v, rated_power_kva, load_factor, phase_configuration, confidence, detection_method, source_document_id, page, layer, user_verified |
| `cables` | פרטי כבל/תעלה/busbar | arrangement, spacing_m, phase_sequence, phase_currents_a, coherence_group, bar_width_m |
| `transformers` | פרטי שנאי | rated_power_kva, primary/secondary_voltage_v, box, reference_curve, reference_current_a, decay_exponent, reference_source |
| `panels` | פרטי לוח | אותם שדות מודל כמו בשנאי |
| `calculation_scenarios` | תרחישים | name, kind, current_factor, uncertainty_pct, source_overrides, notes |
| `calculation_runs` | ריצה | scenario_id, is_final, grid_step_m, heights_m, combination_method, input_snapshot, input_hash, engine_version |
| `calculation_points` | נקודות הרשת של חדר בגובה אחד | run_id, room_id, floor_id, height_m, z, xs, ys, predicted_mg, dominant_source_tags |
| `calculation_results` | סיכום לחדר ולגובה | max_mg, mean_mg, distance, dominant_source, sensitivity, normalized_exposure, status, rule_ids |
| `regulation_rules` | כללים | ראו שלב 4 |
| `assumptions` | הנחות | statement, justification, target, status, created_by |
| `recommendations` | המלצות | room, dominant_source, explanation, options |
| `report_versions` | גרסאות דוח | version, status, run_id, is_final, blockers, file_key, approved_by |
| `measurements` | מדידות שטח | measured_mg, original_value, original_unit, x, y, z, measured_at, instrument |
| `validation_results` | השוואה | predicted_mg, measured_mg, absolute_error, percentage_error |
| `audit_log` | מעקב | user, entity, entity_id, field, old_value, new_value, reason, at |

`calculation_runs` ו-`users` נוספו על הרשימה שביקשת, כי בלעדיהן אין קיבוץ של ריצה ואין הרשאות.

## מערכת הקואורדינטות

- כל הגאומטריה נשמרת **במטרים, בקואורדינטות עולם אחידות לפרויקט**.
- `Z` מוחלט. נקודת חישוב בקומה: `z = elevation_m + height_m`.
- מעבר מפיקסל לעולם: `x = (px - ox) * s`, `y = -(py - oy) * s`. הסימן נובע מכך שציר ה-Y של התמונה יורד.
- **לכל קומה נקודת ייחוס (`origin_px`)**. יש לבחור בכל הקומות את אותה נקודה פיזית (למשל עמוד). זה מה שמאפשר לחשב שנאי בחניון מול משרד מעליו.
- ב-MVP 1 כל התוכניות חייבות להיות באותו כיוון. סיבוב בין תוכניות לא נתמך עדיין.

## החלטות

### ה7. טבלאות פרטים נפרדות למקור (`cables`, `transformers`, `panels`)
- **מדוע:** כך ביקשת, וכל סוג באמת דורש שדות אחרים. עמודת JSON אחת הייתה מסתירה חוסרים.
- **חלופה:** טבלת מקור אחת עם JSON. פשוטה יותר, אך קשה יותר לאכוף בה חובה לפי סוג.
- **סיכון:** מקור נוסף דורש התאמה בכמה מקומות. מרוכז ב-`model_to_engine`.

### ה8. נקודות רשת כמערכים לחדר ולגובה, ולא שורה לכל נקודה
- **מדוע:** לפי הערכה, שורה לנקודה עולה כ-400 בתים. ריצה של 10,000 נקודות הייתה תופסת כ-4MB, ו-100 ריצות כאלה היו ממלאות מסד של 1GB. במערכים, עם הדחיסה של PostgreSQL, נמדדו בייצור כ-11 בתים לנקודה. זו דגימה קטנה של 384 נקודות, ובפרויקט אמיתי עם יותר מקורות המספר עשוי לעלות.
- **חלופה:** שורה לנקודה, שמאפשרת שאילתה על נקודה בודדת. זה היה התכנון המקורי, והוא נדחה כשהמערכת עברה למסד קטן.
- **למה המעקב לא נפגע:** הערך המדויק של המרבי בכל חדר נשמר בלי עיגול בשורת התוצאה. השוואה למדידה מחושבת מחדש במיקום המדויק מתוך הקלט הקפוא של הריצה, כך שהיא לא תלויה בנקודות השמורות.
- **סיכון:** אי אפשר לחפש נקודה ב-SQL. המסכים והדוח תמיד קוראים קומה שלמה, ולכן זה לא נדרש היום.

### ה9. Alembic מהיום הראשון
- **מדוע:** למערכת עם דוחות חתומים אסור לאבד היסטוריה בשינוי סכמה.
- **סיכון:** מיגרציה נוספת בכל שינוי, וזה מחיר סביר.
