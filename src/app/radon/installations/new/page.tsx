import { redirect } from 'next/navigation';
import { createInstallationId } from '../../actions';

/** Creates an installation and opens it — see the radon report's own. */
export const dynamic = 'force-dynamic';

export default async function NewInstallation({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const { customer } = await searchParams;
  const id = await createInstallationId(customer);
  // From a customer's card the customer step is already answered.
  redirect(customer ? `/radon/installations/${id}?step=2` : `/radon/installations/${id}`);
}
