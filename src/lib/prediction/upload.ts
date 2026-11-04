import { upload as uploadToBlob } from '@vercel/blob/client';
import { api } from './api';

// Parts that fail on a weak connection are retried alone, so larger files go in parts.
const MULTIPART_FROM_BYTES = 20 * 1024 * 1024;

export type UploadMeta = {
  direct_upload: boolean;
  file_types: string[];
  file_content_types: Record<string, string>;
  max_upload_bytes: number;
};

/**
 * One plan into the project.
 *
 * Deployed, straight from the browser to storage: a plan is larger than the engine's
 * functions may receive, so only a short-lived token passes through this app and the
 * engine. Locally, through the API itself.
 */
export async function uploadPlan(
  projectId: string,
  file: File,
  documentType: string,
  meta: UploadMeta,
  onProgress?: (percentage: number) => void,
): Promise<void> {
  if (!meta.direct_upload) {
    const form = new FormData();
    form.append('file', file);
    form.append('document_type', documentType);
    await api(`/projects/${projectId}/documents`, { method: 'POST', body: form });
    return;
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const contentType = meta.file_content_types[extension];
  if (!contentType) throw new Error(`סוג קובץ לא נתמך. מותר: ${meta.file_types.join(', ')}`);
  if (file.size > meta.max_upload_bytes) {
    throw new Error(`הקובץ גדול מ-${Math.round(meta.max_upload_bytes / 1024 / 1024)} MB`);
  }
  const pathname = `uploads/${projectId}/${crypto.randomUUID()}.${extension}`;
  await uploadToBlob(pathname, file, {
    access: 'private',
    contentType,
    handleUploadUrl: '/api/prediction/upload-url',
    clientPayload: projectId,
    multipart: file.size >= MULTIPART_FROM_BYTES,
    onUploadProgress: ({ percentage }) => onProgress?.(Math.round(percentage)),
  });
  await api(`/projects/${projectId}/documents/register`, {
    method: 'POST',
    json: { pathname, file_name: file.name, document_type: documentType },
  });
}
