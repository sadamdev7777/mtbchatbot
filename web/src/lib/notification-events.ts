export const NOTIFICATION_EVENTS = [
  { key: "needs_staff_assigned", label: "A needs-staff chat is assigned to me" },
  { key: "customer_replied", label: "A customer replies in a chat I own" },
  { key: "mentioned", label: "I'm @mentioned" },
  { key: "team_unanswered", label: "My team's chat is unanswered for 30 minutes" },
  { key: "receipt_review", label: "A receipt needs review" },
  { key: "itinerary_questions", label: "Itinerary questions are assigned to me" },
  { key: "morning_report", label: "The morning report is ready" },
  { key: "message_failed", label: "A message failed or number quality dropped" },
  { key: "system_error", label: "Background jobs are failing (owners)" },
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]["key"] | "chat_assigned" | "spend_cap";
