import { randomBytes } from "node:crypto";
import { store } from "./store";
import type { Cart, Coupon, Order, Product, Review, User } from "./types";

/** Simulated database round trip. */
function roundTrip(min = 5, max = 15): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}

export const db = {
  async listProducts(): Promise<Product[]> {
    await roundTrip();
    return store.products.map((p) => ({ ...p }));
  },

  async getProduct(id: string): Promise<Product | null> {
    await roundTrip();
    const p = store.products.find((x) => x.id === id);
    return p ? { ...p } : null;
  },

  async reviewsFor(productId: string): Promise<Review[]> {
    await roundTrip();
    return store.reviews.filter((r) => r.productId === productId);
  },

  async allReviews(): Promise<Review[]> {
    await roundTrip();
    return [...store.reviews];
  },

  async stockFor(productId: string): Promise<number> {
    await roundTrip();
    return store.stock.get(productId) ?? 0;
  },

  async reserveStock(productId: string, quantity: number): Promise<void> {
    await roundTrip();
    store.stock.set(productId, (store.stock.get(productId) ?? 0) - quantity);
  },

  async findUserByEmail(email: string): Promise<User | null> {
    await roundTrip();
    const needle = email.toLowerCase();
    for (const u of store.users.values()) if (u.email.toLowerCase() === needle) return u;
    return null;
  },

  async getUser(id: string): Promise<User | null> {
    await roundTrip();
    return store.users.get(id) ?? null;
  },

  async createUser(user: User): Promise<User> {
    await roundTrip();
    store.users.set(user.id, user);
    return user;
  },

  async updateUser(id: string, patch: Partial<Pick<User, "displayName">>): Promise<User | null> {
    await roundTrip();
    const user = store.users.get(id);
    if (!user) return null;
    const updated = { ...user, ...patch };
    return updated;
  },

  async createSession(userId: string): Promise<string> {
    await roundTrip();
    const sid = randomBytes(24).toString("hex");
    store.sessions.set(sid, userId);
    return sid;
  },

  async sessionUserId(sid: string): Promise<string | null> {
    await roundTrip(1, 3);
    return store.sessions.get(sid) ?? null;
  },

  async deleteSession(sid: string): Promise<void> {
    await roundTrip();
    store.sessions.delete(sid);
  },

  async getCart(userId: string): Promise<Cart> {
    await roundTrip();
    let cart = store.carts.get(userId);
    if (!cart) {
      cart = { items: [], coupon: null, count: 0 };
      store.carts.set(userId, cart);
    }
    return cart;
  },

  async saveCart(userId: string, cart: Cart): Promise<void> {
    await roundTrip();
    store.carts.set(userId, cart);
  },

  async clearCart(userId: string): Promise<void> {
    await roundTrip();
    store.carts.set(userId, { items: [], coupon: null, count: 0 });
  },

  async activeCouponCodes(): Promise<string[]> {
    await roundTrip();
    return store.coupons.filter((c) => c.active).map((c) => c.code);
  },

  async getCoupon(code: string): Promise<Coupon> {
    await roundTrip();
    return store.coupons.find((c) => c.code === code) as Coupon;
  },

  async authorizePayment(amount: number): Promise<{ ok: boolean; reference: string }> {
    await roundTrip(300, 600);
    return { ok: amount >= 0, reference: `pay_${randomBytes(6).toString("hex")}` };
  },

  async nextOrderId(): Promise<string> {
    await roundTrip();
    return String(store.nextOrderId++);
  },

  async insertOrder(order: Order): Promise<void> {
    await roundTrip();
    store.orders.push(order);
  },

  async ordersFor(userId: string): Promise<Order[]> {
    await roundTrip();
    return store.orders.filter((o) => o.userId === userId);
  },

  async getOrder(id: string): Promise<Order | null> {
    await roundTrip();
    return store.orders.find((o) => o.id === id) ?? null;
  },
};
