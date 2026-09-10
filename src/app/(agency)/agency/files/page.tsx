import { getTenantSession } from "@/lib/auth";
import { listFilesAction } from "@/lib/actions/marketing-files";
import { FilesClient } from "./FilesClient";

export default async function FilesPage() {
  await getTenantSession();
  const result = await listFilesAction();

  return (
    <FilesClient
      initialFiles={
        result.ok
          ? result.files.map((f) => ({
              id: f.id,
              name: f.name,
              url: f.url,
              type: f.type as "image" | "pdf" | "document" | "other",
              size: f.size,
              mimeType: f.mimeType,
              createdAt: f.createdAt.toISOString(),
            }))
          : []
      }
    />
  );
}
