import { db } from "@/lib/db";

export async function getNotifications() {
  return db.notification.findMany({ orderBy: { createdAt: "desc" } });
}
