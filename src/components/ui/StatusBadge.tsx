import { Badge } from "./Badge";

const TENANT_STATUS_MAP: Record<string, { variant: "cold" | "warm" | "hot"; label: string }> = {
  ACTIVE: { variant: "cold", label: "Active" },
  TRIAL: { variant: "warm", label: "Trial" },
  PAST_DUE: { variant: "hot", label: "Past Due" },
  SUSPENDED: { variant: "hot", label: "Suspended" },
  CHURNED: { variant: "hot", label: "Churned" },
};

const TICKET_STATUS_MAP: Record<string, { variant: "cold" | "warm" | "hot" | "success" | "neutral"; label: string }> = {
  OPEN: { variant: "hot", label: "Open" },
  IN_PROGRESS: { variant: "warm", label: "In Progress" },
  WAITING_ON_CUSTOMER: { variant: "neutral", label: "Waiting on Customer" },
  RESOLVED: { variant: "success", label: "Resolved" },
  CLOSED: { variant: "neutral", label: "Closed" },
};

const INVOICE_STATUS_MAP: Record<string, { variant: "cold" | "warm" | "hot" | "success" | "neutral"; label: string }> = {
  DRAFT: { variant: "neutral", label: "Draft" },
  OPEN: { variant: "warm", label: "Open" },
  PAID: { variant: "success", label: "Paid" },
  VOID: { variant: "neutral", label: "Void" },
  UNCOLLECTIBLE: { variant: "hot", label: "Uncollectible" },
};

export function TenantStatusBadge({ status }: { status: string }) {
  const cfg = TENANT_STATUS_MAP[status] ?? { variant: "neutral" as const, label: status };
  return (
    <Badge variant={cfg.variant} dot>
      {cfg.label}
    </Badge>
  );
}

export function TicketStatusBadge({ status }: { status: string }) {
  const cfg = TICKET_STATUS_MAP[status] ?? { variant: "neutral" as const, label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export function InvoiceStatusBadge({ status }: { status: string }) {
  const cfg = INVOICE_STATUS_MAP[status] ?? { variant: "neutral" as const, label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, "cold" | "warm" | "hot"> = {
    LOW: "cold",
    MEDIUM: "warm",
    HIGH: "hot",
    URGENT: "hot",
  };
  return (
    <Badge variant={map[priority] ?? "neutral"} dot>
      {priority.charAt(0) + priority.slice(1).toLowerCase()}
    </Badge>
  );
}

export function ClientStatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "cold" | "warm" | "hot" | "success" | "neutral"; label: string }> = {
    ACTIVE: { variant: "success", label: "Active" },
    PAUSED: { variant: "warm", label: "Paused" },
    ARCHIVED: { variant: "neutral", label: "Archived" },
  };
  const cfg = map[status] ?? { variant: "neutral" as const, label: status };
  return (
    <Badge variant={cfg.variant} dot>
      {cfg.label}
    </Badge>
  );
}

export function ProductStatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "cold" | "warm" | "hot" | "success" | "neutral"; label: string }> = {
    ACTIVE: { variant: "success", label: "Active" },
    INACTIVE: { variant: "neutral", label: "Inactive" },
    MAINTENANCE: { variant: "warm", label: "Maintenance" },
    FUTURE: { variant: "cold", label: "Future" },
  };
  const cfg = map[status] ?? { variant: "neutral" as const, label: status };
  return (
    <Badge variant={cfg.variant} dot>
      {cfg.label}
    </Badge>
  );
}
