/**
 * Fetches a produced document and hands it to the browser as a saved file — and only
 * resolves once it has.
 *
 * The editors used to click a link to the document and leave for the list 1.8 seconds
 * later. Producing a mould report words its closing sections with a model first, which
 * takes ten to twenty seconds, so the page was gone long before the file was: the
 * browser cancelled the request (499 in the server log) and the surveyor who had just
 * pressed "סיום" never got the document. The server kept going and filed it on the
 * customer's card, which is why it looked as though the report had been produced.
 *
 * Waiting for the whole response and saving it from memory means the caller can leave
 * the page the moment this returns.
 */
export async function downloadDocument(href: string, fallbackName = 'דוח.docx'): Promise<void> {
  const response = await fetch(href, { cache: 'no-store' });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `הפקת המסמך נכשלה (${response.status})`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameFrom(response.headers.get('Content-Disposition')) ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // The file is already in memory, so the save starts at once; a moment's grace before
  // the caller navigates away, and the object URL is released with the page.
  await new Promise((resolve) => setTimeout(resolve, 800));
}

/** The Hebrew file name the server set — `filename*=UTF-8''…` wins over the ASCII fallback. */
function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      /* falls through to the plain name */
    }
  }
  return disposition.match(/filename="([^"]+)"/i)?.[1] ?? null;
}
