"use client";
import Link from "next/link";
import { NotificationList } from "@/components/shell/notification-center";
import { useNotifications } from "@/components/shell/notifications-provider";
import { Card } from "@/components/ui/misc";

export default function NotificationsPage() {
  const { rows, markAll } = useNotifications();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 md:p-8">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Notifications</h1><Link href="/settings/notifications" className="text-sm font-semibold">Settings</Link></div>
      <Card><NotificationList rows={rows} onMarkAll={markAll} /></Card>
    </div>
  );
}
