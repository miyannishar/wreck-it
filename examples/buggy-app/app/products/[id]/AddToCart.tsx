"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { notifyCartChanged } from "@/components/CartButton";

export function AddToCart({ productId }: { productId: string }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState<"idle" | "adding" | "added" | "error">("idle");

  async function add() {
    setStatus("adding");
    const res = await fetch("/api/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId, quantity: parseInt(quantity, 10) }),
    });
    if (res.status === 401) {
      router.push(`/login?next=/products/${productId}`);
      return;
    }
    setStatus(res.ok ? "added" : "error");
    if (res.ok) notifyCartChanged();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 260 }}>
      <div className="field">
        <label htmlFor="quantity">Quantity</label>
        <input id="quantity" type="number" min={1} max={10} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </div>
      <button type="button" className="button" onClick={add} disabled={status === "adding"}>
        {status === "adding" ? "Adding…" : "Add to cart"}
      </button>
      {status === "added" ? (
        <p className="success">
          Added to cart. <Link href="/cart">View cart</Link>
        </p>
      ) : null}
      {status === "error" ? <p className="error">Couldn&apos;t add this item. Please try again.</p> : null}
    </div>
  );
}
