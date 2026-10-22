import { listInspectors, seedInspectorsFromReports } from '@/lib/inspector-service';
import { listSignatures } from '@/lib/signature-service';
import { InspectorDirectory } from './inspector-directory';

export const dynamic = 'force-dynamic';

export default function InspectorsPage() {
  // Filled from the people already named in stored reports the first time this screen
  // is opened on an installation that predates the directory — see the service.
  seedInspectorsFromReports();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>בודקים</h1>
          <p className="subtitle">
            הבודקים המוסמכים שאפשר לבחור בדוח קרינה. שורה אחת לכל אדם ולכל סוג היתר — מי שמחזיק
            היתר ELF והיתר RF מופיע פעמיים, עם שני מספרי היתר ושני תאריכי תוקף, והדוח מדפיס את
            ההיתר שמכסה את מה שנמדד בפועל.
          </p>
        </div>
      </div>

      <InspectorDirectory inspectors={listInspectors()} signatures={listSignatures()} />
    </>
  );
}
