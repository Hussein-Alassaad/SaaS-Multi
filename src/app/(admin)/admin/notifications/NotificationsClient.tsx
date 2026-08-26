"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/utils";
import {
  createNotificationAction,
  cancelNotificationAction,
  getProductOptionsAction,
  getTenantOptionsAction,
} from "@/lib/actions/admin-notifications";
import { Plus, Send, Calendar, X, ImagePlus, Ban } from "lucide-react";

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  audience: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
}

const AUDIENCE_LABELS: Record<string, string> = {
  ALL_TENANTS: "All Tenants",
  PRODUCT_TENANTS: "Product Tenants",
  SPECIFIC_TENANT: "Specific Tenant",
  ALL_PLATFORM_USERS: "All Platform Users",
};

const STATUS_VARIANT: Record<string, "neutral" | "warm" | "success"> = {
  DRAFT: "neutral",
  SCHEDULED: "warm",
  SENT: "success",
  CANCELED: "neutral",
};

export function NotificationsClient({ notifications }: { notifications: NotificationRow[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("ALL_TENANTS");
  const [audienceRef, setAudienceRef] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [cancelPending, startCancelTransition] = useTransition();

  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [tenants, setTenants] = useState<{ id: string; companyName: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    // Lazy-loaded only when the composer actually opens -- these lists
    // aren't needed for the ALL_TENANTS default, and loading them upfront
    // on every page visit would be wasted work most of the time.
    getProductOptionsAction().then((r) => {
      if (r.ok) setProducts(r.products);
    });
    getTenantOptionsAction().then((r) => {
      if (r.ok) setTenants(r.tenants);
    });
  }, [open]);

  const resetForm = () => {
    setTitle("");
    setBody("");
    setAudience("ALL_TENANTS");
    setAudienceRef("");
    setImageFile(null);
    setImagePreview(null);
    setError(null);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImageFile(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  };

  const handleSubmit = () => {
    if (!title.trim() || !body.trim()) {
      setError("Title and message are required.");
      return;
    }
    if ((audience === "PRODUCT_TENANTS" || audience === "SPECIFIC_TENANT") && !audienceRef) {
      setError("Select a target for this audience.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createNotificationAction({
        title,
        body,
        audience: audience as "ALL_TENANTS" | "PRODUCT_TENANTS" | "SPECIFIC_TENANT" | "ALL_PLATFORM_USERS",
        audienceRef: audienceRef || null,
        image: imageFile,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to send announcement.");
        return;
      }
      showToast({ title: "Announcement sent", variant: "success" });
      resetForm();
      setOpen(false);
      router.refresh();
    });
  };

  const handleCancel = (id: string) => {
    startCancelTransition(async () => {
      const result = await cancelNotificationAction(id);
      if (!result.ok) {
        showToast({ title: "Failed to cancel", description: result.error, variant: "error" });
        return;
      }
      showToast({ title: "Canceled", variant: "success" });
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          New Broadcast
        </Button>
      </div>

      <div className="space-y-3">
        {notifications.length === 0 && (
          <p className="py-8 text-center text-sm text-[var(--text-4)]">No announcements sent yet.</p>
        )}
        {notifications.map((n) => (
          <Card key={n.id}>
            {n.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={n.imageUrl} alt="" className="mb-3 max-h-48 w-full rounded-lg object-cover" />
            )}
            <CardHeader>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>{n.title}</CardTitle>
                  <Badge variant={STATUS_VARIANT[n.status] ?? "neutral"}>{n.status}</Badge>
                </div>
                <CardDescription>{n.body}</CardDescription>
              </div>
              <Badge variant="outline">{AUDIENCE_LABELS[n.audience] ?? n.audience}</Badge>
            </CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-xs text-[var(--text-5)]">
                {n.sentAt && (
                  <span className="flex items-center gap-1">
                    <Send className="h-3 w-3" /> Sent {formatDateTime(n.sentAt)}
                  </span>
                )}
                {n.scheduledAt && !n.sentAt && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Scheduled {formatDateTime(n.scheduledAt)}
                  </span>
                )}
              </div>
              {n.status === "SCHEDULED" && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={cancelPending}
                  onClick={() => handleCancel(n.id)}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) resetForm();
        }}
        title="New Broadcast"
        description="Compose and send an announcement -- visible on the client dashboard immediately."
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
              placeholder="Write your announcement..."
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">Image (optional)</label>
            {imagePreview ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="" className="max-h-40 w-full rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                  }}
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-hairline-strong)] py-6 text-sm text-[var(--text-4)] hover:bg-[var(--surface-2)]">
                <ImagePlus className="h-4 w-4" />
                Attach an image
                <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              </label>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">Audience</label>
            <Select
              value={audience}
              onValueChange={(v) => {
                setAudience(v);
                setAudienceRef("");
              }}
              options={Object.entries(AUDIENCE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </div>
          {audience === "PRODUCT_TENANTS" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">Product</label>
              <Select
                value={audienceRef}
                onValueChange={setAudienceRef}
                options={products.map((p) => ({ value: p.id, label: p.name }))}
                placeholder="Select a product"
              />
            </div>
          )}
          {audience === "SPECIFIC_TENANT" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">Tenant</label>
              <Select
                value={audienceRef}
                onValueChange={setAudienceRef}
                options={tenants.map((t) => ({ value: t.id, label: t.companyName }))}
                placeholder="Select a tenant"
              />
            </div>
          )}
          {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={handleSubmit}>
              {pending ? "Sending..." : "Send Announcement"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
