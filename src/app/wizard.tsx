'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A report, written one step at a time.
 *
 * Both surveys are filled in on a phone, standing in a plant room, by someone who is
 * measuring rather than doing data entry. The folded-card form this replaced showed the
 * whole report at once and asked which part to open — which is the right shape for
 * reviewing a finished report and the wrong one for writing a new one, where the answer
 * is always "the next part". A step is the whole screen, has one obvious control, and
 * says what it is for.
 *
 * The steps are not a workflow: nothing is submitted, and there is no state machine
 * behind them. The whole report is still one object held by the editor and saved whole —
 * the wizard only decides which fields are on screen. That is what lets a step be
 * revisited freely and lets "המשך" mean nothing more than "show me the next part".
 */

export interface WizardStep {
  /** Shown in the progress bar and as the step's heading. */
  title: string;
  /**
   * Called when this step becomes the one on screen, and again when it stops being it.
   *
   * For a step that has to *do* something on arrival rather than merely show its fields —
   * the photo step opens the camera.
   */
  onShow?: (showing: boolean) => void;
  /** One line under the heading saying what this step is for. */
  hint?: string;
  /**
   * What is missing, if anything — shown only once "המשך" has been pressed on this step.
   *
   * Never a block: a survey is written in the order it was measured, not the order the
   * form asks for, and a reading is taken before anyone looks up which company ordered
   * the job. But it is also not shown on arrival — a step that greets the surveyor with
   * "לא הוזן שם האתר" is complaining about a field they have not reached yet. Pressing
   * "המשך" is the moment they say they are done with the step, and the only moment the
   * warning is news. It clears when the field is filled, and the last step warns again
   * where it actually counts.
   */
  warning?: string;
  /**
   * What must be answered before this step can be left, or undefined when it can.
   *
   * The opposite of `warning` above, and used far more sparingly. A warning names
   * something missing and gets out of the way, because a survey is written in the
   * order it was measured. A blocker is for the handful of answers the rest of the
   * report is *built out of* — the asbestos opinion prints its address in six
   * places and names it in the file, the subject and the customer's card, so a
   * report that goes on without one produces a document with a hole in every
   * page rather than one field left blank.
   *
   * Shown on arrival rather than waiting for a press, unlike a warning: it is not
   * a complaint about an unreached field but a statement of what this step is for,
   * and discovering it only after pressing "המשך" would be the same nag twice.
   */
  blocker?: string;
  content: ReactNode;
}

/**
 * Which step the address says we are on.
 *
 * The step used to live in React state alone, which meant it did not survive the page
 * being loaded again — and on a phone that happens constantly without anyone asking for
 * it: producing the report hands the file to Word, and when the surveyor comes back the
 * browser has often dropped the tab and reloads it. They arrived at step 1 of the report
 * they had just finished and had to page through the whole thing again.
 *
 * Numbered from 1 in the address because it is a thing a person reads.
 */
const STEP_PARAM = 'step';

function stepFromAddress(total: number): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get(STEP_PARAM);
  if (raw === null) return null;
  const n = Number(raw);
  // A step past the end of a report that has since lost a step would land nowhere.
  if (!Number.isInteger(n) || n < 1 || n > total) return null;
  return n - 1;
}

export function Wizard({
  steps,
  /** Rendered under the last step, in place of "המשך" — save, produce, send. */
  finish,
  /**
   * Called whenever the step on screen changes.
   *
   * The editor stores the report here. Leaving a step is the surveyor saying they are
   * done with that part, and it is also when the phone is most likely to be pocketed —
   * so it is the natural point to make the work safe.
   *
   * The zero-based source and destination indexes let an editor attach work to one
   * particular transition (for example, drafting a summary only after measurements),
   * without making that work run when the report is merely reopened on a saved step.
   */
  onStepChange,
  /** Shown beside the progress line: whether the work is stored. */
  status,
}: {
  steps: WizardStep[];
  finish: ReactNode;
  onStepChange?: (from: number, to: number) => void;
  status?: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const current = Math.min(index, steps.length - 1);
  const step = steps[current];
  const last = current === steps.length - 1;

  /**
   * Reopening the report resumes the step it was left on.
   *
   * Read once, on arrival. Afterwards the address follows the screen rather than the
   * other way round — the step bar and "המשך" are what move between steps.
   */
  const restoring = useRef(false);
  useEffect(() => {
    const fromAddress = stepFromAddress(steps.length);
    if (fromAddress !== null && fromAddress !== 0) {
      restoring.current = true;
      setIndex(fromAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The address follows the step on screen.
   *
   * replaceState rather than pushState: the steps are not places to go back to. Making
   * "back" walk them one at a time would take six presses to leave a report, and the
   * back gesture on a phone is how people leave a screen.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set(STEP_PARAM, String(current + 1));
    window.history.replaceState(null, '', url);
  }, [current]);

  /**
   * The steps whose warning has been earned by pressing "המשך" on them.
   *
   * Kept per step rather than as one flag: having been warned about the site name is no
   * reason to be warned about the photographs on arrival at that step.
   */
  const [warned, setWarned] = useState<ReadonlySet<number>>(new Set());
  const showWarning = step.warning && warned.has(current);

  const next = () => {
    // A blocked step cannot be left at all. The button is disabled too, so this is
    // the belt to that braces — a keyboard press must not slip past it either.
    if (step.blocker) return;
    // The warning appears on the first press and the step is left all the same — it
    // says what is missing, it does not stand in the way.
    if (step.warning && !warned.has(current)) setWarned((w) => new Set(w).add(current));
    setIndex(current + 1);
  };

  /**
   * Scrolls back to the top when the step changes.
   *
   * A long step leaves the page scrolled down; without this the next step opens
   * mid-way through itself, which reads as a broken screen rather than a new one.
   * Skipped on first render so opening the report does not scroll the page.
   */
  const mounted = useRef(false);
  const previousStep = useRef(0);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      previousStep.current = current;
      return;
    }
    // Landing back on the step the report was left on is not the surveyor moving
    // between steps: nothing was left, so there is nothing to save and nowhere to
    // scroll from.
    if (restoring.current) {
      restoring.current = false;
      previousStep.current = current;
      return;
    }
    const from = previousStep.current;
    previousStep.current = current;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Every route between steps ends here — "המשך", "חזרה" and the step bar alike — so
    // one save covers all three rather than three call sites that can drift apart.
    onStepChange?.(from, current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Tells the step it is showing, and tells it again when it is left. Depends on the
  // index alone: `steps` is rebuilt every render, so depending on the step object would
  // fire this on every keystroke.
  const onShow = steps[current]?.onShow;
  useEffect(() => {
    onShow?.(true);
    return () => onShow?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const filled = useStepProgress(bodyRef, current, step.content);

  /**
   * Enter moves to the next step.
   *
   * A phone keyboard's Enter is right where the thumb already is, and a step is usually
   * finished by typing into its last field — so the keystroke that ends the typing may
   * as well end the step.
   *
   * Not from everywhere: inside a <textarea> Enter is a newline, and on a button or a
   * link it is that control's own activation. A <select> is left out too — on Android,
   * Enter is how the picker is confirmed. Anywhere else, including a text input, it
   * advances. The last step is excluded: "סיום" issues the report and is not something
   * a stray Enter should trigger.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || last) return;
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return;
    // A modal is its own context — Enter there confirms the prompt, not the step.
    if (el?.closest('dialog')) return;
    e.preventDefault();
    next();
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div className="wizard" onKeyDown={onKeyDown}>
      {/* Clickable rather than a read-out: correcting something two steps back is a
          normal part of writing a report, and making that a walk back through every
          step in between is the kind of friction this screen exists to remove.

          Going *forward* past a blocked step is not allowed, though — otherwise the
          bar would be a way around the very check that "המשך" enforces. Backwards is
          always free: the blocker is about what may be left unanswered, not about
          trapping anyone on a screen. */}
      <nav className="wizard-steps" aria-label="שלבי הדוח">
        {steps.map((s, i) => {
          const barred = Boolean(step.blocker) && i > current;
          return (
            <button
              key={s.title}
              type="button"
              className={`wizard-step${i === current ? ' current' : ''}${i < current ? ' done' : ''}`}
              aria-current={i === current ? 'step' : undefined}
              aria-label={`שלב ${i + 1}: ${s.title}`}
              disabled={barred}
              title={barred ? step.blocker : undefined}
              onClick={() => {
                if (barred) return;
                setIndex(i);
              }}
            >
              <span className="wizard-step-num" aria-hidden="true">
                {i < current ? '✓' : i + 1}
              </span>
              <span className="wizard-step-title">{s.title}</span>
            </button>
          );
        })}
      </nav>

      <section className="wizard-panel">
        <header className="wizard-head">
          <h2>{step.title}</h2>
          {step.hint && <p className="hint">{step.hint}</p>}
          {filled && (
            <p className={`step-progress${filled.done === filled.total ? ' done' : ''}`} role="status">
              <span className="step-progress-bar" aria-hidden="true">
                <span
                  className="step-progress-fill"
                  style={{ inlineSize: `${(filled.done / filled.total) * 100}%` }}
                />
              </span>
              <span>
                {filled.done === filled.total
                  ? 'כל השדות מולאו'
                  : `מולאו ${filled.done} מתוך ${filled.total} שדות`}
              </span>
            </p>
          )}
        </header>

        {/* A blocker replaces the warning rather than stacking with it: they would
            be saying the same thing twice, and the one that stops the step is the
            one worth reading. */}
        {step.blocker ? (
          <div className="notice error" role="status">
            {step.blocker}
          </div>
        ) : (
          showWarning && (
            <div className="notice warn" role="status">
              {step.warning}
            </div>
          )
        )}

        <div className="wizard-body" ref={bodyRef}>
          {step.content}
        </div>
      </section>

      <div className="wizard-actions">
        <button
          type="button"
          className="btn"
          disabled={current === 0}
          onClick={() => setIndex(current - 1)}
        >
          → חזרה
        </button>
        <span className="wizard-progress">
          שלב {current + 1} מתוך {steps.length}
          {status}
        </span>
        {last ? (
          finish
        ) : (
          <button
            type="button"
            className="btn-primary wizard-next"
            onClick={next}
            disabled={Boolean(step.blocker)}
            // The button says it is unavailable; this says why, for anyone who
            // cannot see that it is greyed out.
            title={step.blocker}
          >
            המשך ←
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * How many of the step's fields still want a value.
 *
 * Counted from what the step actually rendered rather than from a list each step
 * declares, because the fields on screen are conditional — a private customer has no
 * "שם החברה", and a step that reported a total including it would be counting a box
 * nobody can see. Reading the DOM keeps the count honest by construction: it is the
 * same thing the surveyor is looking at.
 *
 * Only fields marked `.field.needed` are counted. A field is "filled" when it says so
 * with `data-filled` — the marking is the editor's business, since only it knows that a
 * customer is chosen by picking one rather than by typing into a box.
 *
 * Returns null when the step has no such fields, and the line is left off entirely: a
 * step of measurement tables has nothing to count, and "0 מתוך 0" is worse than silence.
 */
function useStepProgress(
  ref: React.RefObject<HTMLDivElement | null>,
  current: number,
  content: ReactNode,
): { done: number; total: number } | null {
  const [count, setCount] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const fields = root.querySelectorAll('.field.needed');
    if (fields.length === 0) {
      setCount(null);
      return;
    }
    let done = 0;
    fields.forEach((f) => {
      if ((f as HTMLElement).dataset.filled === 'true') done += 1;
    });
    setCount({ done, total: fields.length });
    // `content` is a fresh element every render, so this re-reads on every keystroke —
    // which is the point: the count has to move as the field it describes is typed into.
  }, [ref, current, content]);

  return count;
}
