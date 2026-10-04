"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function VisitorCount() {
  const pathname = usePathname();
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/stats?page=${encodeURIComponent(pathname)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setOnline(data.shoppersOnline))
      .catch(() => {});
  }, [pathname]);

  if (online === null) return null;
  return <p className="muted small">{online} shoppers browsing right now</p>;
}
