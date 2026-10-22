import { listSignatures } from '@/lib/signature-service';
import { SignatureLibrary } from './signature-library';

export const dynamic = 'force-dynamic';

export default function SignaturesPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>חתימות</h1>
          <p className="subtitle">
            כל שורה בטבלת הבודקים ובטבלת עורכי הדוח בוחרת חתימה מכאן. חתימה שייכת לאדם, לא לדוח —
            ולכן היא לא יכולה לשבת בתבנית: התבנית משכפלת שורה אחת, וכל חתימה שהייתה בתוכה הייתה
            מוטבעת על כל מי שמופיע בטבלה.
          </p>
        </div>
      </div>

      <SignatureLibrary signatures={listSignatures()} />
    </>
  );
}
