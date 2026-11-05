'use client';

export const FLOW_STEPS = ['פרטים', 'מסמכים ושאלות', 'חיזוי אוטומטי'];

/** The three steps of a prediction. A step can be reopened once the one before it is done. */
export function FlowSteps({
  current,
  reachable = current,
  onPick,
}: {
  current: number;
  reachable?: number;
  onPick?: (step: number) => void;
}) {
  return (
    <ol className="elf-steps flow-steps">
      {FLOW_STEPS.map((text, index) => {
        const step = index + 1;
        const state = step < current ? 'done' : step === current ? 'now' : '';
        const open = onPick && step <= reachable && step !== current;
        return (
          <li key={text} className={state}>
            {open ? (
              <button type="button" className="link-button" onClick={() => onPick(step)}>
                {step}. {text}
              </button>
            ) : (
              <>
                {step}. {text}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
