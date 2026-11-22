export type IntegrationKey = "meta_whatsapp" | "smtp" | "web_push" | "claude" | "travelboost" | "bank_email" | "hrboost" | "meta_ads" | "sleekflow";

export interface FieldDef { name: string; label: string; secret?: boolean; type?: "text" | "number" | "email" | "url"; placeholder?: string; hint?: string }
export interface IntegrationDef {
  key: IntegrationKey; name: string; group: "phase1" | "phase2" | "optional";
  without: string; with: string; fields: FieldDef[]; howTo: string[]; testable: boolean;
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    key: "meta_whatsapp", name: "Meta WhatsApp Cloud API", group: "phase1", testable: true,
    without: "No real messages. Use the dev simulator to send fake inbound messages.",
    with: "Customers message your official number; replies, templates and broadcasts go out through Meta.",
    fields: [
      { name: "app_id", label: "Meta App ID", hint: "For Connect with Facebook (Embedded Signup)." },
      { name: "es_config_id", label: "Embedded Signup configuration ID", hint: "Facebook Login for Business › Configurations › WhatsApp Embedded Signup." },
      { name: "waba_id", label: "WhatsApp Business Account ID", hint: "Leave blank: Test connection finds it from the token." },
      { name: "phone_number_id", label: "Phone number ID", hint: "Leave blank: Test connection finds it from the token." },
      { name: "display_phone", label: "Display number", placeholder: "+60 3-2788 0000" },
      { name: "token", label: "Permanent System User token", secret: true },
      { name: "app_secret", label: "App Secret", secret: true, hint: "Used to verify the X-Hub-Signature-256 of every webhook." },
      { name: "graph_version", label: "Graph API version", placeholder: "v24.0" },
    ],
    howTo: [
      "Quickest: fill in the Meta App ID, Embedded Signup configuration ID and App Secret, save, then click Connect with Facebook. It picks the WhatsApp account and number, stores the token and subscribes the webhook for you. Add this site's domain under App settings › Basic › App domains and Facebook Login for Business › Allowed domains.",
      "Manual alternative: save the token and App Secret, leave the two IDs blank and press Test connection. It finds the WhatsApp account and number the token can reach and subscribes the app to its webhooks.",
      "Business Settings › System users: create a system user, give it the app and the WABA with full control, and generate a permanent token with whatsapp_business_messaging and whatsapp_business_management.",
      "App dashboard › App settings › Basic: copy the App Secret.",
      "App dashboard › WhatsApp › Configuration: paste the webhook URL and verify token below, then subscribe to the messages field.",
    ],
  },
  {
    key: "smtp", name: "Outgoing email (SMTP)", group: "phase1", testable: true,
    without: "Emails (2-step codes, invites) use Supabase's built-in email.",
    with: "Emails come from your own domain.",
    fields: [
      { name: "host", label: "Host", placeholder: "smtp.zoho.com" },
      { name: "port", label: "Port", type: "number", placeholder: "587" },
      { name: "user", label: "Username" },
      { name: "password", label: "Password", secret: true },
      { name: "from", label: "From", placeholder: "MTB Inbox <no-reply@muslimtravelbug.com>" },
    ],
    howTo: ["Use the SMTP settings of your email provider (Zoho, Google Workspace, Microsoft 365…).", "Use an app password if the provider requires 2-step verification."],
  },
  {
    key: "web_push", name: "Web Push", group: "phase1", testable: true,
    without: "Browser sound only, while MTB Inbox is open.",
    with: "Phones and computers get push notifications even when the app is closed.",
    fields: [{ name: "subject", label: "Contact email for push services", placeholder: "mailto:ops@muslimtravelbug.com" }],
    howTo: ["Click Generate keys. The public key is shared with browsers; the private key stays in the vault.", "Then each staff member turns on push in Settings › My notifications."],
  },
  {
    key: "claude", name: "Claude API", group: "phase2", testable: true,
    without: "AI agents are inactive; staff reply to all chats; no drafts.",
    with: "AI agents answer, draft, audit chats at night and read receipts.",
    fields: [
      { name: "api_key", label: "API key", secret: true },
      { name: "monthly_cap_rm", label: "Monthly spend cap (RM)", type: "number", hint: "When reached, agents switch to Assist mode (drafts off too) and the owner is notified." },
    ],
    howTo: ["Create an API key at console.anthropic.com › API keys.", "Set a monthly cap you are comfortable with; usage is tracked per run."],
  },
  {
    key: "travelboost", name: "TravelBoost", group: "phase2", testable: true,
    without: "Agents can't check seats; staff use TravelBoost directly; stage is changed manually.",
    with: "Live seats and prices, seat-lock links, bookings, payments and automatic stages.",
    fields: [
      { name: "base_url", label: "Base URL", type: "url", placeholder: "https://api.travelboost.my/v1" },
      { name: "api_key", label: "API key", secret: true },
      { name: "webhook_secret", label: "Webhook secret", secret: true },
    ],
    howTo: ["TravelBoost implements the contract in docs/travelboost-api.openapi.yaml.", "Create an API key and a webhook secret in TravelBoost, then register the webhook URL below for all events."],
  },
  {
    key: "bank_email", name: "Bank notification email", group: "optional", testable: true,
    without: "Accounts verifies every receipt by hand.",
    with: "Receipts that match a bank email exactly are verified automatically.",
    fields: [
      { name: "host", label: "IMAP host", placeholder: "imap.gmail.com" },
      { name: "port", label: "Port", type: "number", placeholder: "993" },
      { name: "email", label: "Email address", type: "email" },
      { name: "app_password", label: "App password", secret: true },
      { name: "trusted_senders", label: "Trusted sender addresses", placeholder: "alerts@maybank.com.my, cimbclicks@cimb.com", hint: "Comma separated. Only emails from these addresses can auto-verify." },
    ],
    howTo: ["Use a mailbox that only receives bank notifications.", "Turn on IMAP and create an app password. Access is read-only."],
  },
  {
    key: "hrboost", name: "HRBoost", group: "optional", testable: true,
    without: "Admin marks leave manually in Settings › Staff & teams.",
    with: "Staff on approved leave are taken out of round-robin automatically.",
    fields: [{ name: "base_url", label: "Base URL", type: "url" }, { name: "api_key", label: "API key", secret: true }],
    howTo: ["Create an API key in HRBoost with read access to leave."],
  },
  {
    key: "meta_ads", name: "Meta Ads", group: "optional", testable: true,
    without: "Map ad IDs to agents manually in the Router.",
    with: "Pick ads by name in the Router; ad names show on chats.",
    fields: [
      { name: "ad_account_id", label: "Ad account ID", placeholder: "act_1234567890" },
      { name: "token", label: "Token with ads_read (optional)", secret: true, hint: "Leave empty to reuse the WhatsApp token if it has ads_read." },
    ],
    howTo: ["Business Settings › Ad accounts: copy the account ID.", "Give the system user ads_read on the ad account."],
  },
  {
    key: "sleekflow", name: "SleekFlow import", group: "optional", testable: false,
    without: "Contacts are created when customers message.",
    with: "Your existing SleekFlow contacts (with opt-in) are in MTB Inbox from day one.",
    fields: [],
    howTo: ["In SleekFlow, export contacts as CSV.", "Import the file in Contacts › Import CSV. Only contacts marked as subscribed get broadcasts."],
  },
];

export const GROUP_LABEL = { phase1: "Required · phase 1", phase2: "Required · phase 2", optional: "Optional" } as const;
