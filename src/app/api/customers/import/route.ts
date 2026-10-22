import { NextResponse } from 'next/server';
import { crmConfigured, importCrmCustomers } from '@/lib/crm-import';

/**
 * Pulls the customer directory from the CRM.
 *
 * The same work as the button in the customers screen, reachable without a
 * browser: the deployment has no shell, so this is how the directory gets
 * refreshed from a script or checked after a deploy.
 *
 * Not separately authenticated — the middleware already requires the app
 * password on every path but `/api/health`, and a second secret to keep in
 * step would be one more thing to get wrong.
 */
export async function POST() {
  if (!crmConfigured()) {
    return NextResponse.json(
      { ok: false, message: 'CRM_DATABASE_URL לא מוגדר בשרת.' },
      { status: 400 },
    );
  }

  try {
    const result = await importCrmCustomers();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('ייבוא לקוחות מה-CRM נכשל', err);
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : 'הייבוא נכשל' },
      { status: 500 },
    );
  }
}
