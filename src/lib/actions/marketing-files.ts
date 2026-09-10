"use server";

import { unlink } from "node:fs/promises";
import path from "node:path";
import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { saveUploadedFile } from "@/lib/storage";
import { revalidatePath } from "next/cache";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB -- generous for marketing assets (logos, PDFs, decks), not video

export type MarketingFileType = "image" | "pdf" | "document" | "other";

function fileTypeFromMime(mimeType: string): MarketingFileType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("document") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("presentation")
  ) {
    return "document";
  }
  return "other";
}

export async function uploadFileAction(input: { file: File }) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "files", "create");
  if (!permCheck.ok) return permCheck;

  const file = input.file;
  if (!file || file.size === 0) return { ok: false as const, error: "Choose a file to upload." };
  if (file.size > MAX_FILE_BYTES) return { ok: false as const, error: "File must be under 25MB." };

  const saved = await saveUploadedFile(session.tenantId!, file);
  const type = fileTypeFromMime(saved.mimeType);

  const created = await withTenant(session.tenantId!, async (tx) => {
    const row = await tx.marketingFile.create({
      data: {
        tenantId: session.tenantId!,
        name: saved.fileName,
        url: saved.filePath,
        type,
        size: saved.sizeBytes,
        mimeType: saved.mimeType,
        uploadedById: session.id,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: session.id,
        action: "marketing_file.uploaded",
        resource: "files",
        tenantId: session.tenantId,
        newValue: JSON.stringify({ name: saved.fileName, type, size: saved.sizeBytes }),
        device: "Desktop",
        browser: "Agency OS",
      },
    });

    return row;
  });

  revalidatePath("/agency/files");
  return { ok: true as const, file: created };
}

export async function listFilesAction(type?: MarketingFileType) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "files", "view");
  if (!permCheck.ok) return permCheck;

  const files = await withTenant(session.tenantId!, (tx) =>
    tx.marketingFile.findMany({
      where: { tenantId: session.tenantId!, ...(type ? { type } : {}) },
      orderBy: { createdAt: "desc" },
    })
  );

  return { ok: true as const, files };
}

export async function deleteFileAction(fileId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "files", "delete");
  if (!permCheck.ok) return permCheck;

  const deleted = await withTenant(session.tenantId!, async (tx) => {
    const file = await tx.marketingFile.findFirst({ where: { id: fileId, tenantId: session.tenantId! } });
    if (!file) return null;
    await tx.marketingFile.delete({ where: { id: fileId } });

    await tx.auditLog.create({
      data: {
        actorId: session.id,
        action: "marketing_file.deleted",
        resource: "files",
        tenantId: session.tenantId,
        oldValue: JSON.stringify({ name: file.name }),
        device: "Desktop",
        browser: "Agency OS",
      },
    });

    return file;
  });

  if (!deleted) return { ok: false as const, error: "File not found." };

  // Best-effort disk cleanup -- a failure here must never fail the request,
  // the DB row (the source of truth for what the tenant sees) is already gone.
  if (deleted.url.startsWith("/uploads/")) {
    unlink(path.join(process.cwd(), "public", deleted.url)).catch(() => {});
  }

  revalidatePath("/agency/files");
  return { ok: true as const };
}
