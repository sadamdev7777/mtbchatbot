import { Suspense } from "react";
import { NewAgentWizard } from "@/components/ai/wizard";

export const metadata = { title: "New agent" };

export default function Page() {
  return <Suspense><NewAgentWizard /></Suspense>;
}
