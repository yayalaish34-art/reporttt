/**
 * Optional integration smoke for the live CRM. Run with CRM_DATABASE_URL set.
 * It deliberately prints no customer PII.
 */
import { iaqPrefillFromQuote, listIaqQuotes } from '../src/lib/iaq-quote-import';

const result = await listIaqQuotes();
if (result.error) throw new Error(result.error);
if (result.quotes.length === 0) throw new Error('לא נמצאו הצעות מחיר לשירות IAQ (מק״ט 72)');

const selected = result.quotes[0];
const prefill = await iaqPrefillFromQuote(selected.id);
if (prefill.sourceQuoteId !== selected.id) throw new Error('מזהה הצעת המחיר לא מופה');
if (!prefill.customerId) throw new Error('מזהה הלקוח לא מופה');
if (!prefill.recipientName && !prefill.companyName) throw new Error('שם הלקוח לא מופה');

const populated = Object.values(prefill).filter((value) => String(value ?? '').trim()).length;
console.log(`✓ IAQ quote import עובר — נמצאו ${result.quotes.length} הצעות, ${populated} שדות מולאו`);
