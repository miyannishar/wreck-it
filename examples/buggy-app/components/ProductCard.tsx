import Link from "next/link";
import { formatPrice } from "@/lib/format";
import type { ProductSummary } from "@/lib/types";
import styles from "./ProductCard.module.css";

export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <article className={styles.card}>
      <Link href={`/products/${product.id}`} className={styles.link}>
        <img src={product.image} alt="" className={styles.image} width={240} height={160} />
        <h2 className={styles.name}>{product.name}</h2>
      </Link>
      <p className={styles.meta}>
        <span className={styles.rating}>★ {`${product.rating?.toFixed(1)} (${product.reviewCount})`}</span>
        <span className={styles.category}>{product.category}</span>
      </p>
      <p className={styles.price}>{formatPrice(product.price)}</p>
    </article>
  );
}
