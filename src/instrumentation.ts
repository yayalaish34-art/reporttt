/**
 * Runs once when the server starts.
 *
 * Keeps the customer directory following the CRM: every hour, whatever was
 * created or edited there since the last sync — usually a few rows, one short
 * query. Before this the copy was only as new as the last press of the import
 * button. Searching also syncs when the last run is old (see `findCustomers`).
 */
const INTERVAL_MS = 60 * 60_000;
/** Lets the server finish starting and pass its health check first. */
const FIRST_RUN_DELAY_MS = 2 * 60_000;

export async function register() {
  /*
   * The whole body sits inside this test rather than after an early return. Next
   * replaces `NEXT_RUNTIME` at build time and drops the branch from the Edge bundle —
   * but only a branch it can see is dead. After an early return the `pg` import stays
   * in the Edge build, which has no `fs`/`net`, and the build fails.
   */
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { crmConfigured, syncCrmCustomers } = await import('./lib/crm-import');
    if (!crmConfigured()) return;

    const tick = () =>
      syncCrmCustomers()
        .then((n) => {
          if (n > 0) console.log(`סנכרון לקוחות מה-CRM: ${n} רשומות עודכנו`);
        })
        .catch((err) => console.error('סנכרון לקוחות מה-CRM נכשל', err));

    setTimeout(tick, FIRST_RUN_DELAY_MS).unref();
    setInterval(tick, INTERVAL_MS).unref();
  }
}
