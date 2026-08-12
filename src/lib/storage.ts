import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

/**
 * Local-disk file storage for dev. Files land under public/uploads/{tenantId}/
 * and are served directly by Next's static file handling at /uploads/...
 * Not suitable for multi-server production deployment — swap for S3/R2 etc.
 * without touching callers, since they only see { filePath, sizeBytes }.
 */
export async function saveUploadedFile(
  tenantId: string,
  file: File
): Promise<{ filePath: string; fileName: string; mimeType: string; sizeBytes: number }> {
  const tenantDir = path.join(UPLOAD_ROOT, tenantId);
  await mkdir(tenantDir, { recursive: true });

  const ext = path.extname(file.name);
  const safeName = `${randomUUID()}${ext}`;
  const diskPath = path.join(tenantDir, safeName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(diskPath, buffer);

  return {
    filePath: `/uploads/${tenantId}/${safeName}`,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: buffer.byteLength,
  };
}

export function guessAssetType(mimeType: string): "IMAGE" | "VIDEO" | "DOCUMENT" | "OTHER" {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType === "application/pdf" || mimeType.startsWith("text/") || mimeType.includes("document")) {
    return "DOCUMENT";
  }
  return "OTHER";
}
