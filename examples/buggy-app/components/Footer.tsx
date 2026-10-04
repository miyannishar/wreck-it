import Link from "next/link";
import { VisitorCount } from "./VisitorCount";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div>
          <strong>Gadgetly</strong>
          <p className="muted">Small gadgets, big joy. Free shipping over $50.</p>
          <VisitorCount />
        </div>
        <nav aria-label="Footer" className="footer-links">
          <Link href="/products">All products</Link>
          <Link href="/about">About us</Link>
          <Link href="/pricng">Shipping &amp; pricing</Link>
          <Link href="/orders">Track an order</Link>
          <Link href="/account/settings">Account</Link>
        </nav>
      </div>
    </footer>
  );
}
