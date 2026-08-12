import { db } from "@/lib/db";

export async function getFeatureRequests() {
  return db.tenantFeatureRequest.findMany({
    include: { tenant: true, filedBy: true },
    orderBy: { createdAt: "desc" },
  });
}

export const FEATURE_REQUEST_STATUSES = [
  "NEW",
  "UNDER_REVIEW",
  "PLANNED",
  "COMPLETED",
  "REJECTED",
] as const;
