import { redirect } from 'next/navigation';
import { createBlankIaqReportId } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewIaqReport() {
  const id = await createBlankIaqReportId();
  redirect(`/iaq/${id}`);
}
