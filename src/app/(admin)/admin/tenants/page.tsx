import { getTenantsList } from "@/lib/mock/tenants";
import { TenantsTableClient } from "./TenantsTableClient";
import { Button } from "@/components/ui/Button";
import { Plus } from "lucide-react";

export default async function TenantsPage() {
  const tenants = await getTenantsList();

  const rows = tenants.map((t) => ({
    id: t.id,
    companyName: t.companyName,
    subdomain: t.subdomain,
    status: t.status,
    storageUsedMb: t.storageUsedMb,
    aiCreditsUsed: t.aiCreditsUsed,
    createdAt: t.createdAt.toISOString(),
    productName: t.product.name,
    ownerName: t.owner?.name ?? null,
    planName: t.subscriptions[0]?.plan.name ?? null,
    planPrice: t.subscriptions[0]?.plan.monthlyPrice ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Tenants</h1>
          <p className="text-sm text-[var(--text-4)] mt-1">
            Manage every tenant across all products from one CRM view.
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4" />
          New Tenant
        </Button>
      </div>

      <TenantsTableClient tenants={rows} />
    </div>
  );
}
