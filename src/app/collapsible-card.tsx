'use client';

import { createContext, useContext, useId, useState, type ReactNode } from 'react';

/**
 * A section of a report form, folded until it is wanted.
 *
 * Writing up a survey means working one part at a time — the recipient, then
 * the site, then the tables, then the photographs — and every part open at once
 * turned a form into a page of scrolling in which the thing being typed was
 * rarely on screen. Folded, the whole report is a short list of headings.
 *
 * Only one section is open at a time. That is the point of folding: two open
 * sections are most of the way back to the page this replaced, and the surveyor
 * would have to close the last one by hand every time. Opening a section closes
 * whichever was open.
 *
 * Two rules keep the folding from getting in the way. A section that is folded
 * is still *mounted* — its inputs keep their state, and nothing is lost by
 * closing it. And the heading still carries the section's summary line, so the
 * count of tables or photographs is readable without opening anything.
 *
 * Shared by both reports: a radon survey and a radiation survey are different
 * documents but the same job at the keyboard.
 */

interface CardGroupState {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}

/**
 * Null outside a group, in which case each card keeps its own state.
 *
 * That fallback is what lets a card be used on its own — and it means adding a
 * card to a page that has no group is not a silent no-op.
 */
const CardGroupContext = createContext<CardGroupState | null>(null);

/**
 * Makes the cards inside it mutually exclusive.
 *
 * `defaultOpenTitle` names the section a report is normally started in, so a
 * new report does not open as a list of headings with nothing to type into.
 */
export function CardGroup({
  defaultOpenTitle,
  children,
}: {
  defaultOpenTitle?: string;
  children: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenTitle ?? null);
  return <CardGroupContext.Provider value={{ openId, setOpenId }}>{children}</CardGroupContext.Provider>;
}

/**
 * Whether the card with this title is the one currently unfolded.
 *
 * For a section that has to *do* something when it opens rather than merely show its
 * contents — the photo appendix opens the camera. Inside a group the cards are keyed by
 * title, which is what makes this answerable from outside the card itself. Outside a
 * group there is no shared state to consult, so it reports false.
 */
export function useCardOpen(title: string): boolean {
  const group = useContext(CardGroupContext);
  return group ? group.openId === title : false;
}

/**
 * Unfolds another section by title, for a control that finishes one step and starts the
 * next — "סיום" on the measurement tables opens the photo appendix.
 *
 * A no-op outside a group, where there is nothing to hand focus to.
 */
export function useOpenCard(): (title: string) => void {
  const group = useContext(CardGroupContext);
  return (title: string) => group?.setOpenId(title);
}

export function CollapsibleCard({
  title,
  hint,
  action,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  /** A control that belongs to the section, e.g. "הוספת טבלה". */
  action?: ReactNode;
  /** Only used outside a group; inside one, `CardGroup` decides. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const group = useContext(CardGroupContext);
  const fallbackId = useId();
  const [standaloneOpen, setStandaloneOpen] = useState(defaultOpen);

  // Identified by title inside a group, so `defaultOpenTitle` can name one.
  const id = group ? title : fallbackId;
  const open = group ? group.openId === id : standaloneOpen;

  const toggle = () => {
    if (group) group.setOpenId(open ? null : id);
    else setStandaloneOpen((v) => !v);
  };

  return (
    <section className={`card${open ? ' card-open' : ''}`}>
      <div className="card-head">
        {/* The whole heading is the control, not a small chevron beside it —
            it is the largest target on the row and the one people aim at. */}
        <button type="button" className="card-toggle" aria-expanded={open} onClick={toggle}>
          <span className="card-caret" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <h2>{title}</h2>
          {hint && <span className="hint">{hint}</span>}
        </button>
        {/* Outside the button: a control inside a button cannot be clicked.
            Shown only when the section is open — an "add" button on a folded
            section acts on something the surveyor cannot see. */}
        {action && open && <span className="spacer">{action}</span>}
      </div>
      {/* Hidden rather than unmounted, so half-typed input survives a fold. */}
      <div className="card-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
