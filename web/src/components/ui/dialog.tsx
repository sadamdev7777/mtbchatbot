"use client";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function Dialog({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dialog-title"
      className={cn("m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40", wide ? "max-w-3xl" : "max-w-lg")}>
      {open ? (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 id="dialog-title" className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-chip">✕</button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
