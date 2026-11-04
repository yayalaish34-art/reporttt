'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PlanView } from '@/app/prediction/plan-view';
import { ApiError, api, errorText } from '@/lib/prediction/api';
import { Point, pointsAttr, toPixel, toWorld } from '@/lib/prediction/geometry';
import { BOX_TYPES, LINE_TYPES, OCCUPANCY_LABELS, SOURCE_LABELS, label } from '@/lib/prediction/labels';
import { SourceForm } from './source-form';

type Tool = 'select' | 'calibrate' | 'origin' | 'room' | 'line' | 'box';
type Selection = { kind: 'room' | 'source'; id: string } | null;

const HINTS: Record<Tool, string> = {
  select: 'לחיצה על רכיב לבחירה. גרירה מזיזה אותו.',
  calibrate: 'לחיצה על שתי נקודות במידה ידועה, ואז הזנת האורך.',
  origin: 'לחיצה על נקודה שמופיעה בכל הקומות (למשל עמוד). יש לבחור את אותה נקודה בכל קומה.',
  room: 'לחיצות ליצירת פוליגון. לחיצה כפולה או "סיום חדר" לסגירה.',
  line: 'לחיצות לאורך התוואי. לחיצה כפולה או "סיום" לסיום.',
  box: 'לחיצה על שתי פינות נגדיות של הגוף.',
};

function polygonArea(points: Point[]): number {
  return (
    Math.abs(
      points.reduce((sum, [x, y], i) => {
        const [nx, ny] = points[(i + 1) % points.length];
        return sum + x * ny - nx * y;
      }, 0),
    ) / 2
  );
}

export default function ModelPage() {
  const { id } = useParams<{ id: string }>();
  const base = `/projects/${id}`;
  const [project, setProject] = useState<any>(null);
  const [floors, setFloors] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [blockers, setBlockers] = useState<any[]>([]);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [draft, setDraft] = useState<Point[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [distance, setDistance] = useState('');
  const [pendingName, setPendingName] = useState('');
  const [newType, setNewType] = useState('THREE_PHASE_CABLE');
  const [drag, setDrag] = useState<{ start: Point; delta: Point } | null>(null);
  const [newFloor, setNewFloor] = useState({ name: '', plan_document_id: '', plan_page: '0' });

  const load = useCallback(async () => {
    const [p, f, r, s, d, b] = await Promise.all([
      api(base),
      api(`${base}/floors`),
      api(`${base}/rooms`),
      api(`${base}/sources`),
      api(`${base}/documents`),
      api(`${base}/readiness`),
    ]);
    setProject(p);
    setFloors(f);
    setRooms(r);
    setSources(s);
    setDocuments(d);
    setBlockers(b.blockers);
    setFloorId((current) => current ?? f[0]?.id ?? null);
  }, [base]);

  useEffect(() => {
    load().catch((failure) => setError(errorText(failure)));
    api('/meta')
      .then(setMeta)
      .catch(() => undefined);
  }, [load]);

  const floor = floors.find((f) => f.id === floorId) ?? null;
  const calibrated = !!(floor?.scale_m_per_px && floor?.origin_px);
  const viewable = documents.filter((d) => d.viewable && d.status === 'CURRENT');
  const newFloorDocument = viewable.find((d) => d.id === newFloor.plan_document_id);
  const selectedSource = selection?.kind === 'source' ? sources.find((s) => s.id === selection.id) : null;
  const selectedRoom = selection?.kind === 'room' ? rooms.find((r) => r.id === selection.id) : null;

  // Pixels here are only ever derived from the stored metres, through the floor's calibration.
  const px = useCallback((world: number[]) => toPixel(world, floor), [floor]);
  const stroke = 3 / zoom;
  const fontSize = 22 / zoom;

  const nextTag = useMemo(() => {
    const prefix = newType === 'TRANSFORMER' ? 'TR' : BOX_TYPES.includes(newType) ? 'PNL' : newType === 'BUSBAR' ? 'BUS' : 'Cable';
    let i = 1;
    while (sources.some((s) => s.tag === `${prefix}-${String(i).padStart(2, '0')}`)) i++;
    return `${prefix}-${String(i).padStart(2, '0')}`;
  }, [sources, newType]);

  async function act(run: () => Promise<unknown>) {
    setError('');
    try {
      await run();
      await load();
    } catch (failure) {
      const missing = failure instanceof ApiError && failure.missing.length ? `: ${failure.missing.join(' · ')}` : '';
      setError(errorText(failure) + missing);
      await load().catch(() => undefined);
    }
  }

  function pickTool(next: Tool) {
    setTool(next);
    setDraft([]);
    setPendingName('');
    setDistance('');
    if (next !== 'select') setSelection(null);
  }

  const finishLine = () =>
    act(async () => {
      if (draft.length < 2) return;
      const world = draft.map((p) => toWorld(p, floor));
      await api(`${base}/sources`, { method: 'POST', json: { floor_id: floor.id, tag: nextTag, source_type: newType, points: world } });
      setDraft([]);
    });

  function handlePoint(point: Point) {
    if (tool === 'select') return;
    if (tool === 'origin') {
      act(async () => {
        await api(`${base}/floors/${floor.id}/origin`, { method: 'POST', json: { origin_px: point } });
        setTool('select');
      });
      return;
    }
    if (tool === 'calibrate') {
      setDraft((current) => (current.length >= 2 ? [point] : [...current, point]));
      return;
    }
    if (tool === 'box') {
      const next = [...draft, point];
      if (next.length < 2) {
        setDraft(next);
        return;
      }
      act(async () => {
        const world = next.map((p) => toWorld(p, floor));
        await api(`${base}/sources`, { method: 'POST', json: { floor_id: floor.id, tag: nextTag, source_type: newType, points: world } });
        setDraft([]);
      });
      return;
    }
    setDraft((current) => [...current, point]);
  }

  function startDrag(event: React.MouseEvent, selected: Selection) {
    if (tool !== 'select') return;
    event.stopPropagation();
    setSelection(selected);
    const svg = (event.target as Element).closest('svg')!;
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const start: Point = [((event.clientX - rect.left) / rect.width) * viewBox.width, ((event.clientY - rect.top) / rect.height) * viewBox.height];
    setDrag({ start, delta: [0, 0] });
  }

  function finishDrag() {
    if (!drag || !selection) return setDrag(null);
    const [dx, dy] = drag.delta;
    setDrag(null);
    if (Math.hypot(dx, dy) < 3) return;
    const shift = (p: number[]) => toWorld([px(p)[0] + dx, px(p)[1] + dy], floor);
    if (selection.kind === 'room') {
      const room = rooms.find((r) => r.id === selection.id);
      act(() => api(`${base}/rooms/${room.id}`, { method: 'PATCH', json: { polygon_m: room.polygon_m.map(shift), reason: 'הזזה בתוכנית' } }));
    } else {
      const source = sources.find((s) => s.id === selection.id);
      act(() =>
        api(`${base}/sources/${source.id}`, { method: 'PATCH', json: { points: source.geometry.points.map(shift), reason: 'הזזה בתוכנית' } }),
      );
    }
  }

  const offsetOf = (kind: string, rowId: string): Point =>
    drag && selection?.kind === kind && selection.id === rowId ? drag.delta : [0, 0];

  return (
    <>
      {error && <div className="notice error">{error}</div>}

      <div className="card">
        <div className="row">
          <label className="field">
            קומה
            <select
              value={floorId ?? ''}
              onChange={(e) => {
                setFloorId(e.target.value);
                setDraft([]);
                setSelection(null);
              }}
            >
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          {floor && (
            <>
              <label className="field">
                גובה מפלס (מ׳)
                <input
                  type="number"
                  step="any"
                  className="num"
                  style={{ width: 110 }}
                  placeholder="MISSING_DATA"
                  defaultValue={floor.elevation_m ?? ''}
                  key={`${floor.id}-${floor.elevation_m}`}
                  onBlur={(e) => {
                    const value = e.target.value === '' ? null : Number(e.target.value);
                    if (value !== floor.elevation_m) act(() => api(`${base}/floors/${floor.id}`, { method: 'PATCH', json: { elevation_m: value } }));
                  }}
                />
              </label>
              <span className="small muted">
                {floor.scale_m_per_px ? <span className="num">1 px = {(floor.scale_m_per_px * 100).toFixed(2)} cm</span> : 'לא מכויל'}
                {' | '}
                {floor.origin_px ? 'נקודת ייחוס מוגדרת' : 'אין נקודת ייחוס'}
              </span>
            </>
          )}
          <span className="grow" />
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                const created = await api(`${base}/floors`, {
                  method: 'POST',
                  json: {
                    name: newFloor.name,
                    sort_order: floors.length,
                    plan_document_id: newFloor.plan_document_id || null,
                    plan_page: Number(newFloor.plan_page),
                  },
                });
                setFloorId(created.id);
                setNewFloor({ name: '', plan_document_id: '', plan_page: '0' });
              });
            }}
          >
            <input placeholder="שם קומה חדשה" required value={newFloor.name} onChange={(e) => setNewFloor({ ...newFloor, name: e.target.value })} />
            <select
              required
              value={newFloor.plan_document_id}
              onChange={(e) => setNewFloor({ ...newFloor, plan_document_id: e.target.value, plan_page: '0' })}
            >
              <option value="">תוכנית</option>
              {viewable.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.file_name} (גרסה {d.revision})
                </option>
              ))}
            </select>
            {(newFloorDocument?.page_count ?? 1) > 1 && (
              <select value={newFloor.plan_page} onChange={(e) => setNewFloor({ ...newFloor, plan_page: e.target.value })}>
                {Array.from({ length: newFloorDocument.page_count }, (_, i) => (
                  <option key={i} value={i}>
                    עמוד {i + 1}
                  </option>
                ))}
              </select>
            )}
            <button>הוספת קומה</button>
          </form>
        </div>
      </div>

      {floors.length === 0 && (
        <div className="card muted">
          {viewable.length === 0 ? 'יש להעלות קודם תוכנית (PDF, PNG או JPG) במסך המסמכים.' : 'יש להוסיף קומה ולבחור לה תוכנית.'}
        </div>
      )}

      {floor && (
        <div className="editor">
          <div>
            <div className="row" style={{ marginBottom: 8 }}>
              {(
                [
                  ['select', 'בחירה'],
                  ['calibrate', 'כיול'],
                  ['origin', 'נקודת ייחוס'],
                  ['room', 'חדר'],
                  ['line', 'כבל / תוואי'],
                  ['box', 'שנאי / לוח'],
                ] as [Tool, string][]
              ).map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  className={tool === value ? 'active' : ''}
                  disabled={(value === 'origin' && !floor.scale_m_per_px) || ((value === 'room' || value === 'line' || value === 'box') && !calibrated)}
                  onClick={() => {
                    pickTool(value);
                    if (value === 'line' && !LINE_TYPES.includes(newType)) setNewType('THREE_PHASE_CABLE');
                    if (value === 'box' && !BOX_TYPES.includes(newType)) setNewType('TRANSFORMER');
                  }}
                >
                  {text}
                </button>
              ))}
              <span className="grow" />
              <button type="button" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}>
                −
              </button>
              <span className="small num">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>
                +
              </button>
            </div>
            <p className="small muted">{HINTS[tool]}</p>

            {(tool === 'line' || tool === 'box') && (
              <div className="row" style={{ marginBottom: 8 }}>
                <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                  {(tool === 'line' ? LINE_TYPES : BOX_TYPES).map((type) => (
                    <option key={type} value={type}>
                      {SOURCE_LABELS[type]}
                    </option>
                  ))}
                </select>
                <span className="small muted">התג הבא: {nextTag}</span>
                {tool === 'line' && (
                  <button type="button" className="btn-primary" disabled={draft.length < 2} onClick={finishLine}>
                    סיום
                  </button>
                )}
              </div>
            )}

            {tool === 'calibrate' && draft.length === 2 && (
              <form
                className="row"
                style={{ marginBottom: 8 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    await api(`${base}/floors/${floor.id}/calibrate`, {
                      method: 'POST',
                      json: { p1: draft[0], p2: draft[1], distance_m: Number(distance) },
                    });
                    pickTool(floor.origin_px ? 'select' : 'origin');
                  });
                }}
              >
                <label className="field">
                  האורך האמיתי בין הנקודות (מ׳)
                  <input
                    autoFocus
                    required
                    type="number"
                    min="0"
                    step="any"
                    className="num"
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                  />
                </label>
                <button className="btn-primary">שמירת כיול</button>
              </form>
            )}

            {tool === 'room' && draft.length >= 3 && (
              <form
                className="row"
                style={{ marginBottom: 8 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    const polygon = draft.map((p) => toWorld(p, floor));
                    await api(`${base}/rooms`, { method: 'POST', json: { floor_id: floor.id, name: pendingName, polygon_m: polygon } });
                    setDraft([]);
                    setPendingName('');
                  });
                }}
              >
                <input required placeholder="שם החדר" value={pendingName} onChange={(e) => setPendingName(e.target.value)} />
                <span className="small muted num">{polygonArea(draft.map((p) => toWorld(p, floor))).toFixed(1)} מ״ר</span>
                <button className="btn-primary">סיום חדר</button>
              </form>
            )}

            <PlanView
              projectId={id}
              floor={floor}
              zoom={zoom}
              crosshair={tool !== 'select'}
              onPoint={handlePoint}
              onDoubleClick={() => tool === 'line' && finishLine()}
              onMove={(point) => drag && setDrag({ ...drag, delta: [point[0] - drag.start[0], point[1] - drag.start[1]] })}
              onRelease={finishDrag}
            >
              {calibrated &&
                sources
                  .filter((s) => s.floor_id !== floor.id && s.geometry.points?.length >= 2)
                  .map((s) => (
                    <g key={s.id} opacity={0.45}>
                      <polyline
                        points={pointsAttr(s.geometry.points.map(px))}
                        fill="none"
                        stroke="#555"
                        strokeWidth={stroke}
                        strokeDasharray={`${12 / zoom} ${8 / zoom}`}
                      />
                      <text x={px(s.geometry.points[0])[0]} y={px(s.geometry.points[0])[1]} fontSize={fontSize * 0.8} fill="#555">
                        {s.tag} (קומה אחרת)
                      </text>
                    </g>
                  ))}

              {calibrated &&
                rooms
                  .filter((r) => r.floor_id === floor.id)
                  .map((room) => {
                    const [dx, dy] = offsetOf('room', room.id);
                    const points = room.polygon_m.map(px).map(([x, y]: Point) => [x + dx, y + dy] as Point);
                    const isSelected = selection?.kind === 'room' && selection.id === room.id;
                    return (
                      <g
                        key={room.id}
                        onMouseDown={(event) => startDrag(event, { kind: 'room', id: room.id })}
                        style={{ cursor: tool === 'select' ? 'move' : undefined }}
                      >
                        <polygon
                          points={pointsAttr(points)}
                          fill={isSelected ? 'rgba(31,95,168,.25)' : 'rgba(31,95,168,.1)'}
                          stroke="#1f5fa8"
                          strokeWidth={stroke}
                        />
                        <text x={points[0][0] + 8} y={points[0][1] + fontSize * 1.2} fontSize={fontSize} fill="#1f5fa8">
                          {room.name}
                        </text>
                      </g>
                    );
                  })}

              {calibrated &&
                sources
                  .filter((s) => s.floor_id === floor.id && s.geometry.points?.length >= 2)
                  .map((source) => {
                    const [dx, dy] = offsetOf('source', source.id);
                    const points = source.geometry.points.map(px).map(([x, y]: Point) => [x + dx, y + dy] as Point);
                    const isSelected = selection?.kind === 'source' && selection.id === source.id;
                    const color = source.missing.length ? '#b3261e' : '#7e22ce';
                    const isLine = LINE_TYPES.includes(source.source_type);
                    return (
                      <g
                        key={source.id}
                        onMouseDown={(event) => startDrag(event, { kind: 'source', id: source.id })}
                        style={{ cursor: tool === 'select' ? 'move' : undefined }}
                      >
                        {isLine ? (
                          <>
                            <polyline points={pointsAttr(points)} fill="none" stroke="transparent" strokeWidth={stroke * 6} />
                            <polyline points={pointsAttr(points)} fill="none" stroke={color} strokeWidth={isSelected ? stroke * 2.2 : stroke * 1.4} />
                          </>
                        ) : (
                          <rect
                            x={Math.min(points[0][0], points[1][0])}
                            y={Math.min(points[0][1], points[1][1])}
                            width={Math.abs(points[1][0] - points[0][0])}
                            height={Math.abs(points[1][1] - points[0][1])}
                            fill={isSelected ? 'rgba(126,34,206,.3)' : 'rgba(126,34,206,.12)'}
                            stroke={color}
                            strokeWidth={stroke * 1.4}
                          />
                        )}
                        <text x={points[0][0]} y={points[0][1] - 6 / zoom} fontSize={fontSize} fill={color} fontWeight="bold">
                          {source.tag}
                        </text>
                      </g>
                    );
                  })}

              {floor.origin_px && (
                <g stroke="#0369a1" strokeWidth={stroke}>
                  <line x1={floor.origin_px[0] - 16 / zoom} y1={floor.origin_px[1]} x2={floor.origin_px[0] + 16 / zoom} y2={floor.origin_px[1]} />
                  <line x1={floor.origin_px[0]} y1={floor.origin_px[1] - 16 / zoom} x2={floor.origin_px[0]} y2={floor.origin_px[1] + 16 / zoom} />
                </g>
              )}

              {draft.length > 0 && (
                <g>
                  <polyline points={pointsAttr(draft)} fill="none" stroke="#dc2626" strokeWidth={stroke} strokeDasharray={`${8 / zoom} ${6 / zoom}`} />
                  {draft.map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r={5 / zoom} fill="#dc2626" />
                  ))}
                </g>
              )}
            </PlanView>
          </div>

          <aside>
            <div className="card">
              <h2 style={{ marginBottom: 8 }}>אימות המודל</h2>
              {project?.model_verified ? (
                <div className="notice ok">MODEL VERIFIED</div>
              ) : (
                <div className="notice warn">המודל טרם אושר. לפני חיזוי סופי יש לבדוק שכל המקורות והחדרים תואמים לתוכניות.</div>
              )}
              <button
                type="button"
                className={project?.model_verified ? '' : 'btn-primary'}
                onClick={() => act(() => api(`${base}/verify-model`, { method: 'POST', json: { verified: !project?.model_verified } }))}
              >
                {project?.model_verified ? 'ביטול אישור' : 'אישור MODEL VERIFIED'}
              </button>
              <p className="small muted" style={{ marginTop: 8 }}>
                פתוחים {blockers.length} פריטים. הם מפורטים במסך השאלות.
              </p>
            </div>

            {selectedSource && meta && (
              <div className="card">
                <SourceForm
                  source={selectedSource}
                  models={meta.empirical_model_types}
                  onChange={(field, value) => act(() => api(`${base}/sources/${selectedSource.id}`, { method: 'PATCH', json: { [field]: value } }))}
                  onDelete={() =>
                    act(async () => {
                      await api(`${base}/sources/${selectedSource.id}`, { method: 'DELETE' });
                      setSelection(null);
                    })
                  }
                />
              </div>
            )}

            {selectedRoom && (
              <div className="card">
                <h3 style={{ margin: '0 0 4px' }}>{selectedRoom.name}</h3>
                <p className="small muted num">{selectedRoom.area_m2.toFixed(1)} מ״ר</p>
                <label className="field">
                  סיווג שהייה
                  <select
                    value={selectedRoom.occupancy_classification}
                    onChange={(e) =>
                      act(() => api(`${base}/rooms/${selectedRoom.id}`, { method: 'PATCH', json: { occupancy_classification: e.target.value } }))
                    }
                  >
                    {Object.entries(OCCUPANCY_LABELS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                {!selectedRoom.occupancy_confirmed && (
                  <p className="small muted">הצעת המערכת: {label(OCCUPANCY_LABELS, selectedRoom.suggested_occupancy)}. נדרש אישור.</p>
                )}
                <label className="field" style={{ marginTop: 8 }}>
                  שעות שהייה ביום
                  <input
                    type="number"
                    min="0"
                    max="24"
                    step="any"
                    className="num"
                    placeholder="MISSING_DATA"
                    defaultValue={selectedRoom.hours_per_day ?? ''}
                    key={`${selectedRoom.id}-${selectedRoom.hours_per_day}`}
                    onBlur={(e) => {
                      const value = e.target.value === '' ? null : Number(e.target.value);
                      if (value !== selectedRoom.hours_per_day)
                        act(() => api(`${base}/rooms/${selectedRoom.id}`, { method: 'PATCH', json: { hours_per_day: value } }));
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn-danger"
                  style={{ marginTop: 10 }}
                  onClick={() =>
                    act(async () => {
                      await api(`${base}/rooms/${selectedRoom.id}`, { method: 'DELETE' });
                      setSelection(null);
                    })
                  }
                >
                  מחיקת חדר
                </button>
              </div>
            )}

            <div className="card small">
              <h3 style={{ margin: '0 0 6px' }}>מקורות ({sources.length})</h3>
              {sources.map((s) => (
                <div key={s.id} className="row">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setFloorId(s.floor_id);
                      setSelection({ kind: 'source', id: s.id });
                      setTool('select');
                    }}
                  >
                    {s.tag}
                  </button>
                  {s.missing.length ? <span className="tag warn">MISSING_DATA</span> : <span className="tag ok">מלא</span>}
                </div>
              ))}
              <h3 style={{ margin: '10px 0 6px' }}>חדרים ({rooms.length})</h3>
              {rooms.map((r) => (
                <div key={r.id} className="row">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setFloorId(r.floor_id);
                      setSelection({ kind: 'room', id: r.id });
                      setTool('select');
                    }}
                  >
                    {r.name}
                  </button>
                  {r.occupancy_confirmed ? (
                    <span className="tag ok">{label(OCCUPANCY_LABELS, r.occupancy_classification)}</span>
                  ) : (
                    <span className="tag warn">לא אושר</span>
                  )}
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
