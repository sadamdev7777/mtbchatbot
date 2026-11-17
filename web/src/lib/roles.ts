export type Role = "owner" | "admin" | "team_lead" | "staff" | "accounts";

export interface Me {
  member_id: string;
  company_id: string;
  role: Role;
  display_name: string;
  email: string;
  company_name: string;
  team_ids: string[];
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  team_lead: "Team lead",
  staff: "Staff",
  accounts: "Accounts",
};

export type Section = "dashboard" | "inbox" | "contacts" | "broadcast" | "ai" | "morning" | "payments" | "settings" | "notifications" | "dev";

/** Which roles may open each section (UI gate; RLS is the real enforcement). */
export const SECTION_ROLES: Record<Section, Role[]> = {
  dashboard: ["owner", "admin", "team_lead", "staff"],
  inbox: ["owner", "admin", "team_lead", "staff"],
  contacts: ["owner", "admin", "team_lead", "staff"],
  broadcast: ["owner", "admin", "team_lead"],
  ai: ["owner", "admin", "team_lead"],
  morning: ["owner", "admin", "team_lead"],
  payments: ["owner", "admin", "accounts"],
  settings: ["owner", "admin", "team_lead", "staff", "accounts"],
  notifications: ["owner", "admin", "team_lead", "staff", "accounts"],
  dev: ["owner", "admin"],
};

export function canOpen(role: Role, section: Section): boolean {
  return SECTION_ROLES[section].includes(role);
}

export function homeFor(role: Role): string {
  if (role === "owner" || role === "admin") return "/dashboard";
  if (role === "accounts") return "/payments";
  return "/inbox";
}

export const isAdmin = (r: Role) => r === "owner" || r === "admin";

export interface NavItem { key: Section; label: string; href: string; header?: string }

export function navFor(role: Role): NavItem[] {
  const items: NavItem[] = [
    { key: "dashboard", label: "Dashboard", href: "/dashboard" },
    { key: "inbox", label: "Inbox", href: "/inbox" },
    { key: "contacts", label: "Contacts", href: "/contacts" },
    { key: "broadcast", label: "Broadcast", href: "/broadcast" },
    { key: "ai", label: "AI Team", href: "/ai", header: "AI" },
    { key: "morning", label: "Morning report", href: "/morning-report" },
    { key: "payments", label: "Payment verification", href: "/payments", header: "Admin" },
    { key: "settings", label: "Settings", href: "/settings" },
  ];
  // Payment verification shows in the sidebar for owner and accounts (admin can still open it read-only).
  return items.filter((i) => canOpen(role, i.key) && (i.key !== "payments" || role === "owner" || role === "accounts"));
}

export const SETTINGS_TABS = [
  { key: "staff", label: "Staff & teams", href: "/settings/staff", roles: ["owner", "admin"] as Role[] },
  { key: "labels", label: "Labels", href: "/settings/labels", roles: ["owner", "admin"] as Role[] },
  { key: "channel", label: "WhatsApp channel", href: "/settings/channel", roles: ["owner", "admin"] as Role[] },
  { key: "integrations", label: "Integrations", href: "/settings/integrations", roles: ["owner", "admin"] as Role[] },
  { key: "automation", label: "Automation", href: "/settings/automation", roles: ["owner", "admin"] as Role[] },
  { key: "notifications", label: "My notifications", href: "/settings/notifications", roles: ["owner", "admin", "team_lead", "staff", "accounts"] as Role[] },
];
