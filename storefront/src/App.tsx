import { useEffect, useState } from 'react';
import type { CurrentUser } from './lib/kit';
import {
  ensureStorefrontSession,
  isConsumerSurface,
  isStaffUser,
  kit,
  redirectToLogin,
  staffHubHref,
  staffLoginHref,
} from './lib/kit';
import { tenantConsoleHref } from './lib/consoleHref';
import CartDrawer from './components/CartDrawer';
import SiteFooter from './components/SiteFooter';
import { billingDays } from './lib/dates';
import { cancelHold } from './lib/inventoryApi';
import CatalogPage, { type CartLine } from './pages/CatalogPage';
import HubHome from './pages/HubHome';
import OrdersPage from './pages/OrdersPage';
import StockPage from './pages/StockPage';

type View = 'home' | 'catalog' | 'stock' | 'orders';

export default function App() {
  const consumer = isConsumerSurface();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(hashView());
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const [sessionError, setSessionError] = useState<string | null>(null);

  function bumpCatalog() {
    setCatalogEpoch((n) => n + 1);
  }

  useEffect(() => {
    const open = () => setCartOpen(true);
    const refresh = () => bumpCatalog();
    window.addEventListener('iap-open-cart', open);
    window.addEventListener('iap-catalog-refresh', refresh);
    return () => {
      window.removeEventListener('iap-open-cart', open);
      window.removeEventListener('iap-catalog-refresh', refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (isConsumerSurface()) {
          const current = await ensureStorefrontSession();
          if (cancelled) return;
          setUser(current);
          if (!current) {
            setSessionError('Rentals are unavailable right now. Staff can sign in from the footer.');
          }
        } else {
          const current = await kit().auth.getCurrentUser();
          if (cancelled) return;
          if (!isStaffUser(current)) {
            redirectToLogin();
            return;
          }
          setUser(current);
        }
      } catch {
        if (cancelled) return;
        if (isConsumerSurface()) {
          setUser(null);
          setSessionError('Rentals are unavailable right now. Staff can sign in from the footer.');
        } else {
          redirectToLogin();
          return;
        }
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

  const staffTools = isStaffUser(user) && !consumer;

  useEffect(() => {
    if (loading || staffTools || consumer) return;
    if (view === 'home' || view === 'stock' || view === 'orders') {
      window.location.hash = '#rentals';
    }
  }, [loading, staffTools, consumer, view]);

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
    bumpCatalog();
  }

  if (loading) {
    return (
      <div className={consumer ? 'app-shell consumer-shell' : 'app-shell'}>
        <div className="gate">
          <p>{consumer ? 'Loading rentals…' : 'Loading hub…'}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={consumer ? 'app-shell consumer-shell' : 'app-shell'}>
        <div className="gate">
          <p>{sessionError || 'Rentals are unavailable right now.'}</p>
        </div>
        <SiteFooter staff={false} consumer={consumer} />
      </div>
    );
  }

  const cartCount = cart.reduce((n, line) => n + line.quantity, 0);
  const catalogView = consumer || !staffTools || view === 'catalog';

  return (
    <div className={consumer ? 'app-shell consumer-shell' : 'app-shell'}>
      <header>
        <div className="nav">
          {consumer ? (
            <a className="wordmark" href="#rentals">
              <img className="nav-logo" src="/pinch-logo.png" alt="In A Pinch AV" />
            </a>
          ) : (
            <a className="wordmark" href={staffTools ? '#home' : '#rentals'}>
              In a Pinch AV
            </a>
          )}
          <nav>
            {staffTools ? <a href="#home">Hub</a> : null}
            <a href="#rentals">Rentals</a>
            {consumer ? <a href="#services">Services</a> : null}
            {consumer ? <a href="#contact">Contact</a> : null}
            {staffTools ? <a href="#orders">Orders</a> : null}
            {staffTools ? <a href="#stock">Stock</a> : null}
            {staffTools ? (
              <a href={tenantConsoleHref()} rel="noopener noreferrer">
                Vault
              </a>
            ) : null}
            {staffTools ? (
              <button className="linkish" type="button" onClick={onLogout}>
                Sign out
              </button>
            ) : null}
            {consumer ? (
              <a className="staff-nav-link" href={staffLoginHref(staffHubHref())}>
                Staff
              </a>
            ) : null}
            {catalogView || cartCount > 0 ? (
              <button className="cartpill" type="button" onClick={() => setCartOpen(true)}>
                Order • {cartCount}
              </button>
            ) : null}
          </nav>
        </div>
      </header>
      {staffTools && view === 'home' ? <HubHome email={user.email} /> : null}
      {staffTools && view === 'stock' ? <StockPage email={user.email} /> : null}
      {staffTools && view === 'orders' ? <OrdersPage email={user.email} /> : null}
      <div hidden={staffTools && view !== 'catalog'}>
        <CatalogPage
          email={user.email}
          staff={staffTools}
          consumer={consumer}
          cart={cart}
          setCart={setCart}
          catalogEpoch={catalogEpoch}
        />
      </div>
      {cartOpen ? (
        <CartDrawer
          cart={cart}
          isStaff={staffTools}
          startsOn={cart[0]?.startsOn || ''}
          endsOn={cart[0]?.endsOn || ''}
          loadIn={cart[0]?.loadIn || ''}
          loadOut={cart[0]?.loadOut || ''}
          nights={
            cart[0]
              ? billingDays(cart[0].startsOn, cart[0].loadIn, cart[0].endsOn, cart[0].loadOut) || 1
              : 1
          }
          onClose={() => setCartOpen(false)}
          onRemove={removeLine}
          onReleaseAll={() => {
            const ids = cart.flatMap((line) => line.holdIds);
            void (async () => {
              await Promise.allSettled(ids.map((id) => cancelHold(id)));
              setCart([]);
              setCartOpen(false);
              bumpCatalog();
            })();
          }}
          onOrderCancelled={() => {
            setCart([]);
            setCartOpen(false);
            bumpCatalog();
            window.location.hash = '#rentals';
          }}
        />
      ) : null}
      <SiteFooter staff={staffTools} consumer={consumer} />
    </div>
  );
}

function hashView(): View {
  const hash = window.location.hash.replace(/^#/, '').split('?')[0];
  if (hash === 'stock') return 'stock';
  if (hash === 'orders') return 'orders';
  if (hash === 'catalog' || hash === 'rentals') return 'catalog';
  return 'home';
}
