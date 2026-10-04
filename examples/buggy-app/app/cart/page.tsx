"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { notifyCartChanged } from "@/components/CartButton";
import { Spinner } from "@/components/Spinner";
import type { CartView } from "@/lib/cart";
import { formatPrice } from "@/lib/format";

export default function CartPage() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [code, setCode] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cart", { cache: "no-store" }).then(async (res) => {
      if (res.status === 401) return setNeedsLogin(true);
      setCart(await res.json());
    });
  }, []);

  async function send(url: string, init: RequestInit) {
    const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
    if (res.ok) {
      setCart(await res.json());
      notifyCartChanged();
    }
    return res;
  }

  const updateQuantity = (productId: string, quantity: number) =>
    send("/api/cart", { method: "PATCH", body: JSON.stringify({ productId, quantity }) });

  const remove = (productId: string) => send(`/api/cart?productId=${encodeURIComponent(productId)}`, { method: "DELETE" });

  async function applyCode(e: React.FormEvent) {
    e.preventDefault();
    setCouponError(null);
    const res = await send("/api/cart/coupon", { method: "POST", body: JSON.stringify({ code }) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCouponError(data.error ?? "Couldn't apply that code");
    } else setCode("");
  }

  if (needsLogin) {
    return (
      <div className="card">
        <h1>Your cart</h1>
        <p>
          Please <Link href="/login?next=/cart">log in</Link> to see your cart.
        </p>
      </div>
    );
  }
  if (!cart) return <Spinner label="Loading cart" />;
  if (cart.items.length === 0) return <><h1>Your cart</h1><p>Your cart is empty.</p></>;

  return (
    <>
      <h1>Your cart</h1>
      <table className="table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Price</th>
            <th>Qty</th>
            <th>Total</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cart.items.map((item) => (
            <tr key={item.productId}>
              <td>
                <Link href={`/products/${item.productId}`}>{item.name}</Link>
              </td>
              <td>{formatPrice(item.price)}</td>
              <td>
                <input
                  type="number"
                  aria-label={`Quantity for ${item.name}`}
                  defaultValue={item.quantity}
                  style={{ width: 70 }}
                  onBlur={(e) => {
                    const next = Number(e.target.value);
                    if (next !== item.quantity) updateQuantity(item.productId, next);
                  }}
                />
              </td>
              <td>{formatPrice(item.lineTotal)}</td>
              <td>
                <button type="button" className="link-button" onClick={() => remove(item.productId)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginTop: 24 }}>
        <form onSubmit={applyCode} className="form" style={{ flex: 1, minWidth: 240 }}>
          <div className="field">
            <label htmlFor="coupon">Coupon code</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input id="coupon" value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <button type="submit" className="button button-secondary">
                Apply
              </button>
            </div>
          </div>
          {couponError ? <p className="error">{couponError}</p> : null}
          {cart.coupon ? (
            <p className="success">
              Code {cart.coupon.code} applied ({cart.coupon.percent}% off).{" "}
              <button type="button" className="link-button" onClick={() => send("/api/cart/coupon", { method: "DELETE" })}>
                Remove
              </button>
            </p>
          ) : null}
        </form>

        <div className="card" style={{ minWidth: 260 }}>
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{formatPrice(cart.subtotal)}</span>
          </div>
          {cart.discount ? (
            <div className="summary-row">
              <span>Discount</span>
              <span>−{formatPrice(cart.discount)}</span>
            </div>
          ) : null}
          <div className="summary-row summary-total">
            <span>Total</span>
            <span>{formatPrice(cart.total)}</span>
          </div>
          <Link href="/checkout" className="button" style={{ display: "block", textAlign: "center", marginTop: 12 }}>
            Checkout
          </Link>
        </div>
      </div>
    </>
  );
}
