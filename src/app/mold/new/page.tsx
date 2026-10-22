import { redirect } from 'next/navigation';
import { createBlankMoldReportId } from '../actions';

/** Creates a mould report and opens it — see the radiation one. */
export const dynamic = 'force-dynamic';

export default async function NewMoldReport() {
  const id = await createBlankMoldReportId();
  redirect(`/mold/${id}`);
}
