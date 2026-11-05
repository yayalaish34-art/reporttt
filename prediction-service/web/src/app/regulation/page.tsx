'use client';

import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';

type Summary = {
  authority: string;
  document_name: string;
  document_version: string;
  effective_date: string;
  allowed_by_hours: { hours: number; allowed_mg: number }[];
};

/** The guideline every report is judged against, as published, with its table of limits. */
export default function RegulationDocument() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Summary>('/regulation/summary')
      .then(setSummary)
      .catch((failure) => setError(errorText(failure)));
  }, []);

  if (error) return <div className="notice error">{error}</div>;
  if (!summary) return <p className="muted">טוען…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>מסמך הרגולציה</h1>
          <p className="subtitle">
            {summary.document_name} · {summary.authority} · {summary.document_version}, בתוקף מ-
            {new Date(summary.effective_date).toLocaleDateString('he-IL')}
          </p>
        </div>
      </div>

      <section className="card">
        <h2>איך הוא מוחל בדוחות</h2>
        <p>
          החשיפה הממוצעת ביממה עם צריכת חשמל טיפוסית מרבית חייבת להיות נמוכה מ-4 mG, כשבשאר שעות היממה החשיפה היא 1 mG. לכן השדה
          המותר סמוך למתקן בשהייה של T שעות ביממה הוא <strong>72/T + 1</strong>. החישוב נעשה בזרם האופייני (60% מהזרם המרבי).
        </p>
        <ul className="small">
          <li>בדירה (חדרי שינה, סלון, מטבח, מרפסת): 24 שעות, כלומר 4 mG.</li>
          <li>משרד או חנות: 9 שעות, כלומר 9 mG.</li>
          <li>מסדרון, לובי, חדר מדרגות, מעלית, חניה ומחסן: שעה אחת, כלומר 73 mG.</li>
          <li>פיר, חדר טכני וסביבת ציוד חשמלי: אין שהייה.</li>
          <li>כיתות במוסדות חינוך לילדים מתחת לגיל 15: 4 mG בכל מקום ישיבה.</li>
        </ul>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>שעות שהייה ביממה</th>
                {summary.allowed_by_hours.map((row) => (
                  <th key={row.hours} className="num">
                    {row.hours}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>שדה מותר (mG)</th>
                {summary.allowed_by_hours.map((row) => (
                  <td key={row.hours} className="num">
                    {row.allowed_mg}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>
          המסמך <a className="small" href="/api/regulation/document" target="_blank" rel="noreferrer">(פתיחה בחלון חדש)</a>
        </h2>
        <iframe title="מסמך הרגולציה" src="/api/regulation/document" style={{ width: '100%', height: '80vh', border: '1px solid var(--border)' }} />
      </section>
    </>
  );
}
