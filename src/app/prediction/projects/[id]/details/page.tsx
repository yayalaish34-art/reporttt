'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/prediction/api';
import { ProjectForm } from '../../../project-form';

export default function ProjectDetails() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<any>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api(`/projects/${id}`)
      .then(setProject)
      .catch((failure) => setError(errorText(failure)));
  }, [id]);

  if (error) return <div className="notice error">{error}</div>;
  if (!project) return <div className="empty">טוען…</div>;

  return (
    <>
      {saved && <div className="notice ok">השינויים נשמרו ונרשמו ביומן השינויים.</div>}
      <ProjectForm
        key={project.id + (saved ? '-saved' : '')}
        project={project}
        onSaved={(updated) => {
          setProject(updated);
          setSaved(true);
        }}
      />
    </>
  );
}
