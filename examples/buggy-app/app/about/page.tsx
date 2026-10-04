import Link from "next/link";

export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1>About Gadgetly</h1>
      <img src="/images/team-photo.jpg" alt="The Gadgetly team at our first pop-up shop" width={720} height={360} style={{ width: "100%", height: "auto", borderRadius: 12 }} />
      <p>
        Gadgetly started in 2019 as a weekend market stall selling refurbished headphones. Today we&apos;re a small team of
        gadget nerds who test everything we sell, so you don&apos;t have to.
      </p>
      <p>
        Every product ships within two business days, and you can return anything within 30 days. Questions? Email us at
        hello@gadgetly.test.
      </p>
      <p>
        <Link href="/products">Start shopping →</Link>
      </p>
    </div>
  );
}
