# Galit ELF Projection

מערכת של גלית – החברה לאיכות הסביבה לחיזוי שדות מגנטיים בתדר רשת החשמל (50 Hz) לפני הקמה או אכלוס.

```
AI extracts → Human verifies → Physics engine calculates → Regulation engine evaluates
            → AI drafts report → Professional reviews → System issues report
```

**המערכת:** https://galit-elf-projection.up.railway.app — מערכת נפרדת ב-Railway (פרויקט "Galit ELF Projection"), עם התחברות, מסד נתונים ואחסון משלה. מערכת הדוחות רק מקשרת אליה.

## מצב נוכחי: MVP 1

בנוי ועובד: פרויקט ומסמכים בגרסאות, כיול ידני, הצבת חדרים ומקורות על התוכנית, שאלון דינמי, חישוב תלת-ממדי תלת-פאזי, Heatmap ב-mG, רגישות, מעקב למספר, תרחיש לאחר פתרון, דוח PDF בעברית וזרימת אישור. הזנת מדידות שטח וניהול משתמשים קיימים ב-API בלבד, ועדיין אין להם מסך.

**המנוע נבדק מול פתרונות אנליטיים בלבד.** עדיין אין השוואה למדידות שטח או לתוכנת חיזוי אחרת. ראו [validation_cases/](validation_cases/README.md).

**כללי הרגולציה לא פעילים.** עד שבעל מקצוע יאמת אותם מול מקור, כל התוצאות יסומנו `REGULATION_REVIEW_REQUIRED` ולא ניתן להנפיק דוח סופי. ראו [שלב 4](docs/04-regulation-engine.md).

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

בטרמינל שני, המסכים (מפנים את `/api` למנוע המקומי):

```powershell
cd web
npm install
npx next build   # out/ — או: $env:WEB_DIST="..\web\out" כדי שהמנוע יגיש אותם בכתובת אחת
```

מקומית משתמשים ב-SQLite ובתיקיית `backend/storage`, והקבצים עולים דרך ה-API.

## בדיקות

```powershell
cd backend
..\.venv\Scripts\python -m pytest tests -q
```

להרצה על PostgreSQL: מגדירים `ELF_TEST_DATABASE_URL` למסד בשם `elf_test`.

## פריסה ל-Railway

| רכיב | שם |
|---|---|
| פרויקט | `Galit ELF Projection` (חשבון galitinc@gmail.com) |
| שירות: המנוע, שמגיש גם את המסכים | `galit-elf-projection`, תיקיית שורש `prediction-service`, Dockerfile |
| PostgreSQL | `Postgres` באותו פרויקט |
| אחסון קבצים | Volume ב-`/data` (`ELF_STORAGE_DIR=/data/storage`) |

הפריסה אוטומטית ב-push ל-`main` של קבצים תחת `prediction-service/` בלבד. מערכת הדוחות מתעלמת מהתיקייה הזאת, ולהפך.

המיגרציות רצות בעליית השירות, לפני שהוא מקבל תעבורה. אם הן נכשלות, הגרסה הקודמת ממשיכה לרוץ.

משתני סביבה: `DATABASE_URL` (הפניה ל-Postgres), `ELF_JWT_SECRET`, `ELF_STORAGE_DIR`, `ELF_COOKIE_SECURE`, `OPENAI_API_KEY`, `CRM_DATABASE_URL` (חיפוש לקוחות), `REPORTS_URL` ו-`JOB_NUMBERS_TOKEN` (מרשם ה-Job Number), `PUBLIC_URL`.

## החיבורים למערכות האחרות

- **CRM:** חיפוש הלקוחות ואנשי הקשר בטופס הפרויקט קורא ישירות ממסד הנתונים של ה-CRM (`/api/crm/...`), בקריאה בלבד.
- **מערכת הדוחות:** מספר הפרויקט נלקח ממרשם ה-Job Number המשותף בהפקת הדוח הראשון, דרך `POST /api/job-numbers` במערכת הדוחות עם `JOB_NUMBERS_TOKEN`. אם המרשם לא עונה, הדוח מופק בכל זאת והמספר נלקח בהפקה הבאה.
- **התחברות:** למערכת יש משתמשים משלה, כי יומן השינויים ואישור הדוח צריכים שם של אדם.
