import { redirect } from 'next/navigation';
import { createBlankReportId } from '../../actions';

/**
 * Creates a radiation report and opens it.
 *
 * A route rather than a button so the start screen can link to it: a link survives
 * a back gesture and a refresh, where a form post leaves the browser asking whether
 * to resubmit.
 *
 * The redirect is issued here rather than by the create action, because the action
 * also calls `revalidatePath` — which Next refuses during a render. The list it
 * would have refreshed is not on screen at this moment anyway.
 */
export const dynamic = 'force-dynamic';

export default async function NewRadiationReport() {
  const id = await createBlankReportId();
  redirect(`/reports/${id}`);
}
