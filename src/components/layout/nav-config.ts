import {
  LayoutDashboard,
  Building2,
  Boxes,
  CreditCard,
  Receipt,
  Sparkles,
  Users,
  LifeBuoy,
  Bell,
  BarChart3,
  Flag,
  Plug,
  ScrollText,
  Activity,
  ShieldCheck,
  Lock,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Tenants", href: "/admin/tenants", icon: Building2 },
  { label: "Products", href: "/admin/products", icon: Boxes },
  { label: "Subscriptions", href: "/admin/subscriptions", icon: CreditCard },
  { label: "Billing", href: "/admin/billing", icon: Receipt },
  { label: "AI Control", href: "/admin/ai", icon: Sparkles },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Support", href: "/admin/support", icon: LifeBuoy },
  { label: "Notifications", href: "/admin/notifications", icon: Bell },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  { label: "Feature Flags", href: "/admin/feature-flags", icon: Flag },
  { label: "Integrations", href: "/admin/integrations", icon: Plug },
  { label: "Audit Logs", href: "/admin/audit-logs", icon: ScrollText },
  { label: "Monitoring", href: "/admin/monitoring", icon: Activity },
  { label: "Roles", href: "/admin/roles", icon: ShieldCheck },
  { label: "Security", href: "/admin/security", icon: Lock },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];
