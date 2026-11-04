'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/prediction/api';
import { BUILDING_LABELS, label } from '@/lib/prediction/labels';

export default function PredictionProjects() {
  const [projects, setProjects] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/projects')
      .then(setProjects)
      .catch((failure) => setError(errorText(failure)));
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>חיזוי קרינה</h1>
          <p className="subtitle">
            {projects === null ? 'טוען…' : projects.length === 0 ? 'אין עדיין פרויקטים' : `${projects.length} פרויקטים`}
          </p>
        </div>
        <div className="actions">
          <Link className="btn btn-primary" href="/prediction/new" prefetch={false}>
            חיזוי חדש
          </Link>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      {projects && projects.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>פרויקט</th>
                  <th>לקוח</th>
                  <th>Job Number</th>
                  <th>כתובת</th>
                  <th>סוג מבנה</th>
                  <th>מודל</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link href={`/prediction/projects/${project.id}/auto`} prefetch={false}>
                        {project.project_name}
                      </Link>
                    </td>
                    <td>{project.client_name}</td>
                    <td className="ltr">{project.project_number || '—'}</td>
                    <td>{project.address}</td>
                    <td>{label(BUILDING_LABELS, project.building_type)}</td>
                    <td>
                      {project.model_verified ? <span className="tag ok">מאושר</span> : <span className="tag">לא אושר</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
