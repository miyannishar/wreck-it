import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card">
      <h1>Page not found</h1>
      <p className="muted">We couldn&apos;t find what you were looking for.</p>
      <Link href="/products" className="button">
        Back to the shop
      </Link>
    </div>
  );
}
