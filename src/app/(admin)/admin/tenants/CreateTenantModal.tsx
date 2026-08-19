"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { createTenantAction } from "@/lib/actions/admin-tenants";

const PRODUCT_OPTIONS = [
  { value: "marketing", label: "Marketing" },
  { value: "outreach", label: "Outreach" },
];

function slugify(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

const emptyForm = {
  productSlug: "marketing" as "marketing" | "outreach",
  companyName: "",
  subdomain: "",
  ownerName: "",
  email: "",
  password: "",
};

export function CreateTenantModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [subdomainTouched, setSubdomainTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setCompanyName(value: string) {
    setForm((f) => ({ ...f, companyName: value, subdomain: subdomainTouched ? f.subdomain : slugify(value) }));
  }

  function handleSubmit() {
    if (!form.companyName.trim() || !form.subdomain.trim() || !form.ownerName.trim() || !form.email.trim() || !form.password) {
      setError("All fields are required.");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createTenantAction(form);
      if (!result.ok) {
        setError(result.error ?? "Failed to create tenant.");
        return;
      }
      setForm(emptyForm);
      setSubdomainTouched(false);
      onOpenChange(false);
      router.push(`/admin/tenants/${result.tenantId}`);
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New Tenant"
      description="Creates an active tenant immediately -- no plan or payment step."
    >
      <div className="space-y-3">
        <Select
          value={form.productSlug}
          onValueChange={(v) => setForm((f) => ({ ...f, productSlug: v as "marketing" | "outreach" }))}
          options={PRODUCT_OPTIONS}
        />
        <Input placeholder="Company name" value={form.companyName} onChange={(e) => setCompanyName(e.target.value)} />
        <Input
          placeholder="Workspace URL (subdomain)"
          value={form.subdomain}
          onChange={(e) => {
            setSubdomainTouched(true);
            setForm((f) => ({ ...f, subdomain: e.target.value.toLowerCase() }));
          }}
        />
        <Input placeholder="Owner name" value={form.ownerName} onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))} />
        <Input
          type="email"
          placeholder="Owner email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        <Input
          type="password"
          placeholder="Owner password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        />
        {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
        <Button className="w-full" disabled={pending} onClick={handleSubmit}>
          {pending ? "Creating..." : "Create tenant"}
        </Button>
      </div>
    </Modal>
  );
}
