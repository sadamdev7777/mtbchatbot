"use client";
import { SectionFrame } from "@/components/shell/section-tabs";
import { cn, initials } from "@/lib/utils";

export const AI_TABS = [
  { key: "agents", label: "Agents", href: "/ai" },
  { key: "knowledge", label: "Company knowledge", href: "/ai/knowledge" },
  { key: "test", label: "Test bot", href: "/ai/test" },
];

export function AiFrame({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <SectionFrame title={title} description={description} tabs={AI_TABS} actions={actions}>{children}</SectionFrame>;
}

export function AgentAvatar({ name, colour, size = 56 }: { name: string; colour: string; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      <span className="flex h-full w-full items-center justify-center rounded-full font-bold text-white" style={{ background: colour, fontSize: size * 0.36 }}>{initials(name)}</span>
      <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white bg-ai px-1 text-[9px] font-bold text-white">AI</span>
    </span>
  );
}

export const STATUS_TONE: Record<string, string> = { live: "bg-success-soft text-success", training: "bg-warn-soft text-warn-ink", resting: "bg-chip text-muted" };
export const MODE_LABEL: Record<string, string> = { follow_schedule: "Follow schedule", auto: "Auto", assist: "Assist", off: "Off" };

export function StatusPill({ status }: { status: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", STATUS_TONE[status] ?? "bg-chip")}>{status}</span>;
}
