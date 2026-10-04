"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { formatPrice } from "@/lib/format";
import type { Order } from "@/lib/types";

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    fetch("/api/orders", { cache: "no-store" }).then(async (res) => {
      if (res.status === 401) return router.push("/login?next=/orders");
      const data = await res.json();
      setOrders(data.orders);
    });
  }, [router]);

  if (orders.length === 0) return <Spinner label="Loading your orders" />;

  return (
    <>
      <h1>Your orders</h1>
      <table className="table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Date</th>
            <th>Items</th>
            <th>Status</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                <Link href={`/orders/${o.id}`}>#{o.id}</Link>
              </td>
              <td>{new Date(o.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
              <td>{o.items.reduce((n, i) => n + i.quantity, 0)}</td>
              <td style={{ textTransform: "capitalize" }}>{o.status}</td>
              <td>{formatPrice(o.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
