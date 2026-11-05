import { api } from './api';

export type UploadMeta = {
  file_types: string[];
  max_upload_bytes: number;
};

/** One plan into the project, straight to the engine, which keeps it on its own disk. */
export async function uploadPlan(
  projectId: string,
  file: File,
  documentType: string,
  meta: UploadMeta,
  onProgress?: (percentage: number) => void,
): Promise<void> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!meta.file_types.includes(extension)) throw new Error(`סוג קובץ לא נתמך. מותר: ${meta.file_types.join(', ')}`);
  if (file.size > meta.max_upload_bytes) {
    throw new Error(`הקובץ גדול מ-${Math.round(meta.max_upload_bytes / 1024 / 1024)} MB`);
  }
  const form = new FormData();
  form.append('file', file);
  form.append('document_type', documentType);
  onProgress?.(0);
  await api(`/projects/${projectId}/documents`, { method: 'POST', body: form });
  onProgress?.(100);
}
