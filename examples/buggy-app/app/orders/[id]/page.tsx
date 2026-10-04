import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatPrice } from "@/lib/format";
import { currentUser } from "@/lib/session";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/orders/${id}`);
  const order = await db.getOrder(id);
  if (!order || order.userId !== user.id) notFound();

  return (
    <div>
      <p>
        <Link href="/orders">← All orders</Link>
      </p>
      <h1>Order #{order.id}</h1>
      <p className="muted">
        Placed {order.createdAt} · <span style={{ textTransform: "capitalize" }}>{order.status}</span>
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.productId}>
              <td>{item.name}</td>
              <td>{item.quantity}</td>
              <td>{formatPrice(item.price * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card" style={{ maxWidth: 320, marginTop: 16, marginLeft: "auto" }}>
        <div className="summary-row">
          <span>Subtotal</span>
          <span>{formatPrice(order.subtotal)}</span>
        </div>
        {order.couponCode ? (
          <div className="summary-row">
            <span>Coupon {order.couponCode}</span>
            <span>−{formatPrice(order.discount)}</span>
          </div>
        ) : null}
        <div className="summary-row summary-total">
          <span>Total charged</span>
          <span>{formatPrice(order.total)}</span>
        </div>
      </div>
      <p className="muted small">
        Shipping to {order.address}
        {order.phone ? ` · ${order.phone}` : ""}
      </p>
    </div>
  );
}
