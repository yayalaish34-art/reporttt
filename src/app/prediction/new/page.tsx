'use client';

import { useRouter } from 'next/navigation';
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

      <div className="explain">
        <p>
          <strong>מה זה פרויקט?</strong> מבנה אחד שעושים לו חיזוי. הלקוח הוא מי שהזמין את העבודה, והפרויקט הוא
          המבנה עצמו, כך שללקוח אחד יכולים להיות כמה פרויקטים. הפרויקט מרכז את התוכניות, הקומות, החדרים, מקורות
          החשמל, החישובים והדוח.
        </p>
        <p>אחרי הפתיחה העבודה נמשכת לפי הסדר:</p>
        <ol>
          <li>מסמכים: מעלים תוכנית אדריכלית (PDF או תמונה).</li>
          <li>מודל: מגדירים קומות, מכיילים את התוכנית, מציירים חדרים ומקורות חשמל, ומאשרים את המודל.</li>
          <li>שאלות: עונים רק על מה שחסר, כמו זרמים, גבהים וסיווג שהייה.</li>
          <li>חישוב ותוצאות: Heatmap ב-mG, טבלת תוצאות ומקור כל מספר.</li>
          <li>דוח: PDF בעברית, ואישור של בעל מקצוע לפני הנפקה.</li>
        </ol>
      </div>

      <ProjectForm onSaved={(project) => router.push(`/prediction/projects/${project.id}/documents`)} />
    </>
  );
}
