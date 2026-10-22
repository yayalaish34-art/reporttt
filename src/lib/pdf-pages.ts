/**
 * Turns a PDF selected in the browser into ordinary JPEG files, one per page.
 *
 * The mould workflow is built around page images: the vision endpoint reads them and
 * the DOCX appendix stores them. Rendering the PDF here lets a laboratory PDF enter
 * that exact path without uploading the original document to a separate file store.
 */

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 30;
const LONG_EDGE_PIXELS = 3000;
const MAX_RENDER_SCALE = 4;

export function isPdf(file: File): boolean {
  return file.type.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Expands PDFs and leaves ordinary image files untouched, preserving their order. */
export async function expandPdfPages(files: File[]): Promise<File[]> {
  const expanded: File[] = [];

  for (const file of files) {
    if (isPdf(file)) expanded.push(...(await pdfPagesAsImages(file)));
    else expanded.push(file);
  }

  return expanded;
}

async function pdfPagesAsImages(file: File): Promise<File[]> {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(`קובץ ה-PDF "${file.name}" גדול מדי (מעל 50MB).`);
  }

  // The webpack entry creates PDF.js's module worker with a URL emitted by Next.
  // It is loaded only after the user chooses a PDF, so ordinary photo uploads do not
  // download the comparatively large PDF renderer.
  const pdfjs = await import('pdfjs-dist/webpack.mjs');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });

  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(
        `בקובץ ה-PDF "${file.name}" יש ${document.numPages} עמודים. ניתן להעלות עד ${MAX_PDF_PAGES} עמודים בבת אחת.`,
      );
    }

    const images: File[] = [];
    const baseName = file.name.replace(/\.pdf$/i, '').trim() || 'דוח PDF';

    // Sequential rendering keeps only one full-resolution canvas in memory. A phone
    // can otherwise run out of memory while opening an entirely ordinary lab report.
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        MAX_RENDER_SCALE,
        Math.max(1, LONG_EDGE_PIXELS / Math.max(baseViewport.width, baseViewport.height)),
      );
      const viewport = page.getViewport({ scale });

      const canvas = window.document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('הדפדפן לא הצליח להכין את עמודי ה-PDF כתמונות.');

      // PDF pages may be transparent; the appendix and JPEG both need a white sheet.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' }).promise;

      const blob = await canvasToJpeg(canvas);
      images.push(
        new File([blob], `${baseName} - עמוד ${pageNumber}.jpg`, {
          type: 'image/jpeg',
          lastModified: file.lastModified,
        }),
      );

      page.cleanup();
      // Release the backing bitmap before the next page is allocated.
      canvas.width = 1;
      canvas.height = 1;
    }

    return images;
  } catch (error) {
    if (error instanceof Error && /^קובץ ה-PDF|^בקובץ ה-PDF|^הדפדפן/.test(error.message)) {
      throw error;
    }
    throw new Error(`לא ניתן לפתוח את קובץ ה-PDF "${file.name}". ודאו שהקובץ תקין ואינו מוגן בסיסמה.`);
  } finally {
    await loadingTask.destroy();
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('המרת עמוד ה-PDF לתמונה נכשלה.'));
      },
      'image/jpeg',
      0.94,
    );
  });
}
