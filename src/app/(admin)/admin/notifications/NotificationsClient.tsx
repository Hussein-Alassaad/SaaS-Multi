"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatDateTime } from "@/lib/utils";
import { Plus, Send, Calendar } from "lucide-react";

interface NotificationRow {
  id: string;
  title: string;
  body: string;
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
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("ALL_TENANTS");

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          New Broadcast
        </Button>
      </div>

      <div className="space-y-3">
        {notifications.map((n) => (
          <Card key={n.id}>
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
          </Card>
        ))}
      </div>

      <Modal open={open} onOpenChange={setOpen} title="New Broadcast" description="Compose and schedule an announcement">
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
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">Audience</label>
            <Select
              value={audience}
              onValueChange={setAudience}
              options={Object.entries(AUDIENCE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Save as Draft</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
