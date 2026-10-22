import { redirect } from 'next/navigation';
import { createBlankAsbestosReportId } from '../actions';

/**
 * Creates an asbestos opinion and opens it — see the radiation one.
 *
 * The prose shape: the tabled one is chosen deliberately from the list, where the
 * two are offered side by side, and defaulting to it here would put a campus-survey
 * form in front of someone writing a single demolition opinion.
 */
export const dynamic = 'force-dynamic';

export default async function NewAsbestosReport() {
  const id = await createBlankAsbestosReportId();
  redirect(`/asbestos/${id}`);
}
