import "server-only";

import { getGoogleAccessToken } from "@/lib/gmail";

/**
 * Google Drive uploads via the `drive.file` scope (app-created files only). We
 * keep a top-level "ClientFlow" folder and drop each export into a named subfolder
 * (e.g. "Invoices — last 3 months"). Reuses the same OAuth token as Gmail.
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

async function auth(tenantId: number): Promise<Record<string, string>> {
  const token = await getGoogleAccessToken(tenantId);
  if (!token) throw new Error("Google isn't connected.");
  return { Authorization: `Bearer ${token}` };
}

/** Find (or create) a folder by name, optionally within a parent. Returns its id. */
export async function ensureDriveFolder(
  tenantId: number,
  name: string,
  parentId?: string,
): Promise<string> {
  const headers = await auth(tenantId);
  const clauses = [`mimeType='${FOLDER_MIME}'`, `name='${name.replace(/'/g, "\\'")}'`, "trashed=false"];
  if (parentId) clauses.push(`'${parentId}' in parents`);
  const listUrl = `${DRIVE_API}/files?q=${encodeURIComponent(clauses.join(" and "))}&fields=files(id,name)&spaces=drive`;
  const listRes = await fetch(listUrl, { headers });
  if (listRes.ok) {
    const data = (await listRes.json()) as { files?: { id: string }[] };
    if (data.files && data.files.length) return data.files[0].id;
  }
  const createRes = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  if (!createRes.ok) throw new Error(`Drive folder create failed: ${createRes.status} ${await createRes.text()}`);
  return ((await createRes.json()) as { id: string }).id;
}

/** Upload one file (bytes) into a Drive folder via multipart. */
export async function uploadToDrive(
  tenantId: number,
  folderId: string,
  file: { name: string; mimeType: string; bytes: Buffer },
): Promise<{ id: string; link?: string }> {
  const headers = await auth(tenantId);
  const boundary = "cfb" + Math.random().toString(36).slice(2);
  const metadata = JSON.stringify({ name: file.name, parents: [folderId] });
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
  );
  const post = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([pre, file.bytes, post]);
  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { ...headers, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string; webViewLink?: string };
  return { id: data.id, link: data.webViewLink };
}

export type DriveUploadResult = { folderId: string; folderLink: string; uploaded: number };

/** Upload a batch of files into ClientFlow/<folderName>. Returns a browsable link. */
export async function uploadFilesToDrive(
  tenantId: number,
  folderName: string,
  files: { name: string; mimeType: string; bytes: Buffer }[],
): Promise<DriveUploadResult> {
  const root = await ensureDriveFolder(tenantId, "ClientFlow");
  const folderId = await ensureDriveFolder(tenantId, folderName, root);
  let uploaded = 0;
  for (const f of files) {
    try {
      await uploadToDrive(tenantId, folderId, f);
      uploaded++;
    } catch {
      /* skip a single failed file */
    }
  }
  return { folderId, folderLink: `https://drive.google.com/drive/folders/${folderId}`, uploaded };
}
