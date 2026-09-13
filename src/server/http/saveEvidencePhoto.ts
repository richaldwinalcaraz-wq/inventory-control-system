import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";

const EVIDENCE_DIR = path.join(process.cwd(), "storage", "evidence");

export class InvalidPhotoDataError extends Error {}

/**
 * Decodes a data URL captured by the in-page getUserMedia() canvas
 * component and persists it, returning an opaque storageKey. Driver
 * selected by EVIDENCE_STORAGE_DRIVER (see .env.example):
 * - "filesystem" (default): writes to disk outside the public/ tree, never
 *   web-servable. Local dev only — a Vercel serverless function has no
 *   persistent or shared filesystem, so this silently loses files there.
 * - "vercel-blob": required in production. Needs BLOB_READ_WRITE_TOKEN,
 *   which Vercel injects automatically once a Blob store is connected to
 *   the project (Storage tab). Returns the blob's public URL as the
 *   storageKey.
 */
export async function saveEvidencePhoto(dataUrl: string): Promise<string> {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new InvalidPhotoDataError("Evidence photo must be a base64 image data URL (png/jpeg/webp).");
  }
  const [, ext, base64] = match;
  const buffer = Buffer.from(base64!, "base64");
  const filename = `${randomUUID()}.${ext}`;

  if (process.env.EVIDENCE_STORAGE_DRIVER === "vercel-blob") {
    const blob = await put(`evidence/${filename}`, buffer, {
      access: "public",
      contentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
    });
    return blob.url;
  }

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(path.join(EVIDENCE_DIR, filename), buffer);
  return `local:${filename}`;
}
