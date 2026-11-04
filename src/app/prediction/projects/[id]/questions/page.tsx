'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { parseCurve } from '../model/source-form';
import { api, errorText } from '@/lib/prediction/api';
import { ARRANGEMENT_LABELS, BASIS_LABELS, OCCUPANCY_LABELS } from '@/lib/prediction/labels';

const OPTION_LABELS: Record<string, string> = { ...ARRANGEMENT_LABELS, ...BASIS_LABELS, ...OCCUPANCY_LABELS };

function Question({ question, onAnswer }: { question: any; onAnswer: (value: unknown) => void }) {
  const [value, setValue] = useState('');
  const numeric = question.input_type === 'number' || question.input_type === 'optional_number';

  return (
    <form
      className="row"
      style={{ marginBottom: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (value === '') return;
        onAnswer(question.input_type === 'curve' ? parseCurve(value) : numeric ? Number(value) : value);
      }}
    >
      <span className="grow">
        {question.prompt}
        {question.unit && <span className="muted small"> ({question.unit})</span>}
      </span>
      {question.input_type === 'select' ? (
        <select value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">בחירה</option>
          {question.options.map((option: string) => (
            <option key={option} value={option}>
              {OPTION_LABELS[option] ?? option}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={question.input_type === 'text' ? '' : 'num'}
          type={numeric ? 'number' : 'text'}
          step="any"
          placeholder={question.input_type === 'curve' ? '1:40, 2:12, 4:3' : ''}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      <button disabled={value === ''}>שמירה</button>
    </form>
  );
}

export default function QuestionsPage() {
  const { id } = useParams<{ id: string }>();
  const base = `/projects/${id}`;
  const [questions, setQuestions] = useState<any[] | null>(null);
  const [blockers, setBlockers] = useState<any[]>([]);
  const [assumptions, setAssumptions] = useState<any[]>([]);
  const [statement, setStatement] = useState('');
  const [justification, setJustification] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [q, r, a] = await Promise.all([api(`${base}/questions`), api(`${base}/readiness`), api(`${base}/assumptions`)]);
    setQuestions(q);
    setBlockers(r.blockers);
    setAssumptions(a);
  }, [base]);

  useEffect(() => {
    load().catch((failure) => setError(errorText(failure)));
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await load();
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  const groups = new Map<string, any[]>();
  (questions ?? []).forEach((question) => groups.set(question.group, [...(groups.get(question.group) ?? []), question]));

  return (
    <>
      {error && <div className="notice error">{error}</div>}
      {questions && questions.length === 0 && <div className="notice ok">אין שאלות פתוחות.</div>}
      {[...groups.entries()].map(([group, items]) => (
        <div className="card" key={group}>
          <h2 style={{ marginBottom: 10 }}>{group}</h2>
          {items.map((question) => (
            <Question
              key={question.id}
              question={question}
              onAnswer={(value) =>
                run(() =>
                  api(`${base}/answers`, {
                    method: 'POST',
                    json: { target_type: question.target_type, target_id: question.target_id, field: question.field, value },
                  }),
                )
              }
            />
          ))}
        </div>
      ))}

      <div className="card">
        <h2 style={{ marginBottom: 6 }}>הנחות הנדסיות (ENGINEERING_ASSUMPTION)</h2>
        <p className="small muted">
          כל הנחה מופיעה בדוח הסופי. הנחה אינה ממלאת נתון חסר מעצמה. את הערך עצמו יש להזין בשדה המתאים.
        </p>
        {assumptions.map((assumption) => (
          <div className="row" key={assumption.id} style={{ marginBottom: 6 }}>
            <span className="grow">
              <span className="tag warn">ENGINEERING_ASSUMPTION</span> {assumption.statement}{' '}
              <span className="muted small">({assumption.justification})</span>
            </span>
            <button type="button" className="btn-danger" onClick={() => run(() => api(`${base}/assumptions/${assumption.id}`, { method: 'DELETE' }))}>
              מחיקה
            </button>
          </div>
        ))}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api(`${base}/assumptions`, { method: 'POST', json: { statement, justification } });
              setStatement('');
              setJustification('');
            });
          }}
        >
          <input className="grow" required placeholder="ההנחה" value={statement} onChange={(e) => setStatement(e.target.value)} />
          <input className="grow" required placeholder="הנימוק" value={justification} onChange={(e) => setJustification(e.target.value)} />
          <button>הוספה</button>
        </form>
      </div>

      {blockers.length > 0 && (
        <div className="notice warn">
          <strong>לא ניתן להנפיק דוח סופי. מידע חסר:</strong>
          <ul>
            {blockers.map((blocker, index) => (
              <li key={index}>{blocker.message}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
