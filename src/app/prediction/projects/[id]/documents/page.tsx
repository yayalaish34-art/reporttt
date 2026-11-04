'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, errorText, fileUrl } from '@/lib/prediction/api';
import { DOCUMENT_LABELS, label } from '@/lib/prediction/labels';
import { uploadPlan } from '@/lib/prediction/upload';

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

  async function upload(event: FormEvent) {
    event.preventDefault();
    const chosen = file.current?.files?.[0];
    if (!chosen || !meta) return;
    setBusy(true);
    setError('');
    setProgress(null);
    try {
      await uploadPlan(id, chosen, type, meta, setProgress);
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
