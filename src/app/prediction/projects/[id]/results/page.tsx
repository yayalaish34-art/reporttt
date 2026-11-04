'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { PlanView } from '@/app/prediction/plan-view';
import { api, errorText } from '@/lib/prediction/api';
import { Band, bandColor, pointsAttr, toPixel } from '@/lib/prediction/geometry';
import { LINE_TYPES, OCCUPANCY_LABELS, STATUS_LABELS, label, mg } from '@/lib/prediction/labels';

function Status({ status }: { status: string }) {
  const item = STATUS_LABELS[status] ?? { text: status, tone: '' };
  return <span className={`tag ${item.tone}`}>{item.text}</span>;
}

function TraceDrawer({ projectId, resultId, onClose }: { projectId: string; resultId: string; onClose: () => void }) {
  const [trace, setTrace] = useState<any>(null);

  useEffect(() => {
    api(`/projects/${projectId}/results/${resultId}/trace`)
      .then(setTrace)
      .catch(() => setTrace(null));
  }, [projectId, resultId]);

  return (
    <aside className="drawer">
      <div className="row">
        <h2 className="grow">מעקב: {trace?.room_name}</h2>
        <button type="button" onClick={onClose}>
          סגירה
        </button>
      </div>
      {trace && (
        <>
          <dl style={{ marginTop: 10 }}>
            <dt>ערך</dt>
            <dd className="num">{mg(trace.value_mg)} mG</dd>
            <dt>נקודה (X, Y, Z)</dt>
            <dd className="num">{trace.point?.map((v: number) => v.toFixed(2)).join(', ')}</dd>
            <dt>תרחיש</dt>
            <dd>{trace.scenario.name}</dd>
            <dt>שיטת שילוב</dt>
            <dd>{trace.combination_method}</dd>
            <dt>גרסת תוכנה</dt>
            <dd className="num">{trace.engine_version}</dd>
            <dt>Hash קלט</dt>
            <dd className="num small">{trace.input_hash}</dd>
          </dl>
          <h3 style={{ marginTop: 12 }}>רגישות</h3>
          <dl>
            <dt>Lower bound</dt>
            <dd className="num">{mg(trace.sensitivity.lower_mg)}</dd>
            <dt>Expected</dt>
            <dd className="num">{mg(trace.sensitivity.expected_mg)}</dd>
            <dt>Conservative</dt>
            <dd className="num">{mg(trace.sensitivity.conservative_mg)}</dd>
            <dt>Worst-case</dt>
            <dd className="num">{mg(trace.sensitivity.worst_case_mg)}</dd>
          </dl>
          <h3 style={{ marginTop: 12 }}>מקורות</h3>
          {trace.sources.map((source: any) => (
            <details key={source.tag} style={{ marginBottom: 6 }}>
              <summary>
                {source.tag}: <span className="num">{mg(source.contribution_mg)} mG</span> ({source.calculation_method})
              </summary>
              <dl>
                <dt>זרם</dt>
                <dd className="num">
                  {source.current_a ?? 'MISSING_DATA'} A, {source.current_basis ?? 'MISSING_DATA'}
                </dd>
                <dt>מסמך מקור</dt>
                <dd>{source.source_document ? `${source.source_document.file_name} גרסה ${source.source_document.revision}` : 'הצבה ידנית'}</dd>
                <dt>נוסחה</dt>
                <dd className="num small">{source.formula}</dd>
              </dl>
              <pre>{JSON.stringify(source.input, null, 1)}</pre>
            </details>
          ))}
          {trace.excluded_sources.length > 0 && (
            <div className="notice warn">
              לא נכללו בחישוב: {trace.excluded_sources.map((item: any) => `${item.tag} (${item.reason})`).join(', ')}
            </div>
          )}
          <h3 style={{ marginTop: 12 }}>הנחות</h3>
          {trace.assumptions.length === 0 ? (
            <p className="small muted">לא נרשמו.</p>
          ) : (
            trace.assumptions.map((a: any, i: number) => (
              <p key={i} className="small">
                {a.statement}
              </p>
            ))
          )}
          <h3 style={{ marginTop: 12 }}>כלל רגולטורי</h3>
          {trace.regulation_checks.length === 0 && <p className="small">{trace.status_reasons.join(' ') || 'לא הוחל כלל.'}</p>}
          {trace.regulation_checks.map((check: any) => (
            <div key={check.rule_id} className="small" style={{ marginBottom: 6 }}>
              <strong>{check.document_name}</strong>:{' '}
              <span className="num">
                {check.compared_mg != null ? mg(check.compared_mg) : '—'} / {check.threshold_mg} mG
              </span>{' '}
              <Status status={check.status} />
              {check.normalization && (
                <div className="muted num">
                  {check.normalization.normalization_method}: {mg(check.normalization.raw_field_mg)} × {check.normalization.occupancy_hours} /{' '}
                  {check.normalization.averaging_hours} h
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </aside>
  );
}

function Results() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const base = `/projects/${id}`;
  const [runs, setRuns] = useState<any[]>([]);
  const [runId, setRunId] = useState<string>(search.get('run') ?? '');
  const [run, setRun] = useState<any>(null);
  const [floors, setFloors] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [floorId, setFloorId] = useState('');
  const [height, setHeight] = useState<number | null>(null);
  const [grid, setGrid] = useState<{ step_m: number; points: [number, number, number | null][] } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [trace, setTrace] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api(`${base}/runs`), api(`${base}/floors`), api(`${base}/rooms`), api(`${base}/sources`), api('/meta')])
      .then(([r, f, rm, s, meta]) => {
        setRuns(r);
        setFloors(f);
        setRooms(rm);
        setSources(s);
        setBands(meta.heatmap_bands);
        setRunId((current) => current || r[0]?.id || '');
      })
      .catch((failure) => setError(errorText(failure)));
  }, [base]);

  const floorsInRun = useMemo(() => {
    const names = new Set((run?.results ?? []).map((r: any) => r.floor_name));
    return floors.filter((f) => names.has(f.name));
  }, [run, floors]);

  useEffect(() => {
    if (!runId) return;
    api(`${base}/runs/${runId}`)
      .then((data) => {
        setRun(data);
        setHeight(data.heights_m[0]);
      })
      .catch((failure) => setError(errorText(failure)));
  }, [base, runId]);

  useEffect(() => {
    if (floorsInRun.length && !floorsInRun.some((f) => f.id === floorId)) setFloorId(floorsInRun[0].id);
  }, [floorsInRun, floorId]);

  const loadGrid = useCallback(() => {
    if (!runId || !floorId || height === null) return;
    api(`${base}/runs/${runId}/points?floor_id=${floorId}&height_m=${height}`)
      .then(setGrid)
      .catch((failure) => setError(errorText(failure)));
  }, [base, runId, floorId, height]);
  useEffect(loadGrid, [loadGrid]);

  const floor = floors.find((f) => f.id === floorId);
  const calibrated = floor?.scale_m_per_px && floor?.origin_px;
  const cell = calibrated && grid ? grid.step_m / floor.scale_m_per_px : 0;

  if (runs.length === 0) return <div className="card muted">אין עדיין ריצות. מריצים במסך החישוב.</div>;

  return (
    <>
      {error && <div className="notice error">{error}</div>}
      <div className="card row">
        <label className="field">
          ריצה
          <select value={runId} onChange={(e) => setRunId(e.target.value)}>
            {runs.map((item) => (
              <option key={item.id} value={item.id}>
                {new Date(item.created_at).toLocaleString('he-IL')} | {item.scenario_name} | {item.is_final ? 'סופית' : 'טיוטה'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          קומה
          <select value={floorId} onChange={(e) => setFloorId(e.target.value)}>
            {floorsInRun.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          גובה (מ׳)
          <select value={height ?? ''} onChange={(e) => setHeight(Number(e.target.value))}>
            {(run?.heights_m ?? []).map((h: number) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <span className="grow" />
        <button type="button" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}>
          −
        </button>
        <span className="small num">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>
          +
        </button>
      </div>

      {run && !run.is_final && (
        <div className="notice warn">
          ריצת טיוטה. אינה יכולה לשמש לדוח סופי.
          {run.excluded_sources.length > 0 && <> לא נכללו בחישוב: {run.excluded_sources.map((e: any) => e.tag).join(', ')}.</>}
        </div>
      )}

      {floor && calibrated && (
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Magnetic Field (mG)</h2>
          <PlanView projectId={id} floor={floor} zoom={zoom}>
            {grid?.points.map(([x, y, value], index) => {
              const [px, py] = toPixel([x, y], floor);
              return (
                <g key={index}>
                  <rect
                    x={px - cell / 2}
                    y={py - cell / 2}
                    width={cell}
                    height={cell}
                    fill={value === null ? '#888' : bandColor(value, bands)}
                    fillOpacity={0.55}
                  >
                    <title>{value === null ? 'קרוב מדי למקור, אין ערך' : `${value.toFixed(2)} mG`}</title>
                  </rect>
                  {value !== null && cell * zoom >= 24 && (
                    <text x={px} y={py} fontSize={cell * 0.3} textAnchor="middle" dominantBaseline="central" fill="#111" pointerEvents="none">
                      {value.toFixed(1)}
                    </text>
                  )}
                </g>
              );
            })}
            {rooms
              .filter((r) => r.floor_id === floorId)
              .map((room) => (
                <polygon
                  key={room.id}
                  points={pointsAttr(room.polygon_m.map((p: number[]) => toPixel(p, floor)))}
                  fill="none"
                  stroke="#111"
                  strokeWidth={2 / zoom}
                />
              ))}
            {sources
              .filter((s) => s.floor_id === floorId && s.geometry.points?.length >= 2)
              .map((source) => {
                const points = source.geometry.points.map((p: number[]) => toPixel(p, floor));
                return LINE_TYPES.includes(source.source_type) ? (
                  <polyline key={source.id} points={pointsAttr(points)} fill="none" stroke="#7e22ce" strokeWidth={3 / zoom} />
                ) : (
                  <rect
                    key={source.id}
                    x={Math.min(points[0][0], points[1][0])}
                    y={Math.min(points[0][1], points[1][1])}
                    width={Math.abs(points[1][0] - points[0][0])}
                    height={Math.abs(points[1][1] - points[0][1])}
                    fill="none"
                    stroke="#7e22ce"
                    strokeWidth={3 / zoom}
                  />
                );
              })}
          </PlanView>
          <div className="legend">
            {bands.map((band) => (
              <span key={band.label} style={{ background: band.color }}>
                {band.label}
              </span>
            ))}
          </div>
          <p className="small muted">ערכים ב-mG. טווחי הצבעים לתצוגה בלבד, ואינם קובעים סטטוס רגולטורי.</p>
        </div>
      )}

      {run && (
        <div className="card">
          <h2 style={{ marginBottom: 4 }}>טבלת תוצאות</h2>
          <p className="small muted">לחיצה על ערך מציגה את כל מקורותיו.</p>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>מס׳</th>
                  <th>קומה</th>
                  <th>חדר</th>
                  <th>גובה</th>
                  <th>שימוש</th>
                  <th>מקור דומיננטי</th>
                  <th>מרחק (מ׳)</th>
                  <th>חיזוי mG</th>
                  <th>ממוצע</th>
                  <th>Conservative</th>
                  <th>Worst-case</th>
                  <th>סיווג</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {run.results.map((result: any, index: number) => (
                  <tr key={result.id}>
                    <td>{index + 1}</td>
                    <td>{result.floor_name}</td>
                    <td>{result.room_name}</td>
                    <td className="num">{result.height_m}</td>
                    <td>{result.usage_type}</td>
                    <td>{result.dominant_source_tag ?? '—'}</td>
                    <td className="num">{mg(result.dominant_distance_m)}</td>
                    <td className="num">
                      <button type="button" className="link-button" onClick={() => setTrace(result.id)}>
                        {mg(result.max_mg)}
                      </button>
                      {result.extrapolated && <span title="מחוץ לטווח נתוני הייחוס"> *</span>}
                    </td>
                    <td className="num">{mg(result.mean_mg)}</td>
                    <td className="num">{mg(result.sensitivity?.conservative_mg)}</td>
                    <td className="num">{mg(result.sensitivity?.worst_case_mg)}</td>
                    <td>{label(OCCUPANCY_LABELS, result.occupancy_classification)}</td>
                    <td>
                      <Status status={result.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {run.results.some((r: any) => r.extrapolated) && (
            <p className="small muted">* הערך כולל אקסטרפולציה מחוץ לטווח נתוני הייחוס של שנאי או לוח.</p>
          )}
          {run.results.some((r: any) => r.too_close_points > 0) && (
            <p className="small muted">נקודות קרובות מדי למקור או בתוכו לא קיבלו ערך, ומוצגות באפור.</p>
          )}
        </div>
      )}

      {trace && <TraceDrawer projectId={id} resultId={trace} onClose={() => setTrace(null)} />}
    </>
  );
}

export default function ResultsPage() {
  return (
    <Suspense>
      <Results />
    </Suspense>
  );
}
