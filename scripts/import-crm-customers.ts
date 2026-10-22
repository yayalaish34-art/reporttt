/**
 * Imports the customer directory from the Galit CRM, from the command line.
 *
 * The work itself lives in `src/lib/crm-import.ts`, so that the button in the
 * customers screen and this script cannot drift apart — the deployment has no
 * shell, and pulling the directory there has to go through the app.
 *
 *   npm run import:crm
 *
 * Reads CRM_DATABASE_URL from the environment, or from .env.local.
 */
import { readFileSync } from 'node:fs';
import { importCrmCustomers } from '../src/lib/crm-import';

/**
 * Next loads .env.local for the app, but a tsx script gets a bare environment.
 * Reading the file here means `npm run import:crm` works with no ceremony.
 */
function fromEnvLocal(key: string): string | undefined {
  try {
    const line = readFileSync('.env.local', 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') || undefined;
  } catch {
    return undefined;
  }
}

process.env.CRM_DATABASE_URL ||= fromEnvLocal('CRM_DATABASE_URL') ?? '';

if (!process.env.CRM_DATABASE_URL) {
  console.error(
    'CRM_DATABASE_URL חסר.\n' +
      'הוסיפו אותו ל-.env.local (הערך זהה ל-DATABASE_URL של ה-CRM), או העבירו בשורת הפקודה.',
  );
  process.exit(1);
}

const result = await importCrmCustomers();

console.log(`נקראו ${result.read} לקוחות מה-CRM`);
console.log(`\nספריית הלקוחות: ${result.before} → ${result.after} רשומות`);
console.log(`  חברות: ${result.companies} · פרטיים: ${result.people}`);
console.log(`  חברות שיובאו כפרטיים (שם איש קשר = שם חברה): ${result.flattened}`);
console.log(`  מיילים מומצאים שהושמטו: ${result.droppedEmails}`);
console.log('\nהרצה חוזרת תעדכן את הרשומות הקיימות ולא תכפיל אותן.');
