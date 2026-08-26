import {
  Radar,
  CheckCircle2,
  Send,
  Briefcase,
  Mail,
  KanbanSquare,
  Users,
  History,
  BarChart3,
  ShieldCheck,
  Activity,
  AlertTriangle,
  MessageSquarePlus,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "./nav-config";

export type { NavItem };

// Outreach tenant platform -- 14 confirmed sections (AI lead discovery &
// outreach agent). Lead Detail (/outreach/leads/[id]) has no nav entry --
// reached only by clicking a lead card, matching the original. Email
// Outreach was added for the first paying client (SES-based, not part of
// the original single-tenant app) -- toggled off per-tenant via the
// sections system for clients that don't need it (see src/lib/sections.ts).
export const OUTREACH_NAV_ITEMS: NavItem[] = [
  { label: "Live Feed", href: "/outreach", icon: Radar },
  { label: "Approval Queue", href: "/outreach/approvals", icon: CheckCircle2 },
  { label: "Instagram Manual Send", href: "/outreach/instagram-manual", icon: Send },
  { label: "LinkedIn Activity", href: "/outreach/linkedin", icon: Briefcase },
  { label: "Email Outreach", href: "/outreach/email", icon: Mail },
  { label: "Pipeline", href: "/outreach/pipeline", icon: KanbanSquare },
  { label: "Clients", href: "/outreach/clients", icon: Users },
  { label: "Client History", href: "/outreach/client-history", icon: History },
  { label: "Analytics", href: "/outreach/analytics", icon: BarChart3 },
  { label: "Account Health", href: "/outreach/accounts", icon: ShieldCheck },
  { label: "Run Status", href: "/outreach/run-status", icon: Activity },
  { label: "Errors", href: "/outreach/errors", icon: AlertTriangle },
  { label: "Feature Requests", href: "/outreach/feature-requests", icon: MessageSquarePlus },
  { label: "Settings", href: "/outreach/settings", icon: Settings },
];

export type { LucideIcon };
