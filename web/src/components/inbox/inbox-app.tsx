"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { useDirectory } from "@/lib/directory";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ChatList, type InboxTab } from "./chat-list";
import { ConversationView } from "./conversation";

export function useIntegrationFlags(): Record<string, string> {
  const [flags, setFlags] = useState<Record<string, string>>({});
  useEffect(() => {
    supabaseBrowser().rpc("rpc_integration_flags").then(({ data }) => setFlags((data ?? {}) as Record<string, string>));
  }, []);
  return flags;
}

export function InboxApp() {
  const me = useMe();
  const dir = useDirectory();
  const flags = useIntegrationFlags();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selected = params.get("c");
  const [tab, setTab] = useState<InboxTab>((params.get("tab") as InboxTab) ?? (me.role === "owner" || me.role === "admin" ? "needs" : "mine"));

  function select(id: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("c", id); else sp.delete("c");
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  if (!dir) return <div className="p-8 text-sm text-muted">Loading inbox…</div>;
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 md:h-dvh">
      <div className={cn("w-full md:w-[340px] md:shrink-0", selected ? "hidden md:block" : "block")}>
        <ChatList dir={dir} selected={selected} onSelect={select} tab={tab} setTab={setTab} />
      </div>
      <div className={cn("min-w-0 flex-1", selected ? "flex" : "hidden md:flex")}>
        {selected ? <ConversationView key={selected} id={selected} dir={dir} flags={flags} onBack={() => select(null)} />
          : <div className="flex flex-1 items-center justify-center bg-canvas text-sm text-muted">Choose a chat on the left.</div>}
      </div>
    </div>
  );
}
