import { Suspense } from "react";
import { InboxApp } from "@/components/inbox/inbox-app";

export const metadata = { title: "Inbox" };

export default function InboxPage() {
  return <Suspense><InboxApp /></Suspense>;
}
