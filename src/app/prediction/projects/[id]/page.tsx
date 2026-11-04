import { redirect } from 'next/navigation';

/** Where the job-number register links to: the project's report tab. */
export default async function ProjectRoot({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/prediction/projects/${id}/report`);
}
