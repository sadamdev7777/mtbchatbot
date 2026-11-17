"use client";
import { usePathname } from "next/navigation";
import { SubTabs } from "@/components/ui/misc";

export function SectionTabs({ tabs }: { tabs: { key: string; label: string; href: string }[] }) {
  const pathname = usePathname();
  const active = [...tabs].sort((a, b) => b.href.length - a.href.length).find((t) => pathname === t.href || pathname.startsWith(t.href + "/"))?.key ?? tabs[0].key;
  return <SubTabs tabs={tabs} active={active} />;
}

export function SectionFrame({ title, description, tabs, actions, children }: {
  title: string; description?: string; tabs?: { key: string; label: string; href: string }[]; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {tabs ? <SectionTabs tabs={tabs} /> : null}
      {children}
    </div>
  );
}
