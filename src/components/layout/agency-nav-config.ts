import {
  LayoutDashboard,
  Inbox,
  Sparkles,
  KanbanSquare,
  CheckCircle2,
  Users,
  CalendarClock,
  BookOpen,
  Plug,
  BarChart3,
  MessageSquarePlus,
  Settings,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "./nav-config";

export type { NavItem };

// Nexaris tenant platform -- 12 confirmed sections (AI Sales & Support).
// Every AI capability (qualification, drafting, meeting offers) routes
// through Live Inbox + AI Control Center + Approval Queue; nothing here is
// a placeholder for an unbuilt feature.
export const AGENCY_NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/agency", icon: LayoutDashboard },
  { label: "Live Inbox", href: "/agency/inbox", icon: Inbox },
  { label: "AI Control Center", href: "/agency/ai-control", icon: Sparkles },
  { label: "Pipeline", href: "/agency/pipeline", icon: KanbanSquare },
  { label: "Approval Queue", href: "/agency/approvals", icon: CheckCircle2 },
  { label: "Clients", href: "/agency/clients", icon: Users },
  { label: "Calendar & Meetings", href: "/agency/meetings", icon: CalendarClock },
  { label: "Knowledge Base", href: "/agency/knowledge-base", icon: BookOpen },
  { label: "Integrations", href: "/agency/integrations", icon: Plug },
  { label: "Analytics", href: "/agency/analytics", icon: BarChart3 },
  { label: "Feature Requests", href: "/agency/feature-requests", icon: MessageSquarePlus },
  { label: "Team", href: "/agency/team", icon: UserCog },
  { label: "Settings", href: "/agency/settings", icon: Settings },
];

export type { LucideIcon };
