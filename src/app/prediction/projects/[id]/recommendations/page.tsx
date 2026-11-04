'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, errorText } from '@/lib/prediction/api';
import { STATUS_LABELS, mg } from '@/lib/prediction/labels';

export default function RecommendationsPage() {
  const { id } = useParams<{ id: string }>();
  const base = `/projects/${id}`;
  const [runs, setRuns] = useState<any[]>([]);
  const [runId, setRunId] = useState('');
  const [afterId, setAfterId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [comparison, setComparison] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`${base}/runs`)
      .then((rows) => {
        setRuns(rows);
        setRunId(rows[0]?.id ?? '');
      })
      .catch((failure) => setError(errorText(failure)));
  }, [base]);

  useEffect(() => {
    if (!runId) return;
    api(`${base}/runs/${runId}/recommendations`)
      .then(setItems)
      .catch((failure) => setError(errorText(failure)));
  }, [base, runId]);

  useEffect(() => {
    if (!runId || !afterId) {
      setComparison(null);
      return;
    }
    api(`${base}/runs/${runId}/compare/${afterId}`)
      .then(setComparison)
      .catch((failure) => setError(errorText(failure)));
  }, [base, runId, afterId]);

  if (runs.length === 0) return <div className="card muted">אין עדיין ריצות.</div>;
  const option = (item: any) => `${new Date(item.created_at).toLocaleString('he-IL')} | ${item.scenario_name}`;

  return (
    <>
      {error && <div className="notice error">{error}</div>}
      <div className="card row">
        <label className="field">
          ריצה
          <select value={runId} onChange={(e) => setRunId(e.target.value)}>
            {runs.map((item) => (
              <option key={item.id} value={item.id}>
                {option(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          השוואה לתרחיש לאחר פתרון
          <select value={afterId} onChange={(e) => setAfterId(e.target.value)}>
            <option value="">ללא</option>
            {runs
              .filter((item) => item.id !== runId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {option(item)}
                </option>
              ))}
          </select>
        </label>
      </div>

      {comparison && (
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>לפני ואחרי</h2>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>קומה</th>
                  <th>חדר</th>
                  <th>גובה</th>
                  <th>לפני (mG)</th>
                  <th>אחרי (mG)</th>
                  <th>הפחתה</th>
                  <th>סטטוס אחרי</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row, index) => (
                  <tr key={index}>
                    <td>{row.floor_name}</td>
                    <td>{row.room_name}</td>
                    <td className="num">{row.height_m}</td>
                    <td className="num">{mg(row.before_mg)}</td>
                    <td className="num">{mg(row.after_mg)}</td>
                    <td className="num">{row.reduction_pct != null ? `${row.reduction_pct.toFixed(1)}%` : '—'}</td>
                    <td>{STATUS_LABELS[row.status_after]?.text ?? row.status_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="card muted">
          אין המלצות לריצה זו. המלצה נוצרת רק לחדר שחורג מכלל רגולטורי מאומת. חדרים המסומנים REGULATION_REVIEW_REQUIRED לא
          נחשבים לחריגה, אבל גם לא נבדקו.
        </div>
      )}

      {items.map((item) => (
        <div className="card" key={item.id}>
          <h2 style={{ marginBottom: 6 }}>{item.room_name}</h2>
          <p>{item.explanation}</p>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>חלופה</th>
                  <th>השפעה צפויה</th>
                  <th>מורכבות</th>
                  <th>נתון נדרש</th>
                  <th>חישוב חוזר</th>
                </tr>
              </thead>
              <tbody>
                {item.options.map((option: any) => (
                  <tr key={option.code}>
                    <td>{option.title}</td>
                    <td>{option.expected_effect}</td>
                    <td>{option.engineering_complexity}</td>
                    <td>{option.required_input}</td>
                    <td>{option.requires_recalculation ? 'נדרש' : 'לא נדרש'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
