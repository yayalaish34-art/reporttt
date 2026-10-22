import { NextResponse } from 'next/server';
import { TEMPLATE_KINDS, storeTemplate, type TemplateKind } from '@/lib/docx/template-store';

/**
 * Uploads a template and makes it active, without going through the screen.
 *
 * The templates page already does this through a server action, and for a person that
 * is the right shape. This exists for the case the action cannot serve: replacing a
 * template from a script or a deploy step — which is how a template that shipped with
 * a bug gets fixed on a running instance.
 *
 * That case is not hypothetical. The active template lives in the database, and an
 * uploaded one takes precedence over the file in the image *forever* — so a template
 * rebuilt in the repository does not reach production by deploying. It has to be
 * uploaded, and until now the only way to upload was by hand.
 *
 * Guarded by APP_PASSWORD, the same secret that protects the rest of the deployment.
 * Where no password is set the app is already open to anyone with the address, so
 * demanding one here would protect nothing and would only break local use.
 */
export const maxDuration = 120;

export async function POST(request: Request) {
  const expected = process.env.APP_PASSWORD;
  if (expected) {
    // Bearer, so the secret rides in a header rather than in a URL that would be
    // written to every access log it passes through.
    const provided = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (provided !== expected) {
      return NextResponse.json({ error: 'לא מורשה' }, { status: 401 });
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'לא התקבל קובץ' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'לא נבחר קובץ' }, { status: 400 });
  }

  /*
   * Matched against the known kinds rather than cast — see `uploadTemplate`. An
   * unrecognised kind must not fall through to radiation and replace the radiation
   * template with somebody else's document.
   */
  const requested = String(form.get('kind') ?? '');
  if (!(requested in TEMPLATE_KINDS)) {
    return NextResponse.json(
      { error: `סוג תבנית לא מוכר: "${requested}". הסוגים: ${Object.keys(TEMPLATE_KINDS).join(', ')}` },
      { status: 400 },
    );
  }
  const kind = requested as TemplateKind;

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = storeTemplate(bytes, file.name, String(form.get('note') ?? ''), kind);
    return NextResponse.json({
      ok: true,
      id: stored.id,
      kind: stored.kind,
      name: stored.name,
      size: stored.size,
      sha256: stored.sha256,
      isActive: stored.isActive,
    });
  } catch (err) {
    // `storeTemplate` rejects anything that is not a readable .docx, and its message
    // says which part was wrong — worth passing on rather than flattening to a 500.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'העלאת התבנית נכשלה' },
      { status: 422 },
    );
  }
}
