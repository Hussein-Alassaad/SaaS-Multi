"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileImage, FileText, File as FileIcon, Trash2, Upload } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils";
import { uploadFileAction, deleteFileAction, type MarketingFileType } from "@/lib/actions/marketing-files";

interface MarketingFileView {
  id: string;
  name: string;
  url: string;
  type: MarketingFileType;
  size: number;
  mimeType: string;
  createdAt: string;
}

const FILTERS: { value: MarketingFileType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "pdf", label: "PDFs" },
  { value: "document", label: "Documents" },
  { value: "other", label: "Other" },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(type: MarketingFileType) {
  if (type === "image") return FileImage;
  if (type === "pdf" || type === "document") return FileText;
  return FileIcon;
}

export function FilesClient({ initialFiles }: { initialFiles: MarketingFileView[] }) {
  const router = useRouter();
  const [files, setFiles] = useState(initialFiles);
  const [filter, setFilter] = useState<MarketingFileType | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = filter === "all" ? files : files.filter((f) => f.type === filter);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    startUpload(async () => {
      const result = await uploadFileAction({ file });
      if (result.ok) {
        setFiles((prev) => [
          {
            id: result.file.id,
            name: result.file.name,
            url: result.file.url,
            type: result.file.type as MarketingFileType,
            size: result.file.size,
            mimeType: result.file.mimeType,
            createdAt: result.file.createdAt.toISOString(),
          },
          ...prev,
        ]);
        router.refresh();
      } else {
        setError(result.error);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  const handleDelete = (fileId: string) => {
    setDeletingId(fileId);
    startUpload(async () => {
      const result = await deleteFileAction(fileId);
      if (result.ok) {
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
        router.refresh();
      } else {
        setError(result.error);
      }
      setDeletingId(null);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Files</h1>
          <p className="text-sm text-[var(--text-4)] mt-1">Upload and manage marketing assets — logos, PDFs, and images.</p>
        </div>
        <div>
          <input ref={inputRef} type="file" className="hidden" onChange={handleFileChange} disabled={uploading} />
          <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading..." : "Upload file"}
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className="focus-visible:outline-none"
          >
            <Badge variant={filter === f.value ? "accent" : "outline"} className="cursor-pointer">
              {f.label}
            </Badge>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card padding="lg">
          <p className="py-6 text-center text-sm text-[var(--text-4)]">
            {files.length === 0 ? "No files yet. Upload your first marketing asset." : "No files match this filter."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((file) => {
            const Icon = iconFor(file.type);
            return (
              <Card key={file.id} padding="md" className="flex items-start gap-3">
                {file.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.url} alt={file.name} className="h-12 w-12 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[var(--surface-2)]">
                    <Icon className="h-5 w-5 text-[var(--text-4)]" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-medium text-[var(--text-1)] hover:underline"
                  >
                    {file.name}
                  </a>
                  <p className="mt-0.5 text-xs text-[var(--text-4)]">
                    {formatSize(file.size)} · {formatDateTime(file.createdAt)}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(file.id)}
                  disabled={deletingId === file.id}
                  className="shrink-0 rounded-md p-1.5 text-[var(--text-4)] hover:bg-[var(--surface-2)] hover:text-[var(--status-hot)]"
                  aria-label="Delete file"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
