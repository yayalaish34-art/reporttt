'use client';

import { upload as uploadToBlob } from '@vercel/blob/client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, errorText, fileUrl } from '@/lib/prediction/api';
import { DOCUMENT_LABELS, label } from '@/lib/prediction/labels';

// Parts that fail on a weak connection are retried alone, so larger files go in parts.
const MULTIPART_FROM_BYTES = 20 * 1024 * 1024;

export default function DocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const [documents, setDocuments] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [type, setType] = useState('ARCHITECTURAL');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api(`/projects/${id}/documents`)
      .then(setDocuments)
      .catch((failure) => setError(errorText(failure)));
  }, [id]);

  useEffect(load, [load]);
  useEffect(() => {
    api('/meta')
      .then(setMeta)
      .catch((failure) => setError(errorText(failure)));
  }, []);

  /**
   * Straight from the browser to storage. A plan is larger than the engine's functions may
   * receive, so only a short-lived token passes through this app and the engine.
   */
  async function uploadDirectly(chosen: File) {
    const extension = chosen.name.split('.').pop()?.toLowerCase() ?? '';
    const contentType = meta.file_content_types[extension];
    if (!contentType) throw new Error(`סוג קובץ לא נתמך. מותר: ${meta.file_types.join(', ')}`);
    if (chosen.size > meta.max_upload_bytes) {
      throw new Error(`הקובץ גדול מ-${Math.round(meta.max_upload_bytes / 1024 / 1024)} MB`);
    }
    const pathname = `uploads/${id}/${crypto.randomUUID()}.${extension}`;
    await uploadToBlob(pathname, chosen, {
      access: 'private',
      contentType,
      handleUploadUrl: '/api/prediction/upload-url',
      clientPayload: id,
      multipart: chosen.size >= MULTIPART_FROM_BYTES,
      onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
    });
    await api(`/projects/${id}/documents/register`, {
      method: 'POST',
      json: { pathname, file_name: chosen.name, document_type: type },
    });
  }

  async function uploadThroughApi(chosen: File) {
    const form = new FormData();
    form.append('file', chosen);
    form.append('document_type', type);
    await api(`/projects/${id}/documents`, { method: 'POST', body: form });
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    const chosen = file.current?.files?.[0];
    if (!chosen || !meta) return;
    setBusy(true);
    setError('');
    setProgress(null);
    try {
      await (meta.direct_upload ? uploadDirectly(chosen) : uploadThroughApi(chosen));
      if (file.current) file.current.value = '';
      load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <>
      <form className="card row" onSubmit={upload}>
        <input ref={file} type="file" accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf,.ifc" required style={{ width: 'auto' }} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(DOCUMENT_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <button className="btn-primary" disabled={busy || !meta}>
          {busy ? (progress === null ? 'מעלה…' : `מעלה… ${progress}%`) : 'העלאה'}
        </button>
      </form>
      {error && <div className="notice error">{error}</div>}
      <p className="muted small">
        קובצי DWG, DXF ו-IFC נשמרים בגרסאות, אך בשלב זה אינם מוצגים ואינם מנותחים. לעבודה על התוכנית יש להעלות PDF, PNG או
        JPG.
      </p>
      {documents.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>קובץ</th>
                  <th>סוג</th>
                  <th>גרסה</th>
                  <th>עמודים</th>
                  <th>הועלה</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td>
                      <a href={fileUrl(`/projects/${id}/documents/${document.id}/file`)}>{document.file_name}</a>
                    </td>
                    <td>{label(DOCUMENT_LABELS, document.document_type)}</td>
                    <td>{document.revision}</td>
                    <td>{document.page_count}</td>
                    <td>{new Date(document.upload_date).toLocaleDateString('he-IL')}</td>
                    <td>
                      {document.status === 'CURRENT' ? <span className="tag ok">נוכחי</span> : <span className="tag">הוחלף</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
