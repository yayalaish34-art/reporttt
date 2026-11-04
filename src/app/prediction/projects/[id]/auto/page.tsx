'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { predictionJobNumber } from '../../../actions';
import { ApiError, api, errorText, fileUrl } from '@/lib/prediction/api';
import { uploadPlan } from '@/lib/prediction/upload';

const USE_LABELS: Record<string, string> = {
  PARKING: 'חניון (אפור)',
  TECHNICAL: 'טכני (אפור)',
  RESIDENTIAL: 'מגורים (אדום)',
  OFFICE: 'משרדים (אדום)',
  COMMERCIAL: 'מסחר (אדום)',
  PUBLIC: 'ציבורי (אדום)',
  MIXED: 'מעורב (אדום)',
};
const SCALE_BASIS: Record<string, [string, string]> = {
  READ: ['נקרא מהתוכנית', 'ok'],
  INFERRED: ['הוסק, לבדיקה', 'warn'],
  USER: ['הוזן', 'ok'],
  MISSING: ['חסר', 'bad'],
};
const SHEET_LABELS: Record<string, string> = {
  ELECTRICAL: 'חשמל',
  ARCHITECTURAL: 'אדריכלות',
  SINGLE_LINE: 'חד-קווית',
  OTHER: 'אחר',
};
// Pages read at once. Each one is itself several model calls in parallel.
const PARALLEL_PAGES = 3;

type Page = { document_id: string; page: number; key: string; file_name: string };

export default function AutoPage() {
  const { id } = useParams<{ id: string }>();
  const base = `/projects/${id}`;
  const [state, setState] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState('');
  const [reading, setReading] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const [finishing, setFinishing] = useState('');
  const [result, setResult] = useState<any>(null);
  const files = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api(`${base}/auto`)
      .then(setState)
      .catch((failure) => setError(errorText(failure)));
  }, [base]);

  useEffect(load, [load]);
  useEffect(() => {
    api('/meta')
      .then(setMeta)
      .catch((failure) => setError(errorText(failure)));
  }, []);

  async function save(update: Record<string, unknown>) {
    setError('');
    try {
      setState(await api(`${base}/auto/settings`, { method: 'PUT', json: update }));
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  async function uploadAll() {
    const chosen = Array.from(files.current?.files ?? []);
    if (!chosen.length || !meta) return;
    setError('');
    try {
      for (const [index, file] of chosen.entries()) {
        setUploading(`מעלה ${index + 1} מתוך ${chosen.length}: ${file.name}`);
        await uploadPlan(id, file, 'ELECTRICAL', meta, (percentage) =>
          setUploading(`מעלה ${index + 1} מתוך ${chosen.length}: ${file.name} (${percentage}%)`),
        );
      }
      if (files.current) files.current.value = '';
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setUploading('');
      load();
    }
  }

  const pages: Page[] = (state?.documents ?? [])
    .filter((d: any) => ['pdf', 'png', 'jpg', 'jpeg'].includes(d.file_type))
    .flatMap((d: any) =>
      Array.from({ length: d.page_count }, (_, page) => ({
        document_id: d.id,
        page,
        key: `${d.id}:${page}`,
        file_name: d.page_count > 1 ? `${d.file_name} (עמוד ${page + 1})` : d.file_name,
      })),
    );
  const analysed = new Map<string, any>((state?.analyses ?? []).map((a: any) => [a.key, a]));
  const unread = pages.filter((p) => !analysed.has(p.key));

  async function read(selection: Page[]) {
    setError('');
    setResult(null);
    const queue = [...selection];
    const progress = { done: 0, total: selection.length, failed: [] as string[] };
    setReading({ ...progress });
    async function worker() {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          await api(`${base}/auto/analyze`, { method: 'POST', json: { document_id: next.document_id, page: next.page } });
        } catch (failure) {
          progress.failed.push(`${next.file_name}: ${errorText(failure)}`);
        }
        progress.done += 1;
        setReading({ ...progress, failed: [...progress.failed] });
      }
    }
    await Promise.all(Array.from({ length: PARALLEL_PAGES }, worker));
    load();
    if (!progress.failed.length) setReading(null);
  }

  async function finish() {
    setError('');
    setResult(null);
    try {
      setFinishing('בונה את המודל מהתוכניות…');
      await api(`${base}/auto/build`, { method: 'POST' });
      setFinishing('מאשר, מחשב ומפיק דוח… (עד דקה)');
      await ensureJobNumber();
      setResult(await api(`${base}/auto/finish`, { method: 'POST' }));
    } catch (failure) {
      const missing = failure instanceof ApiError && failure.missing.length ? `: ${failure.missing.join(' · ')}` : '';
      setError(errorText(failure) + missing);
    } finally {
      setFinishing('');
      load();
    }
  }

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

  if (!state) return error ? <div className="notice error">{error}</div> : <p className="muted">טוען…</p>;

  const settings = state.settings;
  const detected: any[] = state.detected;
  const kindsUsed: string[] = state.kinds_used;
  const kindHasRead = (kind: string) =>
    detected.filter((d) => (d.answer.kind || d.kind) === kind && d.answer.include !== false).every((d) => d.read_max_current_a);

  return (
    <>
      <div className="explain">
        <p>
          <strong>חיזוי אוטומטי:</strong> מעלים את תוכניות החשמל והגרמושקה, המערכת קוראת אותן (קומה, קנה מידה ומקורות קרינה),
          עונים על כמה שאלות, ובלחיצה אחת מתקבל דוח. כל מה שזוהה מוצג כאן לבדיקה לפני ההפקה.
        </p>
      </div>
      {error && <div className="notice error">{error}</div>}
      {!state.ai_available && (
        <div className="notice error">הקריאה האוטומטית לא מוגדרת בשרת (מפתח OpenAI). אפשר לעבוד בלשוניות הידניות.</div>
      )}

      <section className="card">
        <h2>1. תוכניות</h2>
        <div className="row">
          <input ref={files} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" style={{ width: 'auto' }} />
          <button className="btn-primary" onClick={uploadAll} disabled={!!uploading || !meta}>
            העלאה
          </button>
          {uploading && <span className="muted small">{uploading}</span>}
        </div>
        <p className="muted small">אפשר לבחור את כל הקבצים יחד: תוכניות חשמל לכל קומה וגרמושקה (גם כמה עמודים בקובץ אחד).</p>

        {pages.length > 0 && (
          <>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>קובץ</th>
                    <th>סוג</th>
                    <th>קומות</th>
                    <th>מקורות</th>
                    <th>הערת הקריאה</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((page) => {
                    const analysis = analysed.get(page.key);
                    return (
                      <tr key={page.key}>
                        <td>{page.file_name}</td>
                        <td>{analysis ? SHEET_LABELS[analysis.sheet_kind] ?? analysis.sheet_kind : <span className="tag">לא נקרא</span>}</td>
                        <td>{analysis?.floors?.map((f: any) => f.name).join(', ')}</td>
                        <td className="num">{analysis?.sources ?? ''}</td>
                        <td className="muted small">{analysis?.notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn-primary" disabled={!!reading || !unread.length || !state.ai_available} onClick={() => read(unread)}>
                {unread.length ? `קריאת ${unread.length} התוכניות שלא נקראו` : 'כל התוכניות נקראו'}
              </button>
              <button disabled={!!reading || !state.ai_available} onClick={() => read(pages)}>
                קריאה מחדש של הכול
              </button>
              {reading && (
                <span className="muted small">
                  קורא {reading.done} מתוך {reading.total}… (כ-30 שניות לתוכנית)
                </span>
              )}
            </div>
            {reading?.failed.length ? (
              <div className="notice error">
                {reading.failed.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>

      {state.floors.length > 0 && (
        <section className="card">
          <h2>2. קומות</h2>
          <p className="muted small">
            קומה שלא מסמנים בה אזורים נחשבת כולה לפי השימוש: חניון וטכני באפור (לא נדרש מיגון), מגורים ומשרדים באדום (שהייה
            ממושכת). לסימון עמדות ישיבה ואזורים אפורים בתוך קומה: לשונית &quot;מודל&quot; אחרי ההפקה הראשונה.
          </p>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>מפלס</th>
                  <th>קומה</th>
                  <th>תוכנית</th>
                  <th>שימוש</th>
                  <th>קנה מידה 1:</th>
                  <th>גודל המבנה (מ׳)</th>
                </tr>
              </thead>
              <tbody>
                {state.floors.map((floor: any) => {
                  const [basisText, basisTone] = SCALE_BASIS[floor.scale_basis] ?? ['', ''];
                  const name = (key: string) => pages.find((p) => p.key === key)?.file_name ?? key;
                  return (
                    <tr key={floor.level}>
                      <td className="num">{floor.level}</td>
                      <td>{floor.name}</td>
                      <td>
                        {floor.pages.length > 1 ? (
                          <select
                            value={floor.plan}
                            onChange={(e) => save({ pages: { [e.target.value]: { plan_for: floor.level } } })}
                          >
                            {floor.pages.map((key: string) => (
                              <option key={key} value={key}>
                                {name(key)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          name(floor.plan)
                        )}
                      </td>
                      <td>
                        <select value={floor.use ?? ''} onChange={(e) => save({ pages: { [floor.plan]: { use: e.target.value || null } } })}>
                          <option value="">לא זוהה (אדום)</option>
                          {state.uses.map((use: string) => (
                            <option key={use} value={use}>
                              {USE_LABELS[use] ?? use}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          style={{ width: 80 }}
                          defaultValue={floor.scale_denominator ?? ''}
                          key={`${floor.plan}:${floor.scale_denominator}`}
                          onBlur={(e) => {
                            const value = e.target.value ? Number(e.target.value) : null;
                            if (value !== floor.scale_denominator) save({ pages: { [floor.plan]: { scale_denominator: value } } });
                          }}
                        />{' '}
                        <span className={`tag ${basisTone}`}>{basisText}</span>
                      </td>
                      <td className="num">{floor.building_size_m ? `${floor.building_size_m[0]} × ${floor.building_size_m[1]}` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">גודל המבנה מחושב מקנה המידה: אם הוא לא דומה בין הקומות, קנה המידה כנראה שגוי.</p>
        </section>
      )}

      {state.floors.length > 0 && (
        <section className="card">
          <h2>3. מקורות שזוהו</h2>
          {detected.length === 0 ? (
            <p className="muted">לא זוהו מקורות קרינה בתוכניות. בדקו שהועלו תוכניות החשמל של המרתף וקומת הקרקע.</p>
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>לכלול</th>
                    <th>קומה</th>
                    <th>סוג</th>
                    <th>כתוב בתוכנית</th>
                    <th>זרם מרבי (A)</th>
                    <th>ודאות</th>
                  </tr>
                </thead>
                <tbody>
                  {detected.map((source) => (
                    <tr key={source.key} style={source.answer.include === false ? { opacity: 0.45 } : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={source.answer.include !== false}
                          onChange={(e) => save({ sources: { [source.key]: { include: e.target.checked } } })}
                        />
                      </td>
                      <td>{source.levels.join(', ')}</td>
                      <td>
                        <select
                          value={source.answer.kind || source.kind}
                          onChange={(e) => save({ sources: { [source.key]: { kind: e.target.value } } })}
                        >
                          {Object.entries(state.kinds).map(([kind, text]) => (
                            <option key={kind} value={kind}>
                              {text as string}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="small">
                        {source.label}
                        {source.rating_text ? ` · ${source.rating_text}` : ''}
                      </td>
                      <td>
                        <input
                          type="number"
                          style={{ width: 90 }}
                          placeholder={source.max_current_a ? String(source.max_current_a) : 'לפי הסוג'}
                          defaultValue={source.answer.max_current_a ?? ''}
                          onBlur={(e) => {
                            const value = e.target.value ? Number(e.target.value) : null;
                            if (value !== (source.answer.max_current_a ?? null)) save({ sources: { [source.key]: { max_current_a: value } } });
                          }}
                        />
                      </td>
                      <td>
                        {source.confidence === 'LOW' ? (
                          <span className="tag warn">לבדיקה</span>
                        ) : (
                          <span className="tag ok">{source.confidence === 'HIGH' ? 'גבוהה' : 'בינונית'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {state.floors.length > 0 && (
        <section className="card">
          <h2>4. שאלות</h2>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <NumberField label="גובה קומה טיפוסית (מ׳)" value={settings.floor_height_m} onSave={(v) => save({ floor_height_m: v })} />
            <NumberField label="גובה קומת מרתף (מ׳)" value={settings.basement_height_m} onSave={(v) => save({ basement_height_m: v })} />
            <NumberField
              label="זרם אופייני: % מהזרם המרבי"
              value={settings.typical_load_pct}
              onSave={(v) => save({ typical_load_pct: v })}
            />
            {kindsUsed
              .filter((kind) => !kindHasRead(kind))
              .map((kind) => (
                <NumberField
                  key={kind}
                  label={`זרם מרבי: ${state.kinds[kind]} (A)`}
                  value={settings.kinds?.[kind]?.max_current_a ?? null}
                  onSave={(v) => save({ kinds: { [kind]: { max_current_a: v } } })}
                />
              ))}
          </div>
          <p className="muted small">
            זרם מרבי לפי סוג חל על כל המקורות מאותו סוג שאין להם זרם כתוב בתוכנית או זרם שהוזן בטבלה. בשנאי, הזרם מחושב מההספק
            (kVA) כשהוא כתוב בתוכנית.
          </p>
        </section>
      )}

      {state.floors.length > 0 && (
        <section className="card">
          <h2>5. הפקה</h2>
          {state.missing.length > 0 ? (
            <div className="notice">
              חסר כדי להפיק:
              <ul>
                {state.missing.map((item: any) => (
                  <li key={item.field}>{item.message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted small">
              הלחיצה מאשרת את המקורות שסומנו &quot;לכלול&quot; ואת המודל, מריצה חישוב בגובה 1 מ׳ ומפיקה דוח. ערכים שלא באו
              מהתוכניות או מהתשובות נרשמים בדוח כהנחות הנדסיות.
            </p>
          )}
          <div className="row">
            <button className="btn-primary" disabled={!!finishing || state.missing.length > 0} onClick={finish}>
              אישור והפקת דוח
            </button>
            {finishing && <span className="muted small">{finishing}</span>}
          </div>
          {result && (
            <div className="notice" style={{ marginTop: 8 }}>
              <p>
                <strong>הדוח הופק (גרסה {result.report.version}).</strong>{' '}
                <a href={fileUrl(`${base}/reports/${result.report.id}/file`)}>הורדת הדוח</a>
              </p>
              {result.blockers.length > 0 && (
                <p className="small">
                  הדוח מסומן כטיוטה עד שיושלמו: {summarise(result.blockers)}.{' '}
                  {result.blockers.some((b: any) => b.code === 'REGULATION_RULE') && (
                    <>
                      את הסף (למשל 4 mG) מפעילים ב<Link href="/prediction/regulation">רגולציה</Link>.
                    </>
                  )}
                </p>
              )}
              <p className="small">
                <Link href={`/prediction/projects/${id}/results`}>תוצאות ומפות</Link> ·{' '}
                <Link href={`/prediction/projects/${id}/model`}>תיקון מקורות וסימון אזורים על התוכנית</Link> ·{' '}
                <Link href={`/prediction/projects/${id}/report`}>אישור והנפקת הדוח</Link>
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** Blockers of one kind counted once, so twenty rooms without a rule read as one line. */
function summarise(blockers: any[]): string {
  const counts = new Map<string, { text: string; count: number }>();
  for (const blocker of blockers) {
    const entry = counts.get(blocker.code);
    if (entry) entry.count += 1;
    else counts.set(blocker.code, { text: blocker.message.split(': ').pop() ?? blocker.message, count: 1 });
  }
  return Array.from(counts.values())
    .map(({ text, count }) => (count > 1 ? `${text} (${count})` : text))
    .join(' · ');
}

function NumberField({ label, value, onSave }: { label: string; value: number | null; onSave: (value: number | null) => void }) {
  return (
    <label className="field" style={{ minWidth: 170 }}>
      {label}
      <input
        type="number"
        step="any"
        defaultValue={value ?? ''}
        key={String(value)}
        onBlur={(e) => {
          const next = e.target.value ? Number(e.target.value) : null;
          if (next !== value) onSave(next);
        }}
      />
    </label>
  );
}
