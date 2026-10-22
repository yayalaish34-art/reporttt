import { listTemplates } from '@/lib/docx/template-store';
import { TemplateWorkspace } from './template-workspace';

export const dynamic = 'force-dynamic';

export default function TemplatesPage() {
  // Four surveys, five templates (asbestos has two shapes), all active at once —
  // uploading one does not unseat the others.
  return (
    <>
      <div className="page-head">
        <div>
          <h1>תבניות הדוחות</h1>
          <p className="subtitle">
            התבנית הפעילה היא המקור היחיד שממנו מופקים המסמכים. העלאה חדשה הופכת מיד לפעילה, והגרסאות
            הקודמות נשמרות לצורך חזרה אחורה. לכל סוג דוח תבנית משלו.
          </p>
        </div>
      </div>

      <TemplateWorkspace
        radiation={listTemplates('radiation')}
        radon={listTemplates('radon')}
        asbestos={listTemplates('asbestos')}
        asbestosTables={listTemplates('asbestos-tables')}
        mold={listTemplates('mold')}
        iaq={listTemplates('iaq')}
      />
    </>
  );
}
