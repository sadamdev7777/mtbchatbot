import { legal } from "@/lib/legal";

export const metadata = { title: "Data deletion" };

export default function DataDeletion() {
  const l = legal();
  return (
    <article>
      <h1>Delete your data</h1>
      <p className="text-sm text-muted">Last updated {l.updated}</p>
      <p>You can ask {l.company} to delete everything we hold about you from MTB Inbox.</p>

      <h2>How to ask</h2>
      <ul>
        <li>Send <strong>PADAM DATA</strong> (or &quot;delete my data&quot;) by WhatsApp to the number you chat with us on.</li>
        {l.email ? <li>Or email <a href={`mailto:${l.email}`}>{l.email}</a> with your WhatsApp number.</li> : null}
      </ul>
      <p>We confirm by WhatsApp that the request came from your number, then delete within 30 days, usually much sooner.</p>

      <h2>What we delete</h2>
      <ul>
        <li>Your contact record, name and number.</li>
        <li>All chats, messages, photos, documents and notes.</li>
        <li>Labels and follow-ups linked to you.</li>
      </ul>

      <h2>What we keep</h2>
      <p>Payment records needed for accounting and tax law are kept, without the link to your chats. If you have an active booking, we tell you first, because we need some details to run your trip.</p>

      <h2>Bahasa Melayu</h2>
      <p>Taip <strong>PADAM DATA</strong> di WhatsApp kami. Kami akan sahkan dan padam semua chat, mesej, fail dan maklumat hubungan cik dalam masa 30 hari. Rekod bayaran disimpan untuk tujuan perakaunan sahaja.</p>
    </article>
  );
}
