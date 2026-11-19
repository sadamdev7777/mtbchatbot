import Link from "next/link";
import { legal } from "@/lib/legal";

/** Public pages Meta and customers can read without signing in. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const l = legal();
  return (
    <div className="min-h-dvh bg-canvas px-4 py-8">
      <main className="mx-auto max-w-[760px] rounded-2xl border border-line bg-white p-6 text-[15px] leading-relaxed text-body shadow-sm md:p-10 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-ink [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
        {children}
        <hr className="my-8 border-line" />
        <p className="text-sm text-muted">{l.company}{l.address ? ` · ${l.address}` : ""}{l.email ? <> · <a href={`mailto:${l.email}`}>{l.email}</a></> : null}</p>
        <nav aria-label="Legal" className="mt-2 flex gap-4 text-sm"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/data-deletion">Data deletion</Link></nav>
      </main>
    </div>
  );
}
