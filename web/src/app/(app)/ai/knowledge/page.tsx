"use client";
import { AiFrame } from "@/components/ai/common";
import { KnowledgeEditor } from "@/components/ai/knowledge-editor";
import { OfficialAnswers } from "@/components/ai/official-answers";

export default function Page() {
  return (
    <AiFrame title="Company knowledge" description="Inherited by all agents. Package knowledge (itinerary, hotels) lives in each agent; dates, prices and seats always come live from TravelBoost.">
      <p role="note" className="rounded-lg bg-panel px-4 py-3 text-sm">If a package has a different rule (e.g. a higher deposit), write it in that package&apos;s agent. Agents use the package rule first, then the company one.</p>
      <KnowledgeEditor scope="company" defaultSections={["payments", "cancellation", "booking_documents", "language_style", "about"]} />
      <OfficialAnswers />
    </AiFrame>
  );
}
