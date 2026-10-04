import { hashPassword } from "./password";
import type { Cart, Coupon, Order, Product, Review, User } from "./types";

type Store = {
  products: Product[];
  reviews: Review[];
  stock: Map<string, number>;
  users: Map<string, User>;
  sessions: Map<string, string>;
  carts: Map<string, Cart>;
  orders: Order[];
  coupons: Coupon[];
  nextOrderId: number;
};

const CATALOG: Array<[string, string, number, string]> = [
  ["Aurora Wireless Earbuds", "audio", 7999, "True wireless earbuds with adaptive noise cancelling, six hours of playback and a pocket-sized charging case."],
  ["Pulse Over-Ear Headphones", "audio", 14999, "Plush over-ear headphones with forty hour battery life, multipoint pairing and a fold-flat design for travel."],
  ["Echo Mini Speaker", "audio", 4999, "Palm-sized bluetooth speaker with surprisingly deep bass, splash resistance and a built-in lanyard."],
  ["Studio Desk Microphone", "audio", 11999, "USB-C condenser microphone with cardioid pickup, zero-latency monitoring and a sturdy weighted stand."],
  ["Orbit Smartwatch", "wearables", 22999, "Always-on AMOLED smartwatch with heart rate, sleep tracking, GPS and a week of battery life."],
  ["Stride Fitness Band", "wearables", 5999, "Slim fitness band that counts steps, tracks workouts and nudges you to move every hour."],
  ["Lumen Smart Ring", "wearables", 27999, "Titanium smart ring that measures sleep stages, temperature trends and daily readiness."],
  ["Halo Sleep Mask", "wearables", 8999, "Contoured sleep mask with thin built-in speakers for white noise, podcasts and gentle wake-up alarms."],
  ["Nimbus Smart Bulb (4-pack)", "home", 3999, "Color smart bulbs with schedules, scenes and voice assistant support. No hub required."],
  ["Hearth Smart Thermostat", "home", 17999, "Learning thermostat that adapts to your routine and trims your heating bill automatically."],
  ["Sentinel Video Doorbell", "home", 12999, "1080p video doorbell with two-way talk, motion zones and local storage."],
  ["Breeze Air Purifier", "home", 15999, "Quiet HEPA air purifier for rooms up to 40 square meters with an air quality indicator ring."],
  ["Volt 65W GaN Charger", "accessories", 4499, "Compact gallium nitride charger with two USB-C ports and one USB-A port. Charges a laptop and phone together."],
  ["Coil Braided USB-C Cable", "accessories", 1499, "Two meter braided USB-C cable rated for 100W charging and 10Gbps data."],
  ["Dock Pro Hub", "accessories", 8999, "Eight-in-one USB-C hub with HDMI 4K, ethernet, SD card reader and pass-through charging."],
  ["Folio Tablet Stand", "accessories", 2999, "Aluminium tablet stand with adjustable angle and a non-slip base. Folds flat into a bag."],
  ["Snap Instant Camera", "cameras", 9999, "Instant film camera with auto exposure, selfie mirror and a built-in flash."],
  ["Vista Action Cam", "cameras", 24999, "Waterproof 4K action camera with horizon levelling and image stabilisation."],
  ["Prism Webcam 4K", "cameras", 13999, "4K webcam with auto framing, dual microphones and a privacy shutter."],
  ["Tripod Go", "cameras", 3499, "Lightweight travel tripod with a phone clamp, bluetooth remote and flexible legs."],
  ["Arcade Wireless Controller", "gaming", 6999, "Low-latency wireless controller with hall-effect sticks and swappable back paddles."],
  ["Quest Gaming Mouse", "gaming", 5499, "Ultralight gaming mouse with a 26K DPI sensor and ninety hours of wireless battery."],
  ["Forge Mechanical Keyboard", "gaming", 12999, "Hot-swappable mechanical keyboard with gasket mount, PBT keycaps and per-key lighting."],
  ["Nova Gaming Headset", "gaming", 9999, "Closed-back gaming headset with a detachable boom mic and spatial audio support."],
];

const NO_REVIEWS = new Set(["6", "13", "19", "24"]);

const AUTHORS = ["Priya", "Marcus", "Lena", "Tomás", "Aiko", "Jordan", "Fatima", "Ben", "Chloe", "Ravi", "Sofia", "Dmitri"];
const OPENERS = [
  "Bought this as a gift and ended up keeping it.",
  "Does exactly what it says on the box.",
  "Build quality feels premium for the price.",
  "Setup took less than five minutes.",
  "I was skeptical after reading other reviews but it won me over.",
  "Solid upgrade over my previous one.",
  "Shipping was quick and the packaging was minimal.",
];
const DETAILS = [
  "Battery life is better than advertised and it charges quickly.",
  "The companion app is a little clunky but works fine.",
  "Sound and build are great, though the instructions could be clearer.",
  "It runs a bit warm under heavy use but nothing worrying.",
  "Pairs instantly with my phone and laptop.",
  "Would love more color options, but the black one looks sharp.",
  "Customer support answered my question within a day.",
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function seed(): Store {
  const rand = mulberry32(20261003);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];

  const products: Product[] = CATALOG.map(([name, category, price, description], i) => ({
    id: String(i + 1),
    name,
    category,
    price,
    description,
    image: `/products/${category}.svg`,
  }));

  const reviews: Review[] = [];
  const stock = new Map<string, number>();
  for (const p of products) {
    stock.set(p.id, 5 + Math.floor(rand() * 60));
    if (NO_REVIEWS.has(p.id)) continue;
    const n = 12 + Math.floor(rand() * 25);
    for (let r = 0; r < n; r++) {
      reviews.push({
        id: `${p.id}-${r + 1}`,
        productId: p.id,
        author: pick(AUTHORS),
        rating: 3 + Math.floor(rand() * 3),
        body: `${pick(OPENERS)} ${pick(DETAILS)} ${pick(DETAILS)}`,
      });
    }
  }

  const { salt, hash } = hashPassword("gadgetly123");
  const demo: User = {
    id: "u1",
    email: "demo@gadgetly.test",
    displayName: "Demo Shopper",
    passwordHash: hash,
    salt,
    createdAt: daysAgo(60),
  };

  const orders: Order[] = [
    {
      id: "1001",
      userId: demo.id,
      items: [{ productId: "1", name: products[0].name, price: products[0].price, quantity: 1 }],
      subtotal: 7999,
      discount: 0,
      total: 7999,
      couponCode: null,
      address: "12 Elm Street, Springfield",
      phone: "555-0101",
      status: "delivered",
      createdAt: daysAgo(21),
    },
    {
      id: "1002",
      userId: demo.id,
      items: [
        { productId: "13", name: products[12].name, price: products[12].price, quantity: 1 },
        { productId: "14", name: products[13].name, price: products[13].price, quantity: 2 },
      ],
      subtotal: 7497,
      discount: 0,
      total: 7497,
      couponCode: null,
      address: "12 Elm Street, Springfield",
      phone: "555-0101",
      status: "shipped",
      createdAt: daysAgo(4),
    },
  ];

  return {
    products,
    reviews,
    stock,
    users: new Map([[demo.id, demo]]),
    sessions: new Map(),
    carts: new Map(),
    orders,
    coupons: [
      { code: "SAVE10", percent: 10, active: true },
      { code: "WELCOME5", percent: 5, active: true },
      { code: "SUMMER25", percent: 25, active: false },
    ],
    nextOrderId: 1003,
  };
}

const g = globalThis as typeof globalThis & { __gadgetlyStore?: Store };

export const store: Store = (g.__gadgetlyStore ??= seed());
