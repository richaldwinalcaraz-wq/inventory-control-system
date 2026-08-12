import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = path.join(process.cwd(), "storage", "evidence");

export class InvalidPhotoDataError extends Error {}

/**
 * Local-dev-only storage driver: decodes a data URL captured by the
 * in-page getUserMedia() canvas component and writes it to disk outside
 * the public/ tree (never directly web-servable). Production should swap
 * this for the real S3/MinIO driver the plan specifies — the interface
 * (dataUrl in, storageKey out) doesn't need to change when that happens.
 */
export async function saveEvidencePhoto(dataUrl: string): Promise<string> {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new InvalidPhotoDataError("Evidence photo must be a base64 image data URL (png/jpeg/webp).");
  }
  const [, ext, base64] = match;
  const buffer = Buffer.from(base64!, "base64");

  await mkdir(EVIDENCE_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  await writeFile(path.join(EVIDENCE_DIR, filename), buffer);

  return `local:${filename}`;
}
