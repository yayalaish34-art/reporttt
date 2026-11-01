import { redirect } from 'next/navigation';
import { createInstallationId } from '../../actions';

/** Creates an installation and opens it — see the radon report's own. */
export const dynamic = 'force-dynamic';

export default async function NewInstallation() {
  const id = await createInstallationId();
  redirect(`/radon/installations/${id}`);
}
