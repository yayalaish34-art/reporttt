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
        <p>אחרי הפתיחה, שלושה צעדים:</p>
        <ol>
          <li>מעלים את תוכניות החשמל של כל הקומות ואת הגרמושקה.</li>
          <li>המערכת קוראת אותן: קומות, קנה מידה, שנאים, לוחות, קווי הזנה ופירים. בודקים את מה שזוהה.</li>
          <li>עונים על כמה שאלות (גובה קומה, זרמים, אחוז העמסה) ולוחצים &quot;אישור והפקת דוח&quot;.</li>
        </ol>
        <p>מי שרוצה לעבוד צעד אחר צעד או לתקן משהו על התוכנית, הלשוניות הידניות נשארו במקומן.</p>
      </div>

      <ProjectForm onSaved={(project) => router.push(`/prediction/projects/${project.id}/auto`)} />
    </>
  );
}
