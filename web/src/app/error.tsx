"use client";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch("/api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: error.message, digest: error.digest, path: location.pathname }) }).catch(() => {});
  }, [error]);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center">
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="text-sm text-muted">The error was reported. Try again; if it keeps happening, tell your admin.</p>
      <button type="button" onClick={reset} className="h-11 rounded-lg bg-brand px-5 font-semibold text-white">Try again</button>
    </div>
  );
}
