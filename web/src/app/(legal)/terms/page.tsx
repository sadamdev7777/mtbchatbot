import { legal } from "@/lib/legal";

export const metadata = { title: "Terms of Service" };

export default function Terms() {
  const l = legal();
  return (
    <article>
      <h1>Terms of Service</h1>
      <p className="text-sm text-muted">Last updated {l.updated}</p>
      <p>These terms cover messaging {l.company} on WhatsApp. Your booking itself is governed by the terms and conditions of the package you book.</p>

      <h2>Our WhatsApp service</h2>
      <ul>
        <li>You can ask about our packages, get prices and seat availability, book, pay and get trip updates.</li>
        <li>Some replies come from an AI assistant. It works only from our package information and hands you to our staff when it cannot help or when you ask.</li>
        <li>Prices and seats come from our booking system at the moment you ask. A seat is only held after you complete the booking link and pay the deposit before it expires.</li>
        <li>If an AI reply is wrong about a price, date or policy, the confirmed booking and our package terms apply. Our staff will correct it.</li>
      </ul>

      <h2>Messages from us</h2>
      <ul>
        <li>We message you about your enquiry and booking, such as payment confirmations, reminders and itineraries.</li>
        <li>Promotions are sent only if you agreed. Reply STOP to stop them.</li>
        <li>Automatic reminders and promotions are not sent late at night or during Friday prayers.</li>
      </ul>

      <h2>Your part</h2>
      <ul>
        <li>Give correct details for your booking and travellers.</li>
        <li>Do not send unlawful, abusive or harmful content.</li>
      </ul>

      <h2>Privacy</h2>
      <p>How we handle your data is in our <a href="/privacy">Privacy Policy</a>. To delete it, see <a href="/data-deletion">Data deletion</a>.</p>

      <h2>Changes</h2>
      <p>We may update these terms. The date at the top shows the latest version. These terms are governed by the laws of Malaysia.</p>
    </article>
  );
}
