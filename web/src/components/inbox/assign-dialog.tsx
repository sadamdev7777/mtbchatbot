"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/input";
import type { Directory } from "@/lib/directory";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Conversation } from "@/lib/types";

export function AssignDialog({ open, onClose, conv, dir }: { open: boolean; onClose: () => void; conv: Conversation; dir: Directory }) {
  const [team, setTeam] = useState(conv.team_id ?? "");
  const [member, setMember] = useState("");
  const [error, setError] = useState("");
  const members = dir.members.filter((m) => m.status === "active" && m.role !== "accounts" && (!team || dir.teamMembers.some((tm) => tm.team_id === team && tm.member_id === m.id)));

  async function save() {
    const { error: e } = await supabaseBrowser().rpc("rpc_assign", { p_conv: conv.id, p_member: member || null, p_team: team || null });
    if (e) return setError(e.message === "not_allowed" ? "Only team leads, admins or the chat owner can reassign." : e.message);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Assign chat" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!team && !member}>Assign</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Team" htmlFor="as-team">
          <Select id="as-team" value={team} onChange={(e) => { setTeam(e.target.value); setMember(""); }}>
            <option value="">Keep current team</option>
            {dir.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Staff member" htmlFor="as-member" hint="Leave empty to put the chat in the team queue.">
          <Select id="as-member" value={member} onChange={(e) => setMember(e.target.value)}>
            <option value="">Nobody yet</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}{m.on_leave_until ? " (on leave)" : ""}</option>)}
          </Select>
        </Field>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    </Dialog>
  );
}
