# Galit ELF Prediction System

מערכת של גלית – החברה לאיכות הסביבה לחיזוי שדות מגנטיים בתדר רשת החשמל (50 Hz) לפני הקמה או אכלוס.

```
AI extracts → Human verifies → Physics engine calculates → Regulation engine evaluates
            → AI drafts report → Professional reviews → System issues report
```

**המסכים:** בתוך מערכת הדוחות, ב-`/prediction` (https://radiation-reports-production.up.railway.app/prediction).

**המנוע:** https://galit-elf.vercel.app — ה-API, ושירות קטן שחותם על העלאות ישירות. הכתובת הראשית מפנה למערכת הדוחות.

## מצב נוכחי: MVP 1

בנוי ועובד: פרויקט ומסמכים בגרסאות, כיול ידני, הצבת חדרים ומקורות על התוכנית, שאלון דינמי, חישוב תלת-ממדי תלת-פאזי, Heatmap ב-mG, רגישות, מעקב למספר, תרחיש לאחר פתרון, דוח PDF בעברית וזרימת אישור. הזנת מדידות שטח וניהול משתמשים קיימים ב-API בלבד, ועדיין אין להם מסך.

**המנוע נבדק מול פתרונות אנליטיים בלבד.** עדיין אין השוואה למדידות שטח או לתוכנת חיזוי אחרת. ראו [validation_cases/](validation_cases/README.md).

**כללי הרגולציה לא פעילים.** עד שבעל מקצוע יאמת אותם מול מקור, כל התוצאות יסומנו `REGULATION_REVIEW_REQUIRED` ולא ניתן להנפיק דוח סופי. ראו [שלב 4](docs/04-regulation-engine.md).

**הפריסה על תוכניות חינמיות.** Hobby של Vercel מיועדת לשימוש לא מסחרי, והמכסות קטנות. ראו [מגבלות הפלטפורמה](docs/01-architecture.md#מגבלות-הפלטפורמה).

## מסמכי תכנון

1. [ארכיטקטורה](docs/01-architecture.md)
2. [מודל נתונים](docs/02-data-model.md)
3. [מנוע פיזיקלי](docs/03-physics-engine.md)
4. [מנוע רגולציה](docs/04-regulation-engine.md)
5. [זרימת משתמש](docs/05-ux-flow.md)
6. [אפיון MVP](docs/06-mvp-spec.md)
7. [מבנה הריפו](docs/07-repo-structure.md)

## הרצה מקומית

```powershell
python -m venv .venv
.venv\Scripts\pip install -r backend\requirements-dev.txt

cd backend
$env:ELF_ADMIN_EMAIL="you@example.com"; $env:ELF_ADMIN_PASSWORD="choose-a-password"
..\.venv\Scripts\python -m app.deploy_setup
..\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

בטרמינל שני, ממערכת הדוחות (שורש הריפו):

```powershell
npm install
$env:PREDICTION_API_URL="http://127.0.0.1:8000"; $env:NODE_OPTIONS="--experimental-sqlite"; npm run dev
# http://localhost:3000/prediction
```

מקומית משתמשים ב-SQLite ובתיקיית `backend/storage`, והקבצים עולים דרך ה-API.

## בדיקות

```powershell
cd backend
..\.venv\Scripts\python -m pytest tests -q
```

להרצה על PostgreSQL: מגדירים `ELF_TEST_DATABASE_URL` למסד בשם `elf_test`.

## פריסה ל-Vercel

| רכיב | שם | אזור |
|---|---|---|
| פרויקט (Services: `web` = חותם ההעלאות, `api` = המנוע) | `galit-elf` | fra1 |
| PostgreSQL ב-Neon | `galit-elf-db` | Frankfurt |
| Vercel Blob פרטי | `galit-elf-files` | fra1 |

פריסה מחדש של המנוע, מתוך `prediction-service/` (לא משורש הריפו):

```powershell
npx vercel deploy --prod
```

המיגרציות רצות אוטומטית בזמן ה-build של ייצור. אם הן נכשלות, הפריסה נכשלת והגרסה הקודמת ממשיכה לרוץ.

משתני סביבה בייצור: `ELF_JWT_SECRET`, `ELF_ADMIN_EMAIL`, `ELF_COOKIE_SECURE`, ואלה שהחיבורים של Neon ו-Blob הוסיפו. `ELF_ADMIN_PASSWORD` נדרש רק כשטבלת המשתמשים ריקה, והוסר אחרי יצירת המנהל.

פרטי המנהל הראשון נשמרו ב-`deploy/.admin-credentials.txt`, שאינו נכנס ל-git ולא לפריסה.

## איך זה מחובר למערכת הדוחות

- המסכים נמצאים ב-`src/app/prediction/` של מערכת הדוחות, ומשתמשים בבורר הלקוחות שלה (ספריית הלקוחות שמסתנכרנת מה-CRM).
- הדפדפן פונה רק למערכת הדוחות. `src/app/api/prediction/[...path]/route.ts` מעביר את הבקשות למנוע ב-Vercel, עם עוגיית המנוע בלבד.
- מספר הפרויקט נלקח ממרשם ה-Job Number של מערכת הדוחות בהפקת הדוח הראשון.
- למנוע יש התחברות משלו, כי למערכת הדוחות יש סיסמה משותפת אחת (או אף אחת), ולכן היא לא יודעת מי ביצע כל פעולה. יומן השינויים ואישור הדוח צריכים שם של אדם.
