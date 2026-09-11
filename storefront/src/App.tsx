import { useEffect, useState } from 'react';
import type { CurrentUser } from './lib/kit';
import { kit, redirectToLogin } from './lib/kit';
import CartDrawer from './components/CartDrawer';
import { spanDays } from './lib/dates';
import { cancelHold } from './lib/inventoryApi';
import CatalogPage, { type CartLine } from './pages/CatalogPage';
import HubHome from './pages/HubHome';
import StockPage from './pages/StockPage';

type View = 'home' | 'catalog' | 'stock';

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(hashView());
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    const open = () => setCartOpen(true);
    window.addEventListener('iap-open-cart', open);
    return () => window.removeEventListener('iap-open-cart', open);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await kit().auth.getCurrentUser();
        if (cancelled) return;
        setUser(current);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onHash = () => setView(hashView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!loading && !user) redirectToLogin();
  }, [loading, user]);

  async function onLogout() {
    await kit().auth.logout();
    setUser(null);
    redirectToLogin();
  }

  async function removeLine(skuId: string) {
    const line = cart.find((l) => l.skuId === skuId);
    if (!line) return;
    await Promise.allSettled(line.holdIds.map((id) => cancelHold(id)));
    setCart((prev) => prev.filter((l) => l.skuId !== skuId));
  }

  if (loading) {
    return (
      <div className="gate">
        <p>Checking staff session…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="gate">
        <p>Redirecting to staff sign in…</p>
      </div>
    );
  }

  const cartCount = cart.reduce((n, line) => n + line.quantity, 0);

  return (
    <>
      <header>
        <div className="nav">
          <a className="wordmark" href="#home">
            In a Pinch AV
          </a>
          <nav>
            <a href="#home">Hub</a>
            <a href="#rentals">Rentals</a>
            <a href="#stock">Stock</a>
            <button className="linkish" type="button" onClick={onLogout}>
              Sign out
            </button>
            {view === 'catalog' || cartCount > 0 ? (
              <button className="cartpill" type="button" onClick={() => setCartOpen(true)}>
                Order • {cartCount}
              </button>
            ) : null}
          </nav>
        </div>
      </header>
      {view === 'home' ? (
        <HubHome email={user.email} />
      ) : view === 'stock' ? (
        <StockPage email={user.email} />
      ) : (
        <CatalogPage email={user.email} cart={cart} setCart={setCart} />
      )}
      {cartOpen ? (
        <CartDrawer
          cart={cart}
          startsOn={cart[0]?.startsOn || ''}
          endsOn={cart[0]?.endsOn || ''}
          nights={cart[0] ? spanDays(cart[0].startsOn, cart[0].endsOn) : 1}
          onClose={() => setCartOpen(false)}
          onRemove={removeLine}
        />
      ) : null}
    </>
  );
}

function hashView(): View {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === 'stock') return 'stock';
  if (hash === 'catalog' || hash === 'rentals') return 'catalog';
  return 'home';
}
