'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/prediction/api';

/** The project's name above its three steps. The steps themselves live on the page. */
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<any>(null);

  useEffect(() => {
    api(`/projects/${id}`)
      .then(setProject)
      .catch(() => undefined);
  }, [id]);

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
      {children}
    </>
  );
}
