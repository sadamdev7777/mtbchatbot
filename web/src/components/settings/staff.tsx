"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar, Badge, Card, CardHeader } from "@/components/ui/misc";
import { invalidateDirectory } from "@/lib/directory";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Member, Team } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

const MATRIX: [string, string, string, string, string, string][] = [
  ["Inbox", "All", "All", "Own team", "Own chats + own team", "–"],
  ["Contacts", "Yes", "Yes", "Own team", "View only", "–"],
  ["Dashboard / Reports", "All", "All", "Own team", "Self", "–"],
  ["Broadcast & templates", "Yes", "Yes", "Suggest", "–", "–"],
  ["AI Team & knowledge", "Yes, approves go-live", "Yes", "View", "–", "–"],
  ["Morning report", "Yes", "Yes", "Own team", "–", "–"],
  ["Payment verification", "Yes", "View", "–", "–", "Yes"],
  ["Settings", "All", "All except billing", "My notifications", "My notifications", "My notifications"],
];

export function StaffSettings() {
  const me = useMe();
  const sb = supabaseBrowser();
  const [members, setMembers] = useState<(Member & { phone: string | null; leave_source: string | null })[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tm, setTm] = useState<{ team_id: string; member_id: string }[]>([]);
  const [invite, setInvite] = useState(false);
  const [teamEdit, setTeamEdit] = useState<Team | "new" | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [m, t, x] = await Promise.all([
      sb.from("members").select("*").order("display_name"), sb.from("teams").select("*").order("name"), sb.from("team_members").select("team_id, member_id"),
    ]);
    setMembers((m.data ?? []) as never);
    setTeams((t.data ?? []) as Team[]);
    setTm(x.data ?? []);
    invalidateDirectory();
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  async function update(id: string, patch: Record<string, unknown>) {
    const { error } = await sb.from("members").update(patch).eq("id", id);
    setMsg(error ? error.message : "Saved");
    load();
  }

  const canChangeRole = (target: Role, to?: Role) => me.role === "owner" || (!["owner", "admin"].includes(target) && !["owner", "admin"].includes(to ?? "staff"));

  return (
    <div className="flex flex-col gap-5">
      {msg ? <p role="status" className="rounded-lg bg-panel px-3 py-2 text-sm">{msg}</p> : null}
      <Card className="overflow-x-auto">
        <CardHeader title={`Staff (${members.length})`} action={<Button onClick={() => setInvite(true)}>Invite staff</Button>} />
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-line bg-panel text-xs font-semibold text-muted">
            <tr><th className="px-4 py-3">Name</th><th className="px-3 py-3">Role</th><th className="px-3 py-3">Teams</th><th className="px-3 py-3">WhatsApp (for tests)</th><th className="px-3 py-3">On leave until</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Last seen</th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><div className="flex items-center gap-2"><Avatar name={m.display_name} colour={m.avatar_color} size={30} /><div><p className="font-semibold">{m.display_name}</p><p className="text-xs text-muted">{m.email}</p></div></div></td>
                <td className="px-3 py-3">
                  <Select aria-label={`Role of ${m.display_name}`} className="h-9" value={m.role} disabled={!canChangeRole(m.role as Role) || m.id === me.member_id}
                    onChange={(e) => update(m.id, { role: e.target.value })}>
                    {(Object.keys(ROLE_LABEL) as Role[]).filter((r) => canChangeRole(m.role as Role, r) || r === m.role).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </Select>
                </td>
                <td className="px-3 py-3 text-muted">{tm.filter((x) => x.member_id === m.id).map((x) => teams.find((t) => t.id === x.team_id)?.name).join(", ") || "–"}</td>
                <td className="px-3 py-3"><Input aria-label={`WhatsApp number of ${m.display_name}`} className="h-9" defaultValue={m.phone ?? ""} placeholder="60123456789"
                  disabled={m.id !== me.member_id && !["owner", "admin"].includes(me.role)} onBlur={(e) => e.target.value !== (m.phone ?? "") && update(m.id, { phone: e.target.value || null })} /></td>
                <td className="px-3 py-3"><Input aria-label={`Leave for ${m.display_name}`} type="date" className="h-9" defaultValue={m.on_leave_until ?? ""}
                  onChange={(e) => update(m.id, { on_leave_until: e.target.value || null, leave_source: e.target.value ? "manual" : null })} />
                  {m.leave_source === "hrboost" ? <span className="text-xs text-muted">from HRBoost</span> : null}</td>
                <td className="px-3 py-3">
                  {m.status === "invited" ? <Badge tone="warn">Invited</Badge> : (
                    <Select aria-label={`Status of ${m.display_name}`} className="h-9" value={m.status} disabled={m.id === me.member_id || !canChangeRole(m.role as Role)}
                      onChange={(e) => update(m.id, { status: e.target.value })}>
                      <option value="active">Active</option><option value="disabled">Deactivated</option>
                    </Select>
                  )}
                </td>
                <td className="px-3 py-3 text-muted">{m.last_seen_at ? `${timeAgo(m.last_seen_at)} ago` : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader title="Teams" action={<Button variant="secondary" onClick={() => setTeamEdit("new")}>New team</Button>} />
        <ul className="divide-y divide-line">
          {teams.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div><p className="font-semibold">{t.name}{t.is_general ? <span className="ml-2 text-xs font-normal text-muted">fallback team</span> : null}</p>
                <p className="text-muted">{tm.filter((x) => x.team_id === t.id).map((x) => members.find((m) => m.id === x.member_id)?.display_name).join(", ") || "No members"}
                  {t.lead_member_id ? ` · lead: ${members.find((m) => m.id === t.lead_member_id)?.display_name}` : ""}</p></div>
              <Button size="sm" variant="secondary" onClick={() => setTeamEdit(t)}>Manage</Button>
            </li>
          ))}
        </ul>
        <p className="px-5 pb-4 text-xs text-muted">Every member added or removed is recorded in the <Link href="/settings/activity">activity log</Link>.</p>
      </Card>
      <Card className="overflow-x-auto">
        <CardHeader title="Roles: who sees what" />
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line bg-panel text-xs font-semibold text-muted"><tr><th className="px-4 py-3">Menu</th>{(["owner", "admin", "team_lead", "staff", "accounts"] as Role[]).map((r) => <th key={r} className="px-3 py-3">{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>{MATRIX.map((row) => <tr key={row[0]} className="border-b border-line last:border-0">{row.map((c, i) => <td key={i} className={i ? "px-3 py-2.5" : "px-4 py-2.5 font-semibold"}>{c}</td>)}</tr>)}</tbody>
        </table>
        <p className="px-5 py-4 text-xs text-muted">Owner and Admin must use 2-step verification. Deactivated staff: their chats stay and can be reassigned.</p>
      </Card>
      <InviteDialog open={invite} teams={teams} onClose={() => { setInvite(false); load(); }} />
      {teamEdit ? <TeamDialog team={teamEdit === "new" ? null : teamEdit} members={members} tm={tm} onClose={() => { setTeamEdit(null); load(); }} /> : null}
    </div>
  );
}

function InviteDialog({ open, teams, onClose }: { open: boolean; teams: Team[]; onClose: () => void }) {
  const me = useMe();
  const [v, setV] = useState({ email: "", display_name: "", role: "staff", team_ids: [] as string[] });
  const [msg, setMsg] = useState("");
  async function send() {
    const r = await fetch("/api/staff/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    const j = await r.json();
    if (!r.ok) return setMsg(j.error);
    setMsg(`Invite emailed to ${v.email}.`);
    setV({ email: "", display_name: "", role: "staff", team_ids: [] });
  }
  return (
    <Dialog open={open} onClose={() => { setMsg(""); onClose(); }} title="Invite staff" footer={<Button onClick={send} disabled={!v.email}>Send invite</Button>}>
      <div className="flex flex-col gap-3">
        <Field label="Email" htmlFor="inv-email"><Input id="inv-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Name" htmlFor="inv-name"><Input id="inv-name" value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} /></Field>
        <Field label="Role" htmlFor="inv-role">
          <Select id="inv-role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
            {(Object.keys(ROLE_LABEL) as Role[]).filter((r) => me.role === "owner" || !["owner", "admin"].includes(r)).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        <fieldset><legend className="mb-1 text-[13px] font-semibold text-body">Teams</legend>
          {teams.map((t) => <label key={t.id} className="mr-3 inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={v.team_ids.includes(t.id)}
            onChange={() => setV({ ...v, team_ids: v.team_ids.includes(t.id) ? v.team_ids.filter((x) => x !== t.id) : [...v.team_ids, t.id] })} />{t.name}</label>)}
        </fieldset>
        {msg ? <p role="status" className="text-sm">{msg}</p> : null}
      </div>
    </Dialog>
  );
}

function TeamDialog({ team, members, tm, onClose }: { team: Team | null; members: Member[]; tm: { team_id: string; member_id: string }[]; onClose: () => void }) {
  const me = useMe();
  const sb = supabaseBrowser();
  const [name, setName] = useState(team?.name ?? "");
  const [lead, setLead] = useState(team?.lead_member_id ?? "");
  const [ids, setIds] = useState<string[]>(team ? tm.filter((x) => x.team_id === team.id).map((x) => x.member_id) : []);
  const [msg, setMsg] = useState("");
  async function save() {
    let id = team?.id;
    if (id) {
      const { error } = await sb.from("teams").update({ name, lead_member_id: lead || null }).eq("id", id);
      if (error) return setMsg(error.message);
    } else {
      const { data, error } = await sb.from("teams").insert({ company_id: me.company_id, name, lead_member_id: lead || null }).select("id").single();
      if (error) return setMsg(error.message);
      id = data.id;
    }
    const before = tm.filter((x) => x.team_id === id).map((x) => x.member_id);
    const add = ids.filter((x) => !before.includes(x)), del = before.filter((x) => !ids.includes(x));
    if (add.length) await sb.from("team_members").insert(add.map((m) => ({ company_id: me.company_id, team_id: id, member_id: m })));
    if (del.length) await sb.from("team_members").delete().eq("team_id", id!).in("member_id", del);
    onClose();
  }
  return (
    <Dialog open onClose={onClose} title={team ? `Manage ${team.name}` : "New team"} footer={<Button onClick={save} disabled={!name.trim()}>Save</Button>}>
      <div className="flex flex-col gap-3">
        <Field label="Team name" htmlFor="tm-name"><Input id="tm-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Team lead" htmlFor="tm-lead"><Select id="tm-lead" value={lead} onChange={(e) => setLead(e.target.value)}><option value="">None</option>{members.filter((m) => m.status === "active").map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
        <fieldset><legend className="mb-1 text-[13px] font-semibold text-body">Members</legend>
          {members.filter((m) => m.status === "active" && m.role !== "accounts").map((m) => <label key={m.id} className="mr-3 inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={ids.includes(m.id)}
            onChange={() => setIds(ids.includes(m.id) ? ids.filter((x) => x !== m.id) : [...ids, m.id])} />{m.display_name}</label>)}
        </fieldset>
        {msg ? <p role="alert" className="text-sm text-danger">{msg}</p> : null}
      </div>
    </Dialog>
  );
}

