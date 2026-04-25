"use client";

import { useEffect, useRef, useState } from "react";
import { parseFiles } from "@/lib/parser";
import { clearHistory, loadHistory, saveHistory } from "@/lib/storage";
import type { StoredHistory } from "@/lib/types";
import StatsSummary from "./StatsSummary";

type Status =
  | { kind: "idle" }
  | { kind: "parsing"; message: string }
  | { kind: "error"; message: string };

export default function UploadZone() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [history, setHistory] = useState<StoredHistory | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadHistory().then((h) => {
      if (h) setHistory(h);
    });
  }, []);

  async function handleFiles(files: FileList | File[] | null) {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;

    setStatus({ kind: "parsing", message: "Reading files…" });
    try {
      const result = await parseFiles(arr, (msg) =>
        setStatus({ kind: "parsing", message: msg }),
      );
      if (result.totalPlays === 0) {
        setStatus({
          kind: "error",
          message:
            "Files parsed but no plays found. Make sure you uploaded the streaming-history JSONs (not the playlist or library files).",
        });
        return;
      }
      await saveHistory(result);
      const stored = await loadHistory();
      setHistory(stored ?? null);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function reset() {
    await clearHistory();
    setHistory(null);
    setStatus({ kind: "idle" });
  }

  if (history) {
    return <StatsSummary history={history} onReset={reset} />;
  }

  const parsing = status.kind === "parsing";

  return (
    <div className="flex flex-col gap-4">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!parsing) handleFiles(e.dataTransfer.files);
        }}
        className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-8 py-16 text-center transition-colors ${
          dragOver
            ? "border-[var(--brand)] bg-[var(--brand)]/[0.06]"
            : "border-white/10 bg-[var(--surface)] hover:border-white/20 hover:bg-[var(--surface-elevated)]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".zip,.json,application/zip,application/json"
          className="sr-only"
          disabled={parsing}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <UploadIcon />
        {parsing ? (
          <>
            <div className="text-base font-semibold text-white">
              {status.message}
            </div>
            <div className="text-xs text-[var(--muted)]">
              Parsing happens in your browser. Nothing is uploaded to a server.
            </div>
            <ParseSpinner />
          </>
        ) : (
          <>
            <div className="text-base font-semibold text-white">
              Drop your Spotify data ZIP here
            </div>
            <div className="max-w-md text-sm text-[var(--muted)]">
              Or click to choose. Drop the ZIP Spotify emailed you, or the
              individual{" "}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">
                StreamingHistory*.json
              </code>{" "}
              /{" "}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">
                Streaming_History_Audio_*.json
              </code>{" "}
              files. Everything stays in your browser.
            </div>
          </>
        )}
      </label>

      {status.kind === "error" && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.08] px-4 py-3 text-sm text-red-200">
          <strong className="font-semibold">Couldn&apos;t parse:</strong>{" "}
          {status.message}
        </div>
      )}

      <details className="rounded-xl border border-white/[0.06] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
        <summary className="cursor-pointer font-medium text-white">
          Don&apos;t have your data yet?
        </summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5">
          <li>
            Go to{" "}
            <a
              href="https://www.spotify.com/account/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--brand)] underline hover:no-underline"
            >
              spotify.com/account/privacy
            </a>
          </li>
          <li>
            Scroll to <em>Download your data</em> and tick{" "}
            <strong className="text-white">both</strong>:
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                <strong className="text-white">Account data</strong> — last 12
                months, arrives in 1–5 days
              </li>
              <li>
                <strong className="text-white">Extended streaming history</strong>{" "}
                — full lifetime, arrives in up to 30 days
              </li>
            </ul>
          </li>
          <li>Confirm via the email Spotify sends</li>
          <li>
            When the second email arrives with the ZIP, drop it on this page
          </li>
        </ol>
      </details>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      className="h-10 w-10 text-[var(--brand)]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ParseSpinner() {
  return (
    <div className="mt-2 flex h-1 w-48 overflow-hidden rounded-full bg-white/10">
      <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-[var(--brand)]" />
      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
