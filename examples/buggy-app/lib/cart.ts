import type { Cart } from "./types";

export type CartView = {
  items: Array<Cart["items"][number] & { lineTotal: number }>;
  coupon: Cart["coupon"];
  subtotal: number;
  discount: number;
  total: number;
  count: number;
};

export function applyCoupon(amount: number, coupon: Cart["coupon"]): number {
  if (!coupon) return amount;
  return Math.round(amount * (1 - coupon.percent / 100));
}

export function summarize(cart: Cart): CartView {
  const items = cart.items.map((item) => ({ ...item, lineTotal: item.price * item.quantity }));
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  const total = applyCoupon(subtotal, cart.coupon);
  return {
    items,
    coupon: cart.coupon,
    subtotal,
    discount: subtotal - total,
    total,
    count: cart.count,
  };
}
