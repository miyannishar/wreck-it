import Link from "next/link";
import { db } from "@/lib/db";
import { formatPrice } from "@/lib/format";

export default async function HomePage() {
  const products = await db.listProducts();
  const featured = [products[1], products[4], products[14], products[22]];

  return (
    <>
      <section className="hero">
        <h1>Small gadgets, big joy.</h1>
        <p>
          Headphones, smart home, cameras and more. New here? Use code <span className="promo-code">SAVE10</span> for 10% off your
          first order.
        </p>
        <Link href="/products" className="button">
          Browse the shop
        </Link>
      </section>

      <h2>Featured</h2>
      <div className="grid">
        {featured.map((p) => (
          <Link key={p.id} href={`/products/${p.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <img src={p.image} alt={p.name} width={240} height={160} style={{ width: "100%", height: "auto" }} />
            <h3 style={{ margin: "8px 0 4px", fontSize: "1rem" }}>{p.name}</h3>
            <span className="muted">{formatPrice(p.price)}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
