'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, errorText } from '@/lib/prediction/api';
import { SCENARIO_LABELS, label } from '@/lib/prediction/labels';

type Override = { attenuation_factor?: string; attenuation_source?: string; excluded?: boolean };

export default function CalculationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const base = `/projects/${id}`;
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [readiness, setReadiness] = useState<any>(null);
  const [scenarioId, setScenarioId] = useState('');
  const [step, setStep] = useState('0.5');
  const [heights, setHeights] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'NORMAL', current_factor: '1', uncertainty_pct: '', notes: '' });
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  const load = useCallback(async () => {
    const [s, src, r, ready] = await Promise.all([
      api(`${base}/scenarios`),
      api(`${base}/sources`),
      api(`${base}/runs`),
      api(`${base}/readiness`),
    ]);
    setScenarios(s);
    setSources(src);
    setRuns(r);
    setReadiness(ready);
    setScenarioId((current) => current || s[0]?.id || '');
  }, [base]);

  useEffect(() => {
    load().catch((failure) => setError(errorText(failure)));
  }, [load]);

  async function addScenario(event: FormEvent) {
    event.preventDefault();
    setError('');
    const cleaned: Record<string, unknown> = {};
    Object.entries(overrides).forEach(([sourceId, override]) => {
      const entry: Record<string, unknown> = {};
      if (override.excluded) entry.excluded = true;
      if (override.attenuation_factor) {
        entry.attenuation_factor = Number(override.attenuation_factor);
        entry.attenuation_source = override.attenuation_source ?? '';
      }
      if (Object.keys(entry).length) cleaned[sourceId] = entry;
    });
    try {
      const created = await api(`${base}/scenarios`, {
        method: 'POST',
        json: {
          name: form.name,
          kind: form.kind,
          current_factor: Number(form.current_factor),
          uncertainty_pct: form.uncertainty_pct === '' ? null : Number(form.uncertainty_pct),
          notes: form.notes,
          source_overrides: cleaned,
        },
      });
      setScenarioId(created.id);
      setForm({ name: '', kind: 'NORMAL', current_factor: '1', uncertainty_pct: '', notes: '' });
      setOverrides({});
      await load();
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const heightValues = heights.split(/[,\s]+/).filter(Boolean).map(Number);
      const created = await api(`${base}/runs`, {
        method: 'POST',
        json: { scenario_id: scenarioId, grid_step_m: Number(step), heights_m: heightValues },
      });
      router.push(`/prediction/projects/${id}/results?run=${created.id}`);
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }

  const update = (name: string, value: string) => setForm((current) => ({ ...current, [name]: value }));
  const updateOverride = (sourceId: string, patch: Override) =>
    setOverrides((current) => ({ ...current, [sourceId]: { ...current[sourceId], ...patch } }));

  return (
    <>
      {error && <div className="notice error">{error}</div>}
      {readiness && !readiness.ready && (
        <div className="notice warn">
          ריצה כעת תסומן כ<strong>טיוטה</strong> ולא תוכל לשמש לדוח סופי. {readiness.blockers.length} פריטים פתוחים במסך השאלות.
        </div>
      )}
      {readiness?.ready && <div className="notice ok">המודל מלא ומאושר. ריצה כעת תהיה ריצה סופית.</div>}

      <form className="card" onSubmit={run}>
        <h2 style={{ marginBottom: 10 }}>הרצת חיזוי</h2>
        <div className="grid">
          <label className="field">
            תרחיש
            <select required value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
              <option value="">בחירה</option>
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            צעד רשת (מ׳)
            <input type="number" className="num" min="0.1" max="2" step="0.05" required value={step} onChange={(e) => setStep(e.target.value)} />
          </label>
          <label className="field">
            גובהי חישוב מעל הרצפה (מ׳), מופרדים בפסיק
            <input className="num" required placeholder="MISSING_DATA" value={heights} onChange={(e) => setHeights(e.target.value)} />
          </label>
        </div>
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy || !scenarioId}>
          {busy ? 'מחשב…' : 'הרצה'}
        </button>
      </form>

      <form className="card" onSubmit={addScenario}>
        <h2 style={{ marginBottom: 10 }}>תרחיש חדש</h2>
        <div className="grid">
          <label className="field">
            שם
            <input required value={form.name} onChange={(e) => update('name', e.target.value)} />
          </label>
          <label className="field">
            סוג
            <select value={form.kind} onChange={(e) => update('kind', e.target.value)}>
              {Object.entries(SCENARIO_LABELS).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            מקדם על הזרמים שהוזנו (1 = כפי שהוזנו)
            <input
              type="number"
              className="num"
              min="0.01"
              step="any"
              required
              value={form.current_factor}
              onChange={(e) => update('current_factor', e.target.value)}
            />
          </label>
          <label className="field">
            אי ודאות בזרם (± %)
            <input
              type="number"
              className="num"
              min="0"
              max="99"
              step="any"
              value={form.uncertainty_pct}
              onChange={(e) => update('uncertainty_pct', e.target.value)}
            />
          </label>
          <label className="field">
            הערות
            <input value={form.notes} onChange={(e) => update('notes', e.target.value)} />
          </label>
        </div>
        {form.kind === 'POST_MITIGATION' && (
          <div style={{ marginTop: 10 }}>
            <h3>שינויים לפי מקור</h3>
            <p className="small muted">
              מקדם מיגון הוא הכופל של תרומת המקור (0–1). הוא מוזן ולא מחושב, ולכן חובה לציין את מקורו. שינוי מיקום מבצעים
              במודל עצמו.
            </p>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>מקור</th>
                    <th>הסרה בתרחיש</th>
                    <th>מקדם מיגון</th>
                    <th>מקור המקדם</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => (
                    <tr key={source.id}>
                      <td>{source.tag}</td>
                      <td>
                        <input
                          type="checkbox"
                          style={{ width: 'auto' }}
                          checked={!!overrides[source.id]?.excluded}
                          onChange={(e) => updateOverride(source.id, { excluded: e.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="num"
                          min="0"
                          max="1"
                          step="any"
                          value={overrides[source.id]?.attenuation_factor ?? ''}
                          onChange={(e) => updateOverride(source.id, { attenuation_factor: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          value={overrides[source.id]?.attenuation_source ?? ''}
                          onChange={(e) => updateOverride(source.id, { attenuation_source: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <button style={{ marginTop: 12 }}>הוספת תרחיש</button>
      </form>

      {scenarios.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 6 }}>תרחישים</h2>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {scenarios.map((scenario) => (
              <li key={scenario.id}>
                {scenario.name}{' '}
                <span className="muted small">
                  ({label(SCENARIO_LABELS, scenario.kind)}, מקדם {scenario.current_factor}
                  {scenario.uncertainty_pct != null ? `, ±${scenario.uncertainty_pct}%` : ''})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {runs.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>מועד</th>
                  <th>תרחיש</th>
                  <th>רשת</th>
                  <th>גבהים</th>
                  <th>סוג</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <a href={`/prediction/projects/${id}/results?run=${item.id}`}>{new Date(item.created_at).toLocaleString('he-IL')}</a>
                    </td>
                    <td>{item.scenario_name}</td>
                    <td className="num">{item.grid_step_m} m</td>
                    <td className="num">{item.heights_m.join(', ')} m</td>
                    <td>{item.is_final ? <span className="tag ok">סופית</span> : <span className="tag warn">טיוטה</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
