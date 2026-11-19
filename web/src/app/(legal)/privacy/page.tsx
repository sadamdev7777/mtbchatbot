import { legal } from "@/lib/legal";

export const metadata = { title: "Privacy Policy" };

export default function Privacy() {
  const l = legal();
  const contact = l.email ? <>by WhatsApp to the number you chat with, or by email to <a href={`mailto:${l.email}`}>{l.email}</a></> : <>by WhatsApp to the number you chat with</>;
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p className="text-sm text-muted">Last updated {l.updated}</p>
      <p>{l.company} (&quot;we&quot;) runs MTB Inbox, the system our team uses to answer customers on WhatsApp about our travel packages. This policy explains what we collect when you message us, why, and your choices. It follows Malaysia&apos;s Personal Data Protection Act 2010 (PDPA).</p>

      <h2>What we collect</h2>
      <ul>
        <li>Your WhatsApp number and profile name.</li>
        <li>Messages, photos, documents and voice notes you send us, and our replies.</li>
        <li>Details you give for a booking: names, number of travellers, travel dates, email, state, passport details and payment receipts.</li>
        <li>Message delivery status (sent, delivered, read) provided by WhatsApp.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To answer your questions, quote prices and seats, and make and manage your booking.</li>
        <li>To confirm payments and send trip information such as itineraries and reminders.</li>
        <li>To send promotions only if you agreed. Reply STOP at any time to stop them.</li>
        <li>To improve our service and train our staff.</li>
      </ul>

      <h2>AI assistant</h2>
      <p>Some replies are written by an AI assistant (Claude, by Anthropic) that works from our package information. Our staff can see every conversation and take over at any time, and you can ask to speak to a person. Anthropic processes messages only to produce the reply and does not use them to train its models.</p>

      <h2>Who we share it with</h2>
      <p>We do not sell your data. We share it only with service providers that run the system for us:</p>
      <ul>
        <li>Meta (WhatsApp Business Platform) to send and receive messages.</li>
        <li>Anthropic (Claude) for AI-written replies.</li>
        <li>Supabase and Netlify for secure hosting and storage.</li>
        <li>Our booking system (TravelBoost) for seats, prices and bookings.</li>
        <li>Our email provider, for booking and account emails.</li>
      </ul>
      <p>Some of these providers store data outside Malaysia. We choose providers that protect data with encryption and access controls.</p>

      <h2>How long we keep it</h2>
      <p>We keep chats and booking details while we serve you and for after-sales support, and payment records for as long as accounting and tax law requires. You can ask us to delete your data at any time.</p>

      <h2>Your rights</h2>
      <ul>
        <li>Ask for a copy of your data or correct it.</li>
        <li>Stop promotions by replying STOP.</li>
        <li>Ask us to delete your data: see <a href="/data-deletion">Data deletion</a>.</li>
      </ul>
      <p>Contact us {contact}.</p>

      <h2>Ringkasan (Bahasa Melayu)</h2>
      <p>Kami simpan nombor WhatsApp, nama, mesej dan maklumat tempahan cik untuk menjawab pertanyaan dan menguruskan tempahan. Sebahagian balasan ditulis oleh pembantu AI dan staf kami boleh ambil alih bila-bila masa. Kami tidak menjual data cik. Taip STOP untuk berhenti terima promosi. Untuk padam data, taip &quot;PADAM DATA&quot; di WhatsApp kami.</p>
    </article>
  );
}
