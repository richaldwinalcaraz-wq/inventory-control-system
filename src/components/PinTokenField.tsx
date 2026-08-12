"use client";

import { useState } from "react";

interface PinTokenFieldProps {
  onTokenIssued: (pinTokenId: string) => void;
  tokenId: string | null;
}

/**
 * Mints a fresh TransactionPinToken (G-30) immediately before a
 * posting/approval action. This is required on EVERY such action
 * regardless of how recently the user logged in — a brand-new session is
 * not exempt. The token is single-use and expires in ~60s, so it's
 * fetched right before submit, not cached across the page lifetime.
 */
export function PinTokenField({ onTokenIssued, tokenId }: PinTokenFieldProps) {
  const [pin, setPin] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/session/pin-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not verify PIN.");
        return;
      }
      onTokenIssued(json.data.id);
    } finally {
      setPending(false);
    }
  }

  if (tokenId) {
    return <p className="text-sm text-green-700">PIN verified — ready to submit.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-slate-700" htmlFor="pin-token-field">
        Enter your PIN to authorize this action
      </label>
      <div className="flex gap-2">
        <input
          id="pin-token-field"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="w-32 rounded-md border border-slate-300 px-3 py-2 text-base"
        />
        <button
          type="button"
          disabled={pending || pin.length === 0}
          onClick={unlock}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Checking…" : "Verify PIN"}
        </button>
      </div>
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
