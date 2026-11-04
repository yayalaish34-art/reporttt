'use server';

import { ensureJobNumber } from '@/lib/job-numbers';

/**
 * The prediction project's number in the system-wide register.
 *
 * Taken when the first report is produced, like every other department, and kept after.
 * `preferred` is a number already typed on the project; it is kept when no other job holds it.
 */
export async function predictionJobNumber(
  projectId: string,
  customerName: string,
  inspectorName: string,
  preferred: string,
): Promise<number> {
  return ensureJobNumber('prediction', projectId, { customerName, inspectorName }, preferred);
}
