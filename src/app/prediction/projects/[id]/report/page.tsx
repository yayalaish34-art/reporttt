'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { predictionJobNumber } from '../../../actions';
import { ApiError, api, errorText, fileUrl } from '@/lib/prediction/api';
import { REPORT_STATUS_LABELS } from '@/lib/prediction/labels';

const NEXT: Record<string, { status: string; text: string; primary?: boolean }[]> = {
  DRAFT: [{ status: 'UNDER_REVIEW', text: 'העברה לבדיקה', primary: true }],
  UNDER_REVIEW: [
    { status: 'APPROVED', text: 'אישור מקצועי', primary: true },
    { status: 'DRAFT', text: 'החזרה לטיוטה' },
  ],
  APPROVED: [
    { status: 'ISSUED', text: 'הנפקה', primary: true },
    { status: 'UNDER_REVIEW', text: 'החזרה לבדיקה' },
  ],
  ISSUED: [],
};

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const base = `/projects/${id}`;
  const [reports, setReports] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [runId, setRunId] = useState('');
  const [comparisonId, setComparisonId] = useState('');
  const [error, setError] = useState<{ message: string; missing: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [rep, run] = await Promise.all([api(`${base}/reports`), api(`${base}/runs`)]);
    setReports(rep);
    setRuns(run);
    setRunId((current) => current || run[0]?.id || '');
  }, [base]);

  useEffect(() => {
    load().catch((failure) => setError({ message: errorText(failure), missing: [] }));
  }, [load]);

  async function act(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await load();
    } catch (failure) {
      setError({ message: errorText(failure), missing: failure instanceof ApiError ? failure.missing : [] });
    } finally {
      setBusy(false);
    }
  }

  /**
   * The project's number from the system-wide register, taken now if it has none yet,
   * so the report prints it. A register that cannot be written never stops the report.
   */
  async function ensureJobNumber() {
    try {
      const [project, user] = await Promise.all([api(base), api('/auth/me')]);
      const number = await predictionJobNumber(id, project.client_name, user.full_name || user.email, project.project_number);
      if (String(number) !== project.project_number) {
        await api(base, { method: 'PATCH', json: { project_number: String(number), reason: 'Job Number מבקרת המספרים' } });
      }
    } catch (failure) {
      console.error('רישום Job Number נכשל', failure);
    }
  }

  const option = (item: any) =>
    `${new Date(item.created_at).toLocaleString('he-IL')} | ${item.scenario_name} | ${item.is_final ? 'סופית' : 'טיוטה'}`;

  return (
    <>
      {error && (
        <div className="notice error">
          {error.message}
          {error.missing.length > 0 && (
            <ul>
              {error.missing.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {runs.length === 0 ? (
        <div className="card muted">קודם צריך להריץ חישוב.</div>
      ) : (
        <div className="card">
          <h2 style={{ marginBottom: 10 }}>הפקת דוח</h2>
          <div className="row">
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
              תרחיש לאחר פתרון (אופציונלי)
              <select value={comparisonId} onChange={(e) => setComparisonId(e.target.value)}>
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
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !runId}
              onClick={() =>
                act(async () => {
                  await ensureJobNumber();
                  await api(`${base}/reports`, { method: 'POST', json: { run_id: runId, comparison_run_id: comparisonId || null } });
                })
              }
            >
              {busy ? 'מפיק…' : 'הפקת דוח PDF'}
            </button>
          </div>
        </div>
      )}

      {reports.map((report) => (
        <div className="card" key={report.id}>
          <div className="row">
            <h3 className="grow" style={{ margin: 0 }}>
              גרסה {report.version}{' '}
              <span className={`tag ${report.status === 'ISSUED' ? 'ok' : ''}`}>{REPORT_STATUS_LABELS[report.status]}</span>{' '}
              {!report.is_final && <span className="tag warn">לא סופי</span>}
            </h3>
            <a className="btn" href={fileUrl(`${base}/reports/${report.id}/file`)} target="_blank" rel="noreferrer">
              הורדת PDF
            </a>
            {NEXT[report.status].map((step) => (
              <button
                key={step.status}
                type="button"
                className={step.primary ? 'btn-primary' : ''}
                disabled={busy}
                onClick={() => act(() => api(`${base}/reports/${report.id}/transition`, { method: 'POST', json: { status: step.status } }))}
              >
                {step.text}
              </button>
            ))}
          </div>
          {report.blockers.length > 0 && (
            <div className="notice warn" style={{ marginTop: 10, marginBottom: 0 }}>
              <strong>לא ניתן להנפיק דוח חיזוי סופי. מידע חסר:</strong>
              <ul>
                {report.blockers.map((blocker: any, index: number) => (
                  <li key={index}>{blocker.message}</li>
                ))}
              </ul>
            </div>
          )}
          {report.approved_at && (
            <p className="small muted" style={{ marginTop: 8 }}>
              אושר ב-{new Date(report.approved_at).toLocaleString('he-IL')}
            </p>
          )}
        </div>
      ))}
    </>
  );
}
