"use client";
import { useState } from "react";

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const id = `copy-${label.replace(/\W/g, "")}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-body">{label}</label>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-panel px-3 font-mono text-xs" onFocus={(e) => e.target.select()} />
        <button type="button" className="h-10 rounded-lg border border-input bg-white px-3 text-sm font-semibold text-body"
          onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
