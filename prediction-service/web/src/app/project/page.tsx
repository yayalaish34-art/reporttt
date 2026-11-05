'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FlowSteps } from '../flow-steps';
import { ProjectForm } from '../project-form';
import { ApiError, api, errorText, fileUrl } from '@/lib/api';
import { uploadPlan } from '@/lib/upload';

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

export default function ProjectPage() {
  return (
    <Suspense fallback={<p className="muted">טוען…</p>}>
      <AutoPage />
    </Suspense>
  );
}

function AutoPage() {
  const search = useSearchParams();
  const id = search.get('id') ?? '';
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
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <h1>{project.project_name}</h1>
          <p className="subtitle">
            {project.client_name}
            {project.project_number ? ` · Job ${project.project_number}` : ''}
          </p>
        </div>
      </div>
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
  const [busy, setBusy] = useState('');
  const [failed, setFailed] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);

  useEffect(() => {
    api(`${base}/reports`)
      .then(setReports)
      .catch(() => undefined);
  }, [base, result]);

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
  const analysed = new Set(state.analyses.map((a: any) => a.key));
  const unread = pages.filter((p) => !analysed.has(p.key));

  /** Reads what is unread, then builds, approves, calculates and issues. Stops only to ask. */
  async function run() {
    onError('');
    setFailed([]);
    setResult(null);
    try {
      if (unread.length) {
        const queue = [...unread];
        const errors: string[] = [];
        let done = 0;
        setBusy(`קורא את התוכניות: 0 מתוך ${unread.length}…`);
        const worker = async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            try {
              await api(`${base}/auto/analyze`, { method: 'POST', json: { document_id: next.document_id, page: next.page } });
            } catch (failure) {
              errors.push(`${next.file_name}: ${errorText(failure)}`);
            }
            done += 1;
            setBusy(`קורא את התוכניות: ${done} מתוך ${unread.length}…`);
          }
        };
        await Promise.all(Array.from({ length: PARALLEL_PAGES }, worker));
        if (errors.length) {
          setFailed(errors);
          return;
        }
      }
      const fresh = await api(`${base}/auto`);
      if (fresh.missing.length) return; // The questions show below; the button continues from here.
      setBusy('בונה את המודל…');
      await api(`${base}/auto/build`, { method: 'POST' });
      setBusy('מחשב ומפיק את הדוח… (עד דקה)');
      setResult(await api(`${base}/auto/finish`, { method: 'POST' }));
    } catch (failure) {
      const missing = failure instanceof ApiError && failure.missing.length ? `: ${failure.missing.join(' · ')}` : '';
      onError(errorText(failure) + missing);
    } finally {
      setBusy('');
      reload();
    }
  }


  const latest = reports[0];
  const included = state.detected.filter((d: any) => d.included);
  const byKind = new Map<string, number>();
  for (const source of included) {
    const label = state.kinds[source.answer.kind || source.kind];
    byKind.set(label, (byKind.get(label) ?? 0) + 1);
  }

  return (
    <>
      {!state.ai_available && <div className="notice error">הקריאה האוטומטית לא מוגדרת בשרת (מפתח OpenAI).</div>}

      <section className="card">
        <h2>3. חיזוי אוטומטי</h2>
        <p>
          לחיצה אחת: המערכת קוראת את כל התוכניות, מזהה את הקומות ואת מקורות הקרינה, בונה את המודל בעצמה, מחשבת את השדה המגנטי
          בגובה 1 מ׳ בכל הקומות ומפיקה דוח חיזוי.
        </p>
        <div className="row">
          <button className="btn-primary" disabled={!!busy || !pages.length || (unread.length > 0 && !state.ai_available)} onClick={run}>
            {latest ? 'הפקת דוח מעודכן' : 'הפקת דוח חיזוי קרינה'}
          </button>
          {busy && <span className="muted">{busy}</span>}
          {!busy && unread.length > 0 && <span className="muted small">{unread.length} תוכניות ייקראו (כ-30 שניות לתוכנית)</span>}
        </div>

        {failed.length > 0 && (
          <div className="notice error" style={{ marginTop: 10 }}>
            חלק מהתוכניות לא נקראו. לחיצה נוספת תנסה לקרוא אותן שוב.
            {failed.map((line) => (
              <div key={line} className="small">
                {line}
              </div>
            ))}
          </div>
        )}

        {!busy && state.missing.length > 0 && state.analyses.length > 0 && (
          <div className="notice" style={{ marginTop: 10 }}>
            <p>
              <strong>כדי להמשיך, עוד תשובה אחת או שתיים:</strong>
            </p>
            <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {state.missing.map((item: any) => (
                <MissingField key={item.field} item={item} settings={state.settings} save={save} />
              ))}
            </div>
            <p className="small muted">אחרי המענה, לוחצים שוב על הכפתור.</p>
          </div>
        )}
      </section>

      {(result || latest) && (
        <section className="card">
          <h2>הדוח</h2>
          {latest && (
            <p>
              <a className="btn btn-primary" href={fileUrl(`${base}/reports/${latest.id}/file`)}>
                הורדת דוח החיזוי (גרסה {latest.version})
              </a>{' '}
              <span className="muted small">{new Date(latest.created_at).toLocaleString('he-IL')}</span>
            </p>
          )}
          {result?.blockers?.length > 0 && (
            <p className="small">
              הדוח מסומן כטיוטה עד שיושלמו: {summarise(result.blockers)}.{' '}
              {result.blockers.some((b: any) => b.code === 'REGULATION_RULE') && (
                <>
                  את הסף (למשל 4 mG) מפעילים ב<Link href="/regulation/">כללי רגולציה</Link>.
                </>
              )}
            </p>
          )}
        </section>
      )}

      {state.floors.length > 0 && (
        <section className="card">
          <h2>מה המערכת זיהתה</h2>
          <p className="small">
            <strong>{state.floors.length} קומות:</strong> {state.floors.map((f: any) => f.name).join(' · ')}
          </p>
          <p className="small">
            <strong>{included.length} מקורות קרינה:</strong>{' '}
            {included.length
              ? Array.from(byKind.entries())
                  .map(([label, count]) => `${label} ${count}`)
                  .join(' · ')
              : 'לא זוהו. בדקו שהועלו תוכניות החשמל של המרתף וקומת הקרקע.'}
          </p>
          <p className="small muted">
            חניון וקומות טכניות מחושבים כאזור ללא שהייה ממושכת (אפור), קומות מגורים ומשרדים כשהייה ממושכת (אדום). ערכים שלא נקראו
            מהתוכניות ולא נענו בשאלות נרשמים בדוח כהנחות הנדסיות.
          </p>
        </section>
      )}
    </>
  );
}

/** One open question, answered in place. */
function MissingField({ item, settings, save }: { item: any; settings: any; save: (update: Record<string, unknown>) => Promise<void> }) {
  // "floor_height_m", "pages.<page key>.scale_denominator" or "kinds.<kind>.max_current_a".
  const parts = String(item.field).split('.');
  const [group, field] = [parts[0], parts[parts.length - 1]];
  const key = parts.slice(1, -1).join('.');
  if (!key) {
    return (
      <NumberField label={item.message.replace('חסר: ', '')} value={settings[group] ?? null} onSave={(v) => save({ [group]: v })} />
    );
  }
  const current = settings[group]?.[key]?.[field] ?? null;
  return (
    <NumberField
      label={item.message.replace('חסר ', '').replace('חסר: ', '')}
      hint={field === 'scale_denominator' ? 'למשל 50 או 100, כפי שכתוב בטבלת הכותרת' : undefined}
      value={current}
      onSave={(v) => save({ [group]: { [key]: { [field]: v } } })}
    />
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
