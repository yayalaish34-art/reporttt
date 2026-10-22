import { NextResponse } from 'next/server';
import { loadReport } from '@/lib/report-service';
import { crmSendReportUrl, sendBlockedReason } from '@/lib/crm-links';

/**
 * The reason, as a page rather than as JSON.
 *
 * This opens in a tab the surveyor is looking at, so a raw `{"error": …}` would
 * be the answer to a question they did not ask. Same words, readable, with the
 * way back.
 */
function explain(reason: string, reportId: string): NextResponse {
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>לא ניתן לשלוח עדיין</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f7f7;
    color:#16211f;font:16px/1.6 system-ui,"Segoe UI",sans-serif;padding:24px}
  .box{max-width:34rem;background:#fff;border:1px solid #d7e0df;border-radius:4px;padding:28px 30px}
  h1{font-size:1.3rem;margin:0 0 10px}
  p{margin:0 0 20px;color:#4a5c5a}
  a{display:inline-block;background:#0e5b5f;color:#fff;text-decoration:none;
    padding:9px 18px;border-radius:3px}
</style></head><body><div class="box">
<h1>לא ניתן לשלוח עדיין</h1>
<p>${reason}</p>
<a href="/reports/${reportId}">חזרה לדוח</a>
</div></body></html>`;
  return new NextResponse(html, {
    status: 409,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Hands the surveyor to the CRM's mail form, opened on this report.
 *
 * A redirect rather than a link built in the page, because the thing it needs —
 * the id the report was filed under in the CRM — is written during the download
 * and would otherwise be whatever the page happened to be holding when it
 * loaded. Resolving it here means the button is right the moment the file is
 * produced, with nothing to refresh.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = loadReport(id);
  if (!report) {
    return NextResponse.json({ error: 'הדוח לא נמצא' }, { status: 404 });
  }

  const blocked = sendBlockedReason(report);
  if (blocked) return explain(blocked, id);

  return NextResponse.redirect(crmSendReportUrl(report)!, 302);
}
