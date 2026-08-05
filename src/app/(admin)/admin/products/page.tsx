import Link from "next/link";
import { getProductsList } from "@/lib/mock/products";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { ProductStatusBadge } from "@/components/ui/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { formatCents } from "@/lib/utils";
import { Building2, DollarSign, Sparkles, ArrowRight } from "lucide-react";

export default async function ProductsPage() {
  const products = await getProductsList();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Products</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Every product in the ecosystem is a registry entry — add new ones without touching core
          admin code.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => (
          <Link key={p.id} href={`/admin/products/${p.slug}`}>
            <Card className="h-full">
              <CardHeader>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    {p.maintenanceMode && <Badge variant="warm">Maintenance</Badge>}
                  </div>
                  <CardDescription>{p.description}</CardDescription>
                </div>
                <ProductStatusBadge status={p.status} />
              </CardHeader>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="flex items-center gap-1 text-[var(--text-4)] text-xs">
                    <Building2 className="h-3 w-3" /> Tenants
                  </div>
                  <div className="font-semibold text-[var(--text-1)]">{p.tenantCount}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-[var(--text-4)] text-xs">
                    <DollarSign className="h-3 w-3" /> Revenue
                  </div>
                  <div className="font-semibold text-[var(--text-1)]">{formatCents(p.revenue)}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-[var(--text-4)] text-xs">
                    <Sparkles className="h-3 w-3" /> AI Reqs
                  </div>
                  <div className="font-semibold text-[var(--text-1)]">{p.aiRequestCount}</div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-[var(--border-hairline)] pt-3">
                <span className="text-xs text-[var(--text-5)]">v{p.version}</span>
                <span className="flex items-center gap-1 text-xs font-medium text-[var(--accent-from)]">
                  View details <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
