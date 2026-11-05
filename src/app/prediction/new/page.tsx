'use client';

import { useRouter } from 'next/navigation';
import { FlowSteps } from '../flow-steps';
import { ProjectForm } from '../project-form';

export default function NewPrediction() {
  const router = useRouter();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>חיזוי חדש</h1>
          <p className="subtitle">פתיחת פרויקט חיזוי שדה מגנטי (ELF, 50 Hz) לפני הקמה או אכלוס</p>
        </div>
      </div>

      <FlowSteps current={1} />
      <div className="explain">
        <p>
          <strong>מה זה פרויקט?</strong> מבנה אחד שעושים לו חיזוי. הלקוח הוא מי שהזמין את העבודה, והפרויקט הוא
          המבנה עצמו, כך שללקוח אחד יכולים להיות כמה פרויקטים.
        </p>
        <ol>
          <li>
            <strong>פרטים:</strong> בוחרים לקוח מה-CRM וממלאים את פרטי המבנה (כאן).
          </li>
          <li>
            <strong>מסמכים ושאלות:</strong> מעלים תוכניות חשמל לכל קומה וגרמושקה, לפי ההנחיות במסך, ועונים על כמה שאלות
            טכניות (גובה קומה, הספק שנאי, זרמים).
          </li>
          <li>
            <strong>חיזוי אוטומטי:</strong> המערכת קוראת את התוכניות, מציגה מה זוהה לבדיקה, ובלחיצה אחת מפיקה דוח.
          </li>
        </ol>
      </div>

      <ProjectForm onSaved={(project) => router.push(`/prediction/projects/${project.id}/auto?step=2`)} />
    </>
  );
}
