import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductDetail } from "@/lib/catalog";
import { formatPrice } from "@/lib/format";
import { AddToCart } from "./AddToCart";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProductDetail(id);
  if (!product) notFound();

  return (
    <div>
      <p>
        <Link href="/products">← All products</Link>
      </p>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <img src={product.image} alt={product.name} width={360} height={240} style={{ maxWidth: "100%", height: "auto", borderRadius: 12 }} />
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1>{product.name}</h1>
          <p className="muted" style={{ textTransform: "capitalize" }}>
            {product.category} ·{" "}
            {product.rating !== undefined ? `★ ${product.rating.toFixed(1)} from ${product.reviewCount} reviews` : "No reviews yet"}
          </p>
          <p style={{ fontSize: "1.5rem", fontWeight: 700 }}>{formatPrice(product.price)}</p>
          <p>{product.description}</p>
          <p className="muted small">{product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}</p>
          <AddToCart productId={product.id} />
        </div>
      </div>

      <h2 style={{ marginTop: 40 }}>Reviews</h2>
      {product.reviews.length === 0 ? <p className="muted">Be the first to review this product.</p> : null}
      {product.reviews.map((r) => (
        <div key={r.id} className="card" style={{ marginBottom: 12 }}>
          <strong>{r.author}</strong> <span className="muted">· {"★".repeat(r.rating)}</span>
          <p style={{ margin: "6px 0 0" }}>{r.body}</p>
        </div>
      ))}
    </div>
  );
}
