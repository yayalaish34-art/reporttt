# שלב 7 — מבנה הריפו

```
reporttt/prediction-service/
├── README.md
├── vercel.json                שני השירותים והניתוב ביניהם
├── .vercelignore
├── docs/                      מסמכי התכנון (שלבים 1–7)
├── deploy/                    פרטי מנהל מקומיים (לא נכנס ל-git ולא לפריסה)
├── backend/                   שירות Vercel "api"
│   ├── requirements.txt, requirements-dev.txt, .python-version, alembic.ini
│   ├── alembic/               מיגרציות
│   ├── elf_engine/            מנוע פיזיקלי טהור
│   │   ├── constants.py       μ₀, המרות
│   │   ├── units.py           µT ↔ mG
│   │   ├── biot_savart.py     מקטע סופי (פאזורי, ווקטורי)
│   │   ├── sources.py         מוליך, מעגל, busbar, אמפירי
│   │   ├── field.py           superposition, דומיננטי
│   │   ├── grid.py            רשת חישוב בחדר
│   │   └── exposure.py        calculate_normalized_exposure
│   ├── elf_regulation/        מנוע רגולציה טהור
│   ├── app/                   FastAPI
│   │   ├── main.py, config.py, db.py, security.py, audit.py
│   │   ├── storage.py         תיקייה מקומית או Blob פרטי
│   │   ├── bootstrap.py       מנהל ראשון ומועמדי כללים
│   │   ├── deploy_setup.py    מיגרציות ו-bootstrap בזמן build
│   │   ├── models.py          SQLAlchemy
│   │   ├── schemas.py         Pydantic
│   │   ├── routers/           auth, projects, documents, model, calculation, regulation, reports, validation
│   │   └── services/          readiness, questions, occupancy, calculation, recommendations, report_pdf
│   ├── assets/fonts/          גופן עברי (OFL)
│   ├── data/                  מועמדי רגולציה (active=false)
│   └── tests/                 בדיקות מנוע, רגולציה, API, פריסה ו-golden
├── upload-signer/             שירות Vercel "web": רק /upload-url, וכל השאר מפנה למערכת הדוחות
└── validation_cases/          מקרי Golden
    └── <case>/ geometry.json, inputs.json, expected_results.json,
                reference.pdf (אם יש), measurement.csv (אם יש)
```

## החלטות

### ה18. בתוך הריפו של מערכת הדוחות
- **החלטה (עודכנה):** המסכים ב-`src/app/prediction/` של `reporttt`, והמנוע ב-`prediction-service/` באותו ריפו.
- **מדוע:** ביקשת שהמערכת תהיה בתוך מערכת הדוחות. כך היא משתמשת ישירות בבורר הלקוחות ובמרשם ה-Job Number, ונשמרת ב-git יחד עם שאר המערכת.
- **חלופה:** ריפו נפרד, כפי שהיה בהתחלה. נדחה כשנוצר קוד משותף.
- **סיכון:** שתי פריסות מאותו ריפו: מערכת הדוחות ל-Railway ב-push, והמנוע ל-Vercel דרך CLI מתוך `prediction-service/`. שינוי ב-API של המנוע צריך להיפרס לפני המסכים שמשתמשים בו.

### ה19. בלי Docker
- **מדוע:** Vercel בונה Next ו-FastAPI ישירות. הגופנים והספריות הבינאריות שהדוח צריך נכנסים לחבילה בלי image. ה-Dockerfiles שנכתבו ל-Railway מעולם לא נבנו, ונמחקו.
- **חלופה:** הרצה כ-container ב-Vercel Services. שימושית אם תידרש ספרייה שאין לה wheel מוכן, למשל ב-MVP 3–4.
- **סיכון:** גודל החבילה מוגבל ל-500MB. זה מספיק היום, וצריך לבדוק שוב כשמוסיפים ספריות CAD.
