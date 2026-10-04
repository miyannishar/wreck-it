"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProductCard } from "@/components/ProductCard";
import { Spinner } from "@/components/Spinner";
import type { ProductSummary } from "@/lib/types";
import styles from "./products.module.css";

const CATEGORIES = ["all", "audio", "wearables", "home", "accessories", "cameras", "gaming"];

function ProductsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const [draft, setDraft] = useState(query);
  const [category, setCategory] = useState("all");
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProducts(null);
    setError(null);
    const url = query ? `/api/search?q=${encodeURIComponent(query)}` : "/api/products";
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        if (!cancelled) setProducts(data.products);
      })
      .catch(() => !cancelled && setError("Sorry, we couldn't load products. Please try again."));
    return () => {
      cancelled = true;
    };
  }, [query]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    router.push(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname);
  }

  const visible = products?.filter((p) => category === "all" || p.category === category) ?? [];

  return (
    <>
      <h1>{query ? `Results for “${query}”` : "All products"}</h1>
      <form onSubmit={onSearch} className={styles.search} role="search">
        <label htmlFor="search" className="visually-hidden">
          Search products
        </label>
        <input id="search" type="search" placeholder="Search gadgets…" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="button">
          Search
        </button>
      </form>

      <div className={styles.filters}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={c === category ? `${styles.chip} ${styles.active}` : styles.chip}
            aria-pressed={c === category}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {!error && products === null ? <Spinner label="Loading products" /> : null}
      {products && visible.length === 0 ? <p className="muted">No products match your search. Try a different word.</p> : null}
      <div className="grid">
        {visible.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ProductsView />
    </Suspense>
  );
}
