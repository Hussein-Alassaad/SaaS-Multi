import { getNotifications } from "@/lib/mock/notifications";
import { NotificationsClient } from "./NotificationsClient";

export default async function NotificationsPage() {
  const notifications = await getNotifications();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Notifications</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Broadcast announcements to tenants, products, or platform staff.
        </p>
      </div>

      <NotificationsClient
        notifications={notifications.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          imageUrl: n.imageUrl,
          audience: n.audience,
          status: n.status,
          scheduledAt: n.scheduledAt?.toISOString() ?? null,
          sentAt: n.sentAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
