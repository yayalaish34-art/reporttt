'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/prediction/api';

const TABS = [
  ['details', 'פרטים'],
  ['documents', 'מסמכים'],
  ['model', 'מודל'],
  ['questions', 'שאלות'],
  ['calculation', 'חישוב'],
  ['results', 'תוצאות'],
  ['recommendations', 'המלצות'],
  ['report', 'דוח'],
];

const STEPS = [
  'העלאת תוכניות',
  'הגדרת המבנה',
  'מקורות חשמל',
  'אימות מודל',
  'השלמת מידע',
  'הרצת חיזוי',
  'בחינת תוצאות',
  'פתרונות',
  'הפקת דוח',
  'אישור מקצועי',
];

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const [project, setProject] = useState<any>(null);
  const [done, setDone] = useState(-1);

  useEffect(() => {
    const base = `/projects/${id}`;
    Promise.all([
      api(base),
      api(`${base}/documents`),
      api(`${base}/rooms`),
      api(`${base}/sources`),
      api(`${base}/questions`),
      api(`${base}/runs`),
      api(`${base}/reports`),
    ])
      .then(([row, documents, rooms, sources, questions, runs, reports]) => {
        setProject(row);
        const hasRuns = runs.length > 0;
        // The first unfinished step in the workflow.
        const steps = [
          documents.length > 0,
          rooms.length > 0,
          sources.length > 0,
          row.model_verified,
          questions.filter((q: any) => q.input_type !== 'optional_number').length === 0,
          hasRuns,
          hasRuns,
          hasRuns,
          reports.length > 0,
          reports.some((r: any) => r.status === 'APPROVED' || r.status === 'ISSUED'),
        ];
        const index = steps.findIndex((step) => !step);
        setDone(index === -1 ? steps.length : index);
      })
      .catch(() => undefined);
  }, [id, pathname]);

  return (
    <>
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <h1>{project?.project_name ?? '…'}</h1>
          <p className="subtitle">
            {project?.client_name}
            {project?.project_number ? ` · Job ${project.project_number}` : ''}
          </p>
        </div>
      </div>
      <ol className="elf-steps">
        {STEPS.map((step, index) => (
          <li key={step} className={index < done ? 'done' : index === done ? 'now' : ''}>
            {index + 1} {step}
          </li>
        ))}
      </ol>
      <nav className="elf-tabs">
        {TABS.map(([path, text]) => (
          <Link
            key={path}
            href={`/prediction/projects/${id}/${path}`}
            prefetch={false}
            className={pathname.endsWith(`/${path}`) ? 'active' : ''}
          >
            {text}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
