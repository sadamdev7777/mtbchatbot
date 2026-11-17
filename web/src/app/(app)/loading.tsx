/** Shown instantly inside the app shell while the next screen loads, so menu clicks respond at once. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-1 flex-col gap-4 p-6">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-48 animate-pulse rounded-md bg-chip" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-chip" />)}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-chip" />
    </div>
  );
}
