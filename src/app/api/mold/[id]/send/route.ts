import { NextResponse } from 'next/server';
import { loadMoldReport } from '@/lib/mold-service';
import { crmSendReportUrl, sendBlockedReason } from '@/lib/crm-links';

/**
 * Hands the surveyor to the CRM's mail form, opened on this mould report.
 *
 * Identical to the other three routes, and for the same reason: sending happens in
 * the CRM, over the sender's own Outlook account, because that is where there is an
 * identity to send as.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = loadMoldReport(id);
  if (!report) {
    return NextResponse.json({ error: 'הדוח לא נמצא' }, { status: 404 });
  }

  // `sendBlockedReason` reads only the two fields every report kind shares.
  const blocked = sendBlockedReason(report as never);
  if (blocked) return explain(blocked, id);

  return NextResponse.redirect(crmSendReportUrl(report as never)!, 302);
}

/** The reason as a page, since this opens in a tab the surveyor is looking at. */
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
<a href="/mold/${reportId}">חזרה לדוח</a>
</div></body></html>`;
  return new NextResponse(html, {
    status: 409,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
