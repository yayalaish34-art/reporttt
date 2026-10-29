import { AiDraftError, aiDraftingAvailable, draftMoldConclusions } from './ai-text';
import {
  compareWithOutdoor,
  describeMoldFindings,
  hasSignificantFinding,
  hasWaterDamageMarkers,
  indoorAirSamples,
  outdoorAirSample,
  surfaceSamples,
  moistureText,
} from './mold-rules';
import { MOISTURE_INSTRUMENT } from './mold-schema';
import type { MoldReport } from './mold-schema';

/**
 * Wording the closing sections of a mould report from what the laboratory found.
 *
 * The four closing passages — the air summary, the surface summary, the conclusions
 * and the recommendations — are the part of this report a customer acts on, and every
 * fact in them is already sitting in the sample rows. Writing them by hand meant
 * stating those facts a second time, which is slow and, in a signed document, is how
 * the summary comes to disagree with the table above it.
 *
 * So they are drafted here from the rows, at production time. The comparison against
 * the outdoor control is not left to the model: it is computed in `mold-rules` and
 * handed over as a conclusion the model must respect, because "significantly elevated"
 * is a judgement with a threshold behind it and not a turn of phrase.
 *
 * Never throws. A survey whose drafting failed still has to produce a document — the
 * surveyor pressed "סיום" and is owed one — so a failure leaves whatever the report
 * already carried, which is either an earlier draft or the surveyor's own words.
 */

export interface MoldDraft {
  executiveSummary: string;
  purposeDescription: string;
  interpretations: Record<string, string>;
  moistureNotes: Record<string, string>;
  moistureAssessments: Record<string, string>;
  moistureNarrative: string;
  conclusions: string[];
  recommendations: string[];
}

/**
 * Drafts the closing sections, falling back to what the report already says.
 *
 * The fallback is the whole reason this wrapper exists. `draftMoldConclusions` throws
 * on an unreachable model, an unparseable answer or a missing key, and none of those
 * is a reason to refuse a surveyor their document.
 */
export async function draftMoldReport(report: MoldReport): Promise<MoldDraft> {
  const existing: MoldDraft = {
    executiveSummary: report.executiveSummary,
    purposeDescription: report.purposeDescription,
    interpretations: report.interpretations,
    moistureNotes: report.moistureNotes,
    moistureAssessments: report.moistureAssessments,
    moistureNarrative: report.moistureNarrative,
    conclusions: report.conclusions,
    recommendations: report.recommendations,
  };

  // Nothing to draft from, or nowhere to draft with.
  if (!aiDraftingAvailable()) return existing;
  if (indoorAirSamples(report).length === 0 && surfaceSamples(report).length === 0) return existing;

  try {
    const drafted = await draftMoldConclusions(buildFacts(report));
    return {
      // A section the model returned empty keeps whatever was there: an empty string
      // in a signed report is a hole, and the previous wording is better than one.
      executiveSummary: drafted.executiveSummary || existing.executiveSummary,
      purposeDescription: drafted.purposeDescription || existing.purposeDescription,
      /*
       * Merged rather than replaced, so a sentence the surveyor edited survives a
       * re-draft while a sample the model did not reach keeps whatever it had.
       */
      interpretations: {
        ...existing.interpretations,
        ...alignInterpretationKeys(report, drafted.interpretations),
      },
      moistureNotes: {
        ...existing.moistureNotes,
        ...alignInterpretationKeys(report, drafted.moistureNotes),
      },
      moistureAssessments: {
        ...existing.moistureAssessments,
        ...alignInterpretationKeys(report, drafted.moistureAssessments),
      },
      moistureNarrative: drafted.moistureNarrative || existing.moistureNarrative,
      conclusions: drafted.conclusions.length > 0 ? drafted.conclusions : existing.conclusions,
      recommendations:
        drafted.recommendations.length > 0 ? drafted.recommendations : existing.recommendations,
    };
  } catch (err) {
    console.error(
      'ניסוח המסקנות של דוח העובשים נכשל — נשאר הנוסח הקיים',
      err instanceof AiDraftError ? err.message : err,
    );
    return existing;
  }
}

/**
 * The facts the wording is built from, as a block of plain text.
 *
 * Deliberately not the report object. What the model needs is the findings and the
 * comparisons already drawn — handing it the raw rows would invite it to work out the
 * indoor/outdoor ratio itself, which is exactly the judgement that belongs in code.
 */
function buildFacts(report: MoldReport): string {
  const outdoor = outdoorAirSample(report);
  const lines: string[] = [];

  if (report.siteAddress.trim()) lines.push(`כתובת הבדיקה: ${report.siteAddress.trim()}.`);
  if (report.buildingDescription.trim()) lines.push(`המבנה: ${report.buildingDescription.trim()}.`);
  if (report.siteDescription.trim()) lines.push(`תיאור המקום: ${report.siteDescription.trim()}`);
  if (report.customerClaim.trim()) lines.push(`טענת המזמין: ${report.customerClaim.trim()}`);
  lines.push('');

  const moistureOn = report.moistureSurveyed === 'כן';

  lines.push('דגימות אוויר מתוך המבנה:');
  for (const sample of indoorAirSamples(report)) {
    const comparison = compareWithOutdoor(sample, outdoor);
    lines.push(
      `  [${sample.labNumber || 'ללא מספר'}] ${sample.location}: ${
        sample.totalCount || 'ללא תוצאה'
      } נבגים/מ״ק` +
        (sample.organisms ? `; אורגניזמים: ${sample.organisms}` : '') +
        // The band, not the ratio: the model is told the answer, not asked for it.
        (comparison ? `; ביחס לדגימת החוץ — ${comparison}` : '; אין דגימת חוץ להשוואה') +
        (sample.note.trim() ? `; הערה: ${sample.note.trim()}` : '') +
        (moistureOn
          ? moistureText(sample)
            ? `; קריאות לחות בחדר: ${moistureText(sample)}`
            : '; לא נמסרה קריאת לחות עבור נקודה זו'
          : ''),
    );
  }

  if (outdoor) {
    // Named "Outdoors" here too, not whatever the surveyor typed or Hayes' own
    // "OUTSIDE" — the model then has no reason to echo back a different word for it.
    lines.push(
      '',
      `דגימת חוץ (ביקורת) — [${outdoor.labNumber || 'ללא מספר'}] Outdoors: ${
        outdoor.totalCount || 'ללא תוצאה'
      } נבגים/מ״ק` +
        (outdoor.organisms ? `; אורגניזמים: ${outdoor.organisms}` : '') +
        (moistureOn ? '; לא נמדדה לחות בנקודה זו — דגימת אוויר חיצונית' : ''),
    );
  } else {
    lines.push('', 'לא נלקחה דגימת אוויר חיצונית להשוואה.');
  }

  const surfaces = surfaceSamples(report);
  if (surfaces.length > 0) {
    lines.push('', 'דגימות משטח:');
    for (const sample of surfaces) {
      lines.push(
        `  [${sample.labNumber || 'ללא מספר'}] ${sample.location}: ${sample.organisms || 'ללא ממצא מדווח'}` +
          (sample.note.trim() ? `; הערה: ${sample.note.trim()}` : ''),
      );
    }
  }

  lines.push(
    '',
    moistureOn
      ? `בוצעה בדיקת לחות בקירות במכשיר ${MOISTURE_INSTRUMENT} (קיבולי, לא-הרסני ואינדיקטיבי) ליד כל דגימת אוויר פנימית — הקריאות מופיעות בשורות הדגימות למעלה.`
      : 'לא בוצעה בדיקת לחות בקירות בסקר זה — אין להזכיר לחות, מוקדי רטיבות או מדידות לחות באף חלק.',
  );

  // The three facts that decide which standing paragraphs belong in the conclusions.
  lines.push(
    '',
    'המפתח שבסוגריים הוא מספר הדגימה — השתמש בו כמפתח ב-interpretations, moistureNotes ו-moistureAssessments.',
    `ממצא חריג משמעותי באוויר: ${hasSignificantFinding(report) ? 'כן' : 'לא'}.`,
    `נמצאו סמני נזקי מים (Stachybotrys / Chaetomium / Memnoniella / Ulocladium): ${
      hasWaterDamageMarkers(report) ? 'כן' : 'לא'
    }.`,
  );

  return lines.join('\n');
}

/** Exposed for the tests: the findings a draft would be written from. */
export function moldDraftFindings(report: MoldReport): string[] {
  return describeMoldFindings(report);
}

/**
 * Puts each drafted sentence under the key the editor reads it back by.
 *
 * The editor keys a sample's interpretation by its laboratory number, and the model is
 * told to do the same. It does not always: asked about a sample the facts introduce as
 * "[807-1] Room 124-4", it sometimes answers under the room name instead. Keyed that
 * way the sentence is stored, printed nowhere, and shows on screen as an empty box —
 * which is exactly what it looked like when every interpretation came back blank.
 *
 * So a key that is not a laboratory number is matched against the rooms and rewritten
 * to the number. A key that matches nothing is kept as it is rather than dropped: it is
 * still the model's answer about something, and losing it silently is the failure this
 * exists to prevent.
 */
function alignInterpretationKeys(
  report: MoldReport,
  drafted: Record<string, string>,
): Record<string, string> {
  const byNumber = new Set(
    report.labResults.map((r) => r.labNumber.trim()).filter(Boolean),
  );

  /** Room name → laboratory number, for the keys that come back the wrong way round. */
  const numberOfRoom = new Map<string, string>();
  for (const result of report.labResults) {
    const number = result.labNumber.trim();
    if (!number) continue;
    const name = result.sampleName.trim();
    if (name) numberOfRoom.set(name.toLowerCase(), number);
  }
  for (const sample of report.samples) {
    const number = sample.labNumber.trim();
    const name = sample.location.trim();
    if (number && name) numberOfRoom.set(name.toLowerCase(), number);
  }

  const aligned: Record<string, string> = {};
  for (const [key, text] of Object.entries(drafted)) {
    const trimmed = key.trim();
    if (byNumber.has(trimmed)) {
      aligned[trimmed] = text;
      continue;
    }
    aligned[numberOfRoom.get(trimmed.toLowerCase()) ?? trimmed] = text;
  }
  return aligned;
}
