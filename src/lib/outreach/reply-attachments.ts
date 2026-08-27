import { put } from "@vercel/blob";

/**
 * Media attachments (voice notes, photos, videos) on a "Reply Here" reply
 * (src/lib/actions/outreach-replies.ts). Uses Vercel Blob, NOT
 * src/lib/storage.ts's local-disk saveUploadedFile() -- that one writes to
 * public/uploads/ which does not persist on Vercel's serverless filesystem
 * (ephemeral, ok for a request's lifetime, gone by the next one on a
 * different instance) -- a file saved there would silently vanish before
 * the Python agent ever got a chance to read it. Requires
 * BLOB_READ_WRITE_TOKEN (Vercel dashboard -> Storage -> Blob -> Connect to
 * project, auto-injected into env once connected).
 *
 * 25MB cap -- generous for a voice note or a few photos, well under
 * Instagram/LinkedIn's own attachment size limits, and small enough that a
 * client's mobile upload doesn't stall on a slow connection.
 */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type AttachmentKind = "image" | "video" | "audio" | "file";

export function guessAttachmentKind(mimeType: string): AttachmentKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

export class AttachmentTooLarge extends Error {
  constructor() {
    super(`Attachment must be under ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB.`);
  }
}

export async function saveReplyAttachment(
  tenantId: string,
  leadId: string,
  file: File
): Promise<{ url: string; kind: AttachmentKind; name: string }> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLarge();

  const blob = await put(`outreach-replies/${tenantId}/${leadId}/${Date.now()}-${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
  });

  return {
    url: blob.url,
    kind: guessAttachmentKind(file.type || "application/octet-stream"),
    name: file.name,
  };
}
