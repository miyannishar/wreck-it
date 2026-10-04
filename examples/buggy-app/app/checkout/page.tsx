"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { notifyCartChanged } from "@/components/CartButton";
import { Spinner } from "@/components/Spinner";
import type { CartView } from "@/lib/cart";
import { formatPrice } from "@/lib/format";

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartView | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cart", { cache: "no-store" }).then(async (res) => {
      if (res.status === 401) return setNeedsLogin(true);
      setCart(await res.json());
    });
  }, []);

  async function placeOrder() {
    setError(null);
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, phone }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "We couldn't place your order. Please try again.");
      return;
    }
    notifyCartChanged();
    router.push(`/orders/${data.order.id}`);
  }

  if (needsLogin) {
    return (
      <>
        <h1>Checkout</h1>
        <p>
          Please <Link href="/login?next=/checkout">log in</Link> to check out.
        </p>
      </>
    );
  }
  if (!cart) return <Spinner label="Loading checkout" />;
  if (cart.items.length === 0) {
    return (
      <><h1>Checkout</h1><p>
        Your cart is empty. <Link href="/products">Find something you like</Link>.
      </p></>
    );
  }

  return (
    <>
      <h1>Checkout</h1>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <div className="form" style={{ flex: 1, minWidth: 260 }}>
          <div className="field">
            <label htmlFor="address">Delivery address</label>
            <textarea id="address" rows={3} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="field">
            <div className="field-label">Phone number</div>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          {error ? <p className="error">{error}</p> : null}
          <button type="button" className="button" onClick={placeOrder}>
            Place order
          </button>
        </div>

        <div className="card" style={{ minWidth: 260 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Order summary</h2>
          {cart.items.map((item) => (
            <div key={item.productId} className="summary-row">
              <span>
                {item.name} × {item.quantity}
              </span>
              <span>{formatPrice(item.lineTotal)}</span>
            </div>
          ))}
          {cart.discount ? (
            <div className="summary-row">
              <span>Discount ({cart.coupon?.code})</span>
              <span>−{formatPrice(cart.discount)}</span>
            </div>
          ) : null}
          <div className="summary-row summary-total">
            <span>Total</span>
            <span>{formatPrice(cart.total)}</span>
          </div>
        </div>
      </div>
    </>
  );
}
