import { redirect } from 'next/navigation';

/** Where the job-number register and the project list link to: the automatic flow. */
export default async function ProjectRoot({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/prediction/projects/${id}/auto`);
}
