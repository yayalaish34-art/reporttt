'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { predictionJobNumber } from '../../../actions';
import { FlowSteps } from '../../../flow-steps';
import { ProjectForm } from '../../../project-form';
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
// Only these are read automatically; a single-line diagram is kept for the engineer.
const READ_TYPES = ['ELECTRICAL', 'ARCHITECTURAL'];
// Pages read at once. Each one is itself several model calls in parallel.
const PARALLEL_PAGES = 3;

/** The questions asked before any plan is read. Each applies to every source of its kind. */
const KIND_QUESTIONS: { kind: string; field: 'kva' | 'max_current_a'; label: string; hint: string }[] = [
  { kind: 'TRANSFORMER', field: 'kva', label: 'הספק כל שנאי (kVA)', hint: 'למשל 630. ריק אם אין שנאי במבנה' },
  { kind: 'FEEDER', field: 'max_current_a', label: 'זרם מרבי בקו הזנה ראשי (A)', hint: 'מהשנאי או מחברת החשמל ללוחות' },
  { kind: 'RISER', field: 'max_current_a', label: 'זרם מרבי בפיר ההזנה לקומות (A)', hint: 'סך הכבלים העולים בפיר אחד' },
  { kind: 'METER_BOARD', field: 'max_current_a', label: 'זרם מרבי בלוח מונים (A)', hint: 'לכל ריכוז מונים' },
  { kind: 'DISTRIBUTION_PILLAR', field: 'max_current_a', label: 'זרם מרבי בפילר חלוקה (A)', hint: 'ריק אם אין' },
  { kind: 'MAIN_BOARD', field: 'max_current_a', label: 'זרם מרבי בלוח ראשי / ציבורי (A)', hint: 'ריק אם אין' },
  { kind: 'EV_CHARGING', field: 'max_current_a', label: 'זרם מרבי בלוח טעינת רכבים (A)', hint: 'ריק אם אין' },
];

const DOCUMENT_GROUPS = [
  {
    type: 'ELECTRICAL',
    title: 'תוכניות חשמל (חובה)',
    points: [
      'קובץ PDF לכל קומה: כל המרתפים, קומת הקרקע, כל הקומות והגג הטכני.',
      'החשובות ביותר: הקומות של חדר השנאים, ריכוזי המונים, הפילרים, הלוח הראשי וקווי ההזנה הראשיים. בדרך כלל המרתף וקומת הקרקע.',
      'קומה טיפוסית: תוכנית אחת מספיקה, עם הקומות בשם הקובץ, למשל "קומות 3-4".',
      'שם הקובץ עם שם הקומה: "מרתף 1-", "קומת קרקע", "קומה 1".',
      'PDF מקורי מתוכנת השרטוט, לא סריקה ולא צילום, וגיליון שלם עם טבלת הכותרת (בה כתוב קנה המידה).',
    ],
  },
  {
    type: 'ARCHITECTURAL',
    title: 'גרמושקה (חובה)',
    points: [
      'תוכנית ההיתר האדריכלית, PDF, עם כל הקומות כולל המרתפים.',
      'אפשר קובץ אחד עם כמה עמודים, או קובץ לכל קומה.',
      'משמשת לקומות שאין להן תוכנית חשמל, ולהתאמת הקומות זו מעל זו.',
    ],
  },
  {
    type: 'SINGLE_LINE',
    title: 'סכמה חד-קווית (רשות)',
    points: [
      'לא נקראת אוטומטית. נשמרת בפרויקט ועוזרת לענות על שאלות הזרמים למטה.',
      'אם אין, אפשר לדלג.',
    ],
  },
];

type Page = { document_id: string; page: number; key: string; file_name: string };

export default function AutoPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const base = `/projects/${id}`;
  const [state, setState] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [step, setStep] = useState<number | null>(Number(search.get('step')) || null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api(`${base}/auto`)
      .then(setState)
      .catch((failure) => setError(errorText(failure)));
  }, [base]);

  useEffect(load, [load]);
  useEffect(() => {
    api(base)
      .then(setProject)
      .catch((failure) => setError(errorText(failure)));
    api('/meta')
      .then(setMeta)
      .catch((failure) => setError(errorText(failure)));
  }, [base]);

  // Opens where the work is: documents until there are electrical plans, then the prediction.
  useEffect(() => {
    if (step !== null || !state) return;
    const hasElectrical = state.documents.some((d: any) => d.document_type === 'ELECTRICAL');
    setStep(hasElectrical && generalAnswered(state.settings) ? 3 : 2);
  }, [state, step]);

  async function save(update: Record<string, unknown>) {
    setError('');
    try {
      setState(await api(`${base}/auto/settings`, { method: 'PUT', json: update }));
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  if (!state || !project || step === null) return error ? <div className="notice error">{error}</div> : <p className="muted">טוען…</p>;

  const hasElectrical = state.documents.some((d: any) => d.document_type === 'ELECTRICAL');
  const stepTwoDone = hasElectrical && generalAnswered(state.settings);

  return (
    <>
      <FlowSteps current={step} reachable={stepTwoDone ? 3 : 2} onPick={setStep} />
      {error && <div className="notice error">{error}</div>}

      {step === 1 && (
        <section className="card">
          <h2>1. פרטי הפרויקט</h2>
          <p className="muted small">הלקוח, כתובת המבנה וסוג המבנה. הפרטים מופיעים בדוח.</p>
          <ProjectForm
            key={project.id}
            project={project}
            onSaved={(updated) => {
              setProject(updated);
              setStep(2);
            }}
          />
        </section>
      )}

      {step === 2 && (
        <DocumentsAndQuestions
          id={id}
          base={base}
          state={state}
          meta={meta}
          save={save}
          reload={load}
          onError={setError}
          ready={stepTwoDone}
          hasElectrical={hasElectrical}
          next={() => setStep(3)}
        />
      )}

      {step === 3 && <Prediction id={id} base={base} state={state} save={save} reload={load} onError={setError} />}
    </>
  );
}

function generalAnswered(settings: any): boolean {
  return settings.floor_height_m != null && settings.basement_height_m != null && settings.typical_load_pct != null;
}

// ── Step 2 ───────────────────────────────────────────────────────────────

function DocumentsAndQuestions({
  id,
  state,
  meta,
  save,
  reload,
  onError,
  ready,
  hasElectrical,
  next,
}: {
  id: string;
  base: string;
  state: any;
  meta: any;
  save: (update: Record<string, unknown>) => Promise<void>;
  reload: () => void;
  onError: (message: string) => void;
  ready: boolean;
  hasElectrical: boolean;
  next: () => void;
}) {
  const settings = state.settings;
  const hasArchitectural = state.documents.some((d: any) => d.document_type === 'ARCHITECTURAL');

  return (
    <>
      <section className="card">
        <h2>2. מסמכים</h2>
        <p className="muted small">כל סוג מסמך מעלים בתיבה שלו. אפשר לבחור כמה קבצים יחד.</p>
        <div className="doc-groups">
          {DOCUMENT_GROUPS.map((group) => (
            <DocumentGroup
              key={group.type}
              id={id}
              group={group}
              meta={meta}
              files={state.documents.filter((d: any) => d.document_type === group.type)}
              reload={reload}
              onError={onError}
            />
          ))}
        </div>
        {hasElectrical && !hasArchitectural && (
          <div className="notice" style={{ marginTop: 10 }}>
            לא הועלתה גרמושקה. אפשר להמשיך, אבל קומות בלי תוכנית חשמל לא ייכללו, והתאמת הקומות פחות מדויקת.
          </div>
        )}
      </section>

      <section className="card">
        <h2>שאלות</h2>
        <p className="muted small">
          התשובות חלות על כל המקורות מאותו סוג שיזוהו בתוכניות. מקור שהזרם או ההספק שלו כתובים בתוכנית יקבל את הכתוב בה.
        </p>
        <h3 style={{ fontSize: 15, margin: '8px 0 4px' }}>המבנה</h3>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <NumberField
            label="גובה קומה טיפוסית (מ׳)"
            hint="מרצפה לרצפה, למשל 3.2"
            value={settings.floor_height_m}
            onSave={(v) => save({ floor_height_m: v })}
          />
          <NumberField
            label="גובה קומת מרתף (מ׳)"
            hint="מרצפה לרצפה, למשל 3.5"
            value={settings.basement_height_m}
            onSave={(v) => save({ basement_height_m: v })}
          />
          <NumberField
            label="זרם אופייני: % מהזרם המרבי"
            hint="החישוב נעשה בזרם הזה, למשל 60"
            value={settings.typical_load_pct}
            onSave={(v) => save({ typical_load_pct: v })}
          />
        </div>
        <h3 style={{ fontSize: 15, margin: '12px 0 4px' }}>מקורות החשמל</h3>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {KIND_QUESTIONS.map((question) => (
            <NumberField
              key={question.kind}
              label={question.label}
              hint={question.hint}
              value={settings.kinds?.[question.kind]?.[question.field] ?? null}
              onSave={(v) => save({ kinds: { [question.kind]: { [question.field]: v } } })}
            />
          ))}
        </div>
      </section>

      <div className="row">
        <button className="btn-primary" disabled={!ready} onClick={next}>
          המשך לחיזוי אוטומטי
        </button>
        {!ready && (
          <span className="muted small">
            {hasElectrical ? 'חסרות תשובות על המבנה (גבהים ואחוז זרם).' : 'יש להעלות לפחות תוכנית חשמל אחת.'}
          </span>
        )}
      </div>
    </>
  );
}

function DocumentGroup({
  id,
  group,
  meta,
  files,
  reload,
  onError,
}: {
  id: string;
  group: (typeof DOCUMENT_GROUPS)[number];
  meta: any;
  files: any[];
  reload: () => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');

  async function upload() {
    const chosen = Array.from(input.current?.files ?? []);
    if (!chosen.length || !meta) return;
    onError('');
    try {
      for (const [index, file] of chosen.entries()) {
        const prefix = chosen.length > 1 ? `${index + 1}/${chosen.length} ` : '';
        setBusy(`${prefix}${file.name}`);
        await uploadPlan(id, file, group.type, meta, (percentage) => setBusy(`${prefix}${file.name} (${percentage}%)`));
      }
      if (input.current) input.current.value = '';
    } catch (failure) {
      onError(errorText(failure));
    } finally {
      setBusy('');
      reload();
    }
  }

  return (
    <div className="doc-group">
      <h3>
        {group.title} {files.length > 0 && <span className="tag ok">{files.length} קבצים</span>}
      </h3>
      <ul>
        {group.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" style={{ width: 'auto', maxWidth: '100%' }} />
        <button className="btn-primary" onClick={upload} disabled={!!busy || !meta}>
          העלאה
        </button>
      </div>
      {busy && <p className="muted small">מעלה {busy}…</p>}
      {files.length > 0 && (
        <ul className="files">
          {files.map((file) => (
            <li key={file.id}>
              <a href={fileUrl(`/projects/${id}/documents/${file.id}/file`)}>{file.file_name}</a>
              {file.page_count > 1 ? ` (${file.page_count} עמודים)` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Step 3 ───────────────────────────────────────────────────────────────

function Prediction({
  id,
  base,
  state,
  save,
  reload,
  onError,
}: {
  id: string;
  base: string;
  state: any;
  save: (update: Record<string, unknown>) => Promise<void>;
  reload: () => void;
  onError: (message: string) => void;
}) {
  const [reading, setReading] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const [finishing, setFinishing] = useState('');
  const [result, setResult] = useState<any>(null);

  const pages: Page[] = state.documents
    .filter((d: any) => READ_TYPES.includes(d.document_type) && ['pdf', 'png', 'jpg', 'jpeg'].includes(d.file_type))
    .flatMap((d: any) =>
      Array.from({ length: d.page_count }, (_, page) => ({
        document_id: d.id,
        page,
        key: `${d.id}:${page}`,
        file_name: d.page_count > 1 ? `${d.file_name} (עמוד ${page + 1})` : d.file_name,
      })),
    );
  const analysed = new Map<string, any>(state.analyses.map((a: any) => [a.key, a]));
  const unread = pages.filter((p) => !analysed.has(p.key));
  const detected: any[] = state.detected;
  const settings = state.settings;
  const read = pages.length > 0 && unread.length === 0;

  async function readPages(selection: Page[]) {
    onError('');
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
    reload();
    if (!progress.failed.length) setReading(null);
  }

  async function finish() {
    onError('');
    setResult(null);
    try {
      setFinishing('בונה את המודל מהתוכניות…');
      await api(`${base}/auto/build`, { method: 'POST' });
      setFinishing('מאשר, מחשב ומפיק דוח… (עד דקה)');
      await ensureJobNumber();
      setResult(await api(`${base}/auto/finish`, { method: 'POST' }));
    } catch (failure) {
      const missing = failure instanceof ApiError && failure.missing.length ? `: ${failure.missing.join(' · ')}` : '';
      onError(errorText(failure) + missing);
    } finally {
      setFinishing('');
      reload();
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

  // Kinds found on the plans that no answer and no plan gives a current for.
  const kindsStillMissing: string[] = state.kinds_used.filter((kind: string) =>
    state.missing.some((m: any) => m.field === `kinds.${kind}.max_current_a`),
  );

  return (
    <>
      {!state.ai_available && <div className="notice error">הקריאה האוטומטית לא מוגדרת בשרת (מפתח OpenAI).</div>}

      <section className="card">
        <h2>3. קריאת התוכניות</h2>
        <p className="muted small">
          המערכת קוראת כל תוכנית: איזו קומה, קנה המידה, ואילו מקורות קרינה משורטטים בה (שנאים, לוחות, קווי הזנה, פירים). כ-30
          שניות לתוכנית.
        </p>
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
          <button className="btn-primary" disabled={!!reading || !unread.length || !state.ai_available} onClick={() => readPages(unread)}>
            {unread.length ? `קריאת ${unread.length} התוכניות` : 'כל התוכניות נקראו'}
          </button>
          {read && (
            <button disabled={!!reading || !state.ai_available} onClick={() => readPages(pages)}>
              קריאה מחדש של הכול
            </button>
          )}
          {reading && (
            <span className="muted small">
              קורא {reading.done} מתוך {reading.total}…
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
      </section>

      {state.floors.length > 0 && (
        <section className="card">
          <h2>קומות שזוהו</h2>
          <p className="muted small">
            קומה שלא מסמנים בה אזורים נחשבת כולה לפי השימוש: חניון וטכני באפור (לא נדרש מיגון), מגורים ומשרדים באדום (שהייה
            ממושכת). גודל המבנה מחושב מקנה המידה: אם הוא לא דומה בין הקומות, קנה המידה כנראה שגוי.
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
                          <select value={floor.plan} onChange={(e) => save({ pages: { [e.target.value]: { plan_for: floor.level } } })}>
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
        </section>
      )}

      {state.floors.length > 0 && (
        <section className="card">
          <h2>מקורות שזוהו</h2>
          {detected.length === 0 ? (
            <p className="muted">לא זוהו מקורות קרינה. בדקו שהועלו תוכניות החשמל של המרתף וקומת הקרקע.</p>
          ) : (
            <>
              <p className="muted small">
                מבטלים את הסימון במה שאינו מקור אמיתי. הזרם ריק = לפי התשובה לסוג בשלב 2, או מה שכתוב בתוכנית.
              </p>
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
                            placeholder={source.max_current_a ? String(source.max_current_a) : 'חסר'}
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
            </>
          )}
          {kindsStillMissing.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 10 }}>
              {kindsStillMissing.map((kind) => (
                <NumberField
                  key={kind}
                  label={`זרם מרבי: ${state.kinds[kind]} (A)`}
                  hint="נמצא בתוכניות ולא נענה בשלב 2"
                  value={settings.kinds?.[kind]?.max_current_a ?? null}
                  onSave={(v) => save({ kinds: { [kind]: { max_current_a: v } } })}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {state.floors.length > 0 && (
        <section className="card">
          <h2>הפקת הדוח</h2>
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
                      את הסף (למשל 4 mG) מפעילים ב<Link href="/prediction/regulation">כללי רגולציה</Link>.
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

function NumberField({
  label,
  hint,
  value,
  onSave,
}: {
  label: string;
  hint?: string;
  value: number | null;
  onSave: (value: number | null) => void;
}) {
  return (
    <label className="field" style={{ minWidth: 190, maxWidth: 230 }}>
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
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}
