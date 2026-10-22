import { redirect } from 'next/navigation';
import { createBlankRadonReportId } from '../actions';

/** Creates a radon report and opens it — see the radiation one. */
export const dynamic = 'force-dynamic';

export default async function NewRadonReport() {
  const id = await createBlankRadonReportId();
  redirect(`/radon/${id}`);
}
