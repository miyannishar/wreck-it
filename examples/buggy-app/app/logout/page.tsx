import Link from "next/link";

export default function LoggedOutPage() {
  return (
    <div className="card" style={{ maxWidth: 460 }}>
      <h1>You&apos;ve been logged out</h1>
      <p className="muted">Thanks for shopping with Gadgetly.</p>
      <p>
        <Link href="/login">Log in again</Link> or <Link href="/products">keep browsing</Link>.
      </p>
    </div>
  );
}
