import { Suspense } from "react";
import { TestBot } from "@/components/ai/test-bot";

export const metadata = { title: "Test bot" };

export default function Page() {
  return <Suspense><TestBot /></Suspense>;
}
