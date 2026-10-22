import Link from 'next/link';
import { activeTemplate } from '@/lib/docx/template-store';
import { StartScreen } from './start-screen';

export const dynamic = 'force-dynamic';

/**
 * What the system opens on: the three surveys, ready to start.
 *
 * The list of finished radiation reports used to be here, which meant every
 * opening began by hunting for "דוח חדש" among other people's work. Writing a
 * survey is what the app is for; the lists are still a tap away on each card.
 */
export default function HomePage() {
  // A kind whose template is missing cannot produce a document, and that is worth
  // saying here rather than letting it be discovered at the end of a survey.
  const missing = (
    [
      ['radiation', 'קרינה'],
      ['radon', 'ראדון'],
      ['asbestos', 'אסבסט'],
      ['mold', 'עובשים'],
      ['iaq', 'איכות אוויר'],
    ] as const
  ).filter(([kind]) => !activeTemplate(kind));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>מה מפיקים היום?</h1>
          <p className="subtitle">בחרו סוג דוח כדי להתחיל</p>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="notice error">
          לא הוגדרה תבנית פעילה ל{missing.map(([, label]) => label).join(', ')} — לא ניתן להפיק
          מסמכים. עברו ל<Link href="/templates">מסך התבניות</Link> והעלו קובץ.
        </div>
      )}

      <StartScreen />
    </>
  );
}
