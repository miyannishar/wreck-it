"use client";

import { useState } from "react";

export function SettingsForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setMessage({ kind: "error", text: data.error ?? "Couldn't save your changes" });
    setName(data.user.displayName);
    setMessage({ kind: "success", text: "Your changes have been saved." });
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="field">
        <label htmlFor="displayName">Display name</label>
        <input id="displayName" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </div>
      {message ? <p className={message.kind}>{message.text}</p> : null}
      <button type="submit" className="button" disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
