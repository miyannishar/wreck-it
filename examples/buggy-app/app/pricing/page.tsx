export const metadata = { title: "Shipping & pricing" };

export default function PricingPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Shipping &amp; pricing</h1>
      <p>All prices are in US dollars and include sales tax where applicable.</p>
      <ul>
        <li>Free standard shipping on orders over $50.</li>
        <li>Standard shipping (3–5 business days): $4.99.</li>
        <li>Express shipping (1–2 business days): $12.99.</li>
      </ul>
      <p>Coupon codes can be applied in your cart. One coupon per order.</p>
    </div>
  );
}
