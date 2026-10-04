import Link from "next/link";
import { currentUser } from "@/lib/session";
import { CartButton } from "./CartButton";

export async function Header() {
  const user = await currentUser();
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <img src="/logo.svg" alt="" width={28} height={28} />
          <span>Gadgetly</span>
        </Link>
        <nav className="main-nav" aria-label="Main">
          <Link href="/products">Shop</Link>
          {user ? <Link href="/orders">Orders</Link> : null}
          <Link href="/about">About</Link>
        </nav>
        <div className="header-actions">
          {user ? (
            <>
              <Link href="/account/settings" className="greeting">
                Hi, {user.displayName}
              </Link>
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="link-button">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup" className="button button-small">
                Sign up
              </Link>
            </>
          )}
          <CartButton />
        </div>
      </div>
    </header>
  );
}
