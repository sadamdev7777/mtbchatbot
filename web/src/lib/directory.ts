"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Agent, Label, Member, QuickReply, Team } from "@/lib/types";

export interface Directory {
  members: Member[]; teams: Team[]; teamMembers: { team_id: string; member_id: string }[]; agents: Agent[]; labels: Label[];
  channels: { id: string; display_name: string; phone_display: string | null }[]; quickReplies: QuickReply[];
  member: (id: string | null | undefined) => Member | undefined;
  team: (id: string | null | undefined) => Team | undefined;
  agent: (id: string | null | undefined) => Agent | undefined;
  label: (id: string | null | undefined) => Label | undefined;
}

let cached: Promise<Directory> | null = null;

async function load(): Promise<Directory> {
  const sb = supabaseBrowser();
  const [m, t, tm, a, l, c, q] = await Promise.all([
    sb.from("members").select("id, display_name, role, status, avatar_color, last_seen_at, on_leave_until, email").order("display_name"),
    sb.from("teams").select("*").order("name"),
    sb.from("team_members").select("team_id, member_id"),
    sb.from("agents").select("id, name, avatar_color, description, team_id, mode, status, default_staff_member_id").order("name"),
    sb.from("labels").select("*").order("name"),
    sb.from("channels").select("id, display_name, phone_display"),
    sb.from("quick_replies").select("*").order("shortcut"),
  ]);
  const d = {
    members: (m.data ?? []) as Member[], teams: (t.data ?? []) as Team[], teamMembers: tm.data ?? [], agents: (a.data ?? []) as Agent[],
    labels: (l.data ?? []) as Label[], channels: c.data ?? [], quickReplies: (q.data ?? []) as QuickReply[],
  };
  return {
    ...d,
    member: (id) => d.members.find((x) => x.id === id),
    team: (id) => d.teams.find((x) => x.id === id),
    agent: (id) => d.agents.find((x) => x.id === id),
    label: (id) => d.labels.find((x) => x.id === id),
  };
}

export function invalidateDirectory() {
  cached = null;
}

export function useDirectory(): Directory | null {
  const [d, setD] = useState<Directory | null>(null);
  useEffect(() => {
    if (!cached) cached = load();
    let alive = true;
    cached.then((x) => alive && setD(x));
    return () => { alive = false; };
  }, []);
  return d;
}
