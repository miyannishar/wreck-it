export type Product = {
  id: string;
  name: string;
  category: string;
  price: number; // cents
  description: string;
  image: string;
};

export type ProductSummary = Product & {
  stock: number;
  reviewCount: number;
  rating?: number;
};

export type Review = {
  id: string;
  productId: string;
  author: string;
  rating: number;
  body: string;
};

export type User = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
};

export type PublicUser = Pick<User, "id" | "email" | "displayName">;

export type Coupon = { code: string; percent: number; active: boolean };

export type CartItem = { productId: string; name: string; price: number; quantity: number };

export type Cart = {
  items: CartItem[];
  coupon: { code: string; percent: number } | null;
  count: number;
};

export type OrderItem = CartItem;

export type Order = {
  id: string;
  userId: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string | null;
  address: string;
  phone: string;
  status: "placed" | "shipped" | "delivered";
  createdAt: string;
};
