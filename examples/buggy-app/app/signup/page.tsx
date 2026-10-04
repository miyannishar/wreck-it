"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const EMPTY = { displayName: "", email: "", password: "" };

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError("Something went wrong");
      setForm(EMPTY);
      return;
    }
    router.push("/products");
    router.refresh();
  }

  return (
    <div className="card" style={{ maxWidth: 460 }}>
      <h1>Create your account</h1>
      <form onSubmit={onSubmit} className="form">
        <div className="field">
          <label htmlFor="displayName">Your name</label>
          <input id="displayName" autoComplete="name" value={form.displayName} onChange={update("displayName")} required />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={form.email} onChange={update("email")} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="new-password" value={form.password} onChange={update("password")} required />
          <span className="muted small">At least 8 characters.</span>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? "Creating account…" : "Sign up"}
        </button>
        <p className="muted small">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
