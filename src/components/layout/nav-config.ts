import {
  LayoutDashboard,
  Building2,
  CreditCard,
  Receipt,
  Sparkles,
  Bell,
  MessageSquarePlus,
  ScrollText,
  Activity,
  ShieldCheck,
  Lock,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

// Nexaris admin (platform) nav -- 11 confirmed sections. Products merged
// into Tenants (one product line), Users merged into Roles (staff RBAC),
// Support/Analytics/Feature Flags/Integrations/Settings removed as
// redundant or not needed at this stage -- see agency_os memory for the
// per-section rationale.
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Tenants", href: "/admin/tenants", icon: Building2 },
  { label: "Subscriptions", href: "/admin/subscriptions", icon: CreditCard },
  { label: "Billing", href: "/admin/billing", icon: Receipt },
  { label: "AI Control", href: "/admin/ai", icon: Sparkles },
  { label: "Notifications", href: "/admin/notifications", icon: Bell },
  { label: "Feature Requests", href: "/admin/feature-requests", icon: MessageSquarePlus },
  { label: "Audit Logs", href: "/admin/audit-logs", icon: ScrollText },
  { label: "Error Logs", href: "/admin/error-logs", icon: AlertTriangle },
  { label: "Monitoring", href: "/admin/monitoring", icon: Activity },
  { label: "Roles", href: "/admin/roles", icon: ShieldCheck },
  { label: "Security", href: "/admin/security", icon: Lock },
];
