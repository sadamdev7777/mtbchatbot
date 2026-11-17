import { Suspense } from "react";
import { BroadcastApp } from "@/components/broadcast/broadcast-app";

export const metadata = { title: "Broadcast" };

export default function Page() {
  return <Suspense><BroadcastApp /></Suspense>;
}
