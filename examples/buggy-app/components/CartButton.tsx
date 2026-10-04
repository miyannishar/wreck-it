"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export const CART_CHANGED = "gadgetly:cart-changed";

export function notifyCartChanged() {
  window.dispatchEvent(new Event(CART_CHANGED));
}

export function CartButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetch("/api/cart", { cache: "no-store" });
      const data = res.ok ? await res.json() : { count: 0 };
      if (!cancelled) setCount(data.count);
    };
    load();
    window.addEventListener(CART_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CART_CHANGED, load);
    };
  }, [pathname]);

  return (
    <div className="cart-button-wrap">
      <button type="button" className="cart-button" onClick={() => router.push("/cart")}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
        </svg>
      </button>
      {count !== 0 ? <span className="cart-badge" aria-hidden="true">{count}</span> : null}
    </div>
  );
}
