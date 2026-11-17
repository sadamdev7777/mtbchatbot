export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <section className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-whatsapp">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B2B26" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.9A8 8 0 1 1 21 12z" /></svg>
          </div>
          <div>
            <div className="text-lg font-bold text-ink">MTB Inbox</div>
            <div className="text-xs text-muted">Muslimtravelbug</div>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">{children}</div>
      </section>
    </div>
  );
}
