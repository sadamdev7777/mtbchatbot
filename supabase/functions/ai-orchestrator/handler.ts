// AI orchestrator: debounce, router, agent run, re-check, send (or draft).
import { db } from "../_shared/db.ts";
import { background, getCaller, handle, HttpError, json } from "../_shared/http.ts";
import { handleInbound, processConversation, rewriteDraft, sweep } from "../_shared/ai/orchestrator.ts";
import { sandboxTurn } from "../_shared/ai/sandbox.ts";
import { runAllScenarios } from "../_shared/ai/scenarios.ts";

export const handler = handle(async (req) => {
  const caller = await getCaller(req);
  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case "inbound": {
      if (caller.kind !== "service") throw new HttpError(403, "forbidden");
      const work = handleInbound(body.conversation_id, body.message_id);
      if (body.wait) return json({ ok: true, decision: await work });
      background(work);
      return json({ ok: true, queued: true });
    }
    case "process": {
      if (caller.kind !== "service") throw new HttpError(403, "forbidden");
      return json({ ok: true, ...(await processConversation(body.conversation_id)) });
    }
    case "sweep": {
      if (caller.kind !== "service") throw new HttpError(403, "forbidden");
      return json({ ok: true, swept: await sweep() });
    }
    case "rewrite_draft": {
      if (caller.kind !== "user") throw new HttpError(403, "forbidden");
      const { data: d } = await db().from("ai_drafts").select("conversation_id, company_id").eq("id", body.draft_id).maybeSingle();
      if (!d || d.company_id !== caller.me.company_id) throw new HttpError(404, "not_found");
      return json({ ok: true, body: await rewriteDraft(body.draft_id, body.instruction ?? "shorter") });
    }
    case "sandbox": {
      if (caller.kind === "user" && !["owner", "admin", "team_lead"].includes(caller.me.role)) throw new HttpError(403, "forbidden");
      const companyId = caller.kind === "user" ? caller.me.company_id : body.company_id;
      return json({ ok: true, ...(await sandboxTurn(companyId, body)) });
    }
    case "run_scenarios": {
      if (caller.kind === "user" && !["owner", "admin", "team_lead"].includes(caller.me.role)) throw new HttpError(403, "forbidden");
      const companyId = caller.kind === "user" ? caller.me.company_id : body.company_id;
      return json({ ok: true, ...(await runAllScenarios(companyId, body.agent_id, { knowledge: body.knowledge ?? "live", context: body.context ?? "manual", scenarioIds: body.scenario_ids })) });
    }
    case "activate_knowledge": {
      // Saved scenarios run before any knowledge version is activated.
      if (caller.kind === "user" && !["owner", "admin"].includes(caller.me.role)) throw new HttpError(403, "forbidden");
      const { data: doc } = await db().from("knowledge_docs").select("*").eq("id", body.doc_id).single();
      if (!doc || (caller.kind === "user" && doc.company_id !== caller.me.company_id)) throw new HttpError(404, "not_found");
      const agents = doc.scope === "agent" ? [doc.agent_id] : ((await db().from("agents").select("id").eq("company_id", doc.company_id).eq("status", "live")).data ?? []).map((a) => a.id);
      const override = [{ scope: doc.scope, section: doc.section, content: doc.content }];
      const runs = [];
      for (const a of agents) runs.push({ agent_id: a, ...(await runAllScenarios(doc.company_id, a, { knowledge: "live", knowledge_override: override, context: "knowledge_activation" })) });
      const failed = runs.flatMap((r) => r.results.filter((x) => !x.passed).map((x) => ({ agent_id: r.agent_id, scenario: x.name, failures: x.failures })));
      if (failed.length && !body.force) return json({ ok: false, error: "scenarios_failed", message: `${failed.length} scenario(s) failed; not activated`, failed });
      await db().rpc("activate_knowledge", { p_doc: doc.id, p_member: caller.kind === "user" ? caller.me.member_id : null });
      return json({ ok: true, activated: true, runs: runs.map((r) => ({ agent_id: r.agent_id, passed: r.passed, total: r.total })) });
    }
    default:
      throw new HttpError(400, "bad_request", "unknown action");
  }
});
