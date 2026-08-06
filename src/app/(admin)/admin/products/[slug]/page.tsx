import { notFound } from "next/navigation";
import Link from "next/link";
import { getProductBySlug } from "@/lib/mock/products";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { ProductStatusBadge } from "@/components/ui/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProductControlsClient } from "./ProductControlsClient";
import { formatCents } from "@/lib/utils";
import { ArrowLeft, Building2, DollarSign, Sparkles } from "lucide-react";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getProductBySlug(slug);
  if (!result) notFound();

  const { product, revenue, aiLogs, flags, budget } = result;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/products">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-1)]">
              {product.name}
            </h1>
            <ProductStatusBadge status={product.status} />
            {product.maintenanceMode && <Badge variant="warm">Maintenance Mode</Badge>}
          </div>
          <p className="text-sm text-[var(--text-4)]">
            {product.slug} · v{product.version} · {product.description}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Tenants
            </CardTitle>
          </CardHeader>
          <div className="text-2xl font-semibold text-[var(--text-1)]">{product.tenants.length}</div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> Revenue
            </CardTitle>
          </CardHeader>
          <div className="text-2xl font-semibold text-gradient">{formatCents(revenue)}</div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> AI Requests
            </CardTitle>
          </CardHeader>
          <div className="text-2xl font-semibold text-[var(--text-1)]">{aiLogs.length}</div>
        </Card>
      </div>

      <ProductControlsClient
        productId={product.id}
        maintenanceMode={product.maintenanceMode}
        killSwitchEnabled={budget?.killSwitchEnabled ?? false}
        hasBudget={!!budget}
        defaultModel={budget?.defaultModel ?? null}
        dailyBudgetCents={budget?.dailyBudgetCents ?? null}
        flags={flags.map((f) => ({ id: f.id, key: f.key, name: f.name, enabled: f.enabled }))}
        tenants={product.tenants.map((t) => ({
          id: t.id,
          companyName: t.companyName,
          status: t.status,
          planName: t.subscriptions[0]?.plan.name ?? null,
          createdAt: t.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
