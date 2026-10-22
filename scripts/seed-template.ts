/**
 * Loads the built template into the database and makes it active.
 *
 * The database is the source of truth at runtime; this is the one-time bridge
 * from the build artefact into it. Re-running is safe — it stores a new version
 * and activates it, leaving the previous one available to roll back to.
 *
 *   npm run seed
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeTemplate, listTemplates, type TemplateKind } from '../src/lib/docx/template-store';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pathArgument = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const kindArgument = process.argv.find((arg) => arg.startsWith('--kind='));
const kind = (kindArgument?.slice('--kind='.length) || 'radiation') as TemplateKind;
const TEMPLATE = pathArgument ? resolve(pathArgument) : resolve(ROOT, 'templates/report-template.docx');

if (!existsSync(TEMPLATE)) {
  console.error(`התבנית לא נמצאה: ${TEMPLATE}`);
  console.error('הרץ תחילה `npm run build:template`.');
  process.exit(1);
}

const bytes = readFileSync(TEMPLATE);
const stored = storeTemplate(bytes, basename(TEMPLATE), 'נטען אוטומטית מתיקיית templates', kind);

console.log(`התבנית נטענה: ${stored.name}`);
console.log(`  גודל   ${(stored.size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  sha256 ${stored.sha256.slice(0, 16)}…`);
console.log(`  פעילה  ${stored.isActive ? 'כן' : 'לא'}`);

const all = listTemplates(kind);
if (all.length > 1) console.log(`\nסה"כ ${all.length} גרסאות תבנית שמורות.`);
