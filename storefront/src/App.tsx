import { useCallback, useEffect, useRef, useState } from 'react';

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

import StillShoppingModal from './components/StillShoppingModal';

import SessionIdleModal from './components/SessionIdleModal';

import { useSessionIdle } from './hooks/useSessionIdle';

import SiteFooter from './components/SiteFooter';

import { billingDays } from './lib/dates';

import {

  earliestHeldUntilMs,

  expireDelayMs,

  stillShoppingDelayMs,

} from './lib/cartHoldIdle.js';

import { cancelHold, extendHolds } from './lib/inventoryApi';

import { refreshCartAvailability } from './lib/cartAvailability';

import { clearStickyCart, loadStickyCart, saveStickyCart } from './lib/cartPersistence';

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

  const [checkoutLocked, setCheckoutLocked] = useState(false);

  const [stillShopping, setStillShopping] = useState(false);

  const [keepingHold, setKeepingHold] = useState(false);

  const sessionIdle = useSessionIdle(Boolean(user) && !consumer, consumer);
  const stickyHydrated = useRef(false);

  function bumpCatalog() {

    setCatalogEpoch((n) => n + 1);

  }



  const syncAvailability = useCallback(async (lines: CartLine[]) => {

    if (!lines.length || checkoutLocked) return lines;

    try {

      return await refreshCartAvailability(lines);

    } catch {

      return lines;

    }

  }, [checkoutLocked]);



  useEffect(() => {

    const refresh = () => bumpCatalog();

    window.addEventListener('iap-catalog-refresh', refresh);

    return () => {

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

    if (loading || !user || checkoutLocked || stickyHydrated.current) return;

    stickyHydrated.current = true;

    const stored = loadStickyCart();

    if (!stored.length) return;

    let cancelled = false;

    void (async () => {

      const synced = await syncAvailability(stored);

      if (!cancelled) setCart(synced);

    })();

    return () => {

      cancelled = true;

    };

  }, [loading, user, checkoutLocked, syncAvailability]);



  useEffect(() => {

    if (checkoutLocked) return;

    saveStickyCart(cart);

  }, [cart, checkoutLocked]);



  useEffect(() => {

    if (!cart.length || checkoutLocked) return;

    let cancelled = false;

    void (async () => {

      const synced = await syncAvailability(cart);

      if (!cancelled) {

        setCart((prev) => {

          const changed = synced.some(

            (line, i) => line.unavailable !== prev[i]?.unavailable

          );

          return changed ? synced : prev;

        });

      }

    })();

    return () => {

      cancelled = true;

    };

  }, [cart.length, catalogEpoch, checkoutLocked, syncAvailability]);



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



  async function releaseHoldsKeepCart() {

    const ids = cart.flatMap((line) => line.holdIds);

    await Promise.allSettled(ids.map((id) => cancelHold(id)));

    const stripped = cart.map((line) => ({

      ...line,

      holdIds: [],

      heldUntil: null,

      serials: [],

    }));

    const synced = await syncAvailability(stripped);

    setCart(synced);

    setStillShopping(false);

    bumpCatalog();

  }



  useEffect(() => {

    if (checkoutLocked || cart.length === 0) {

      setStillShopping(false);

      return;

    }

    const expiry = earliestHeldUntilMs(cart);

    if (expiry == null) return;

    const warnIn = stillShoppingDelayMs(expiry) ?? 0;

    const expireIn = expireDelayMs(expiry) ?? 0;

    const warnT = window.setTimeout(() => setStillShopping(true), Math.max(0, warnIn));

    const expT = window.setTimeout(() => {

      void releaseHoldsKeepCart();

    }, Math.max(0, expireIn));

    return () => {

      window.clearTimeout(warnT);

      window.clearTimeout(expT);

    };

  }, [cart, checkoutLocked]);



  async function keepShopping() {

    const ids = cart.flatMap((line) => line.holdIds);

    if (!ids.length) {

      setStillShopping(false);

      return;

    }

    setKeepingHold(true);

    try {

      const data = await extendHolds(ids);

      const byId = new Map(data.holds.map((h) => [h.id, h.held_until]));

      setCart((prev) =>

        prev.map((line) => ({

          ...line,

          heldUntil: line.holdIds.reduce((acc, id) => byId.get(id) || acc, line.heldUntil),

        }))

      );

      setStillShopping(false);

    } catch {

      await releaseHoldsKeepCart();

    } finally {

      setKeepingHold(false);

    }

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

          <a className="wordmark" href={staffTools ? '#home' : '#rentals'}>

            <img className="nav-logo" src="/iap-logo-badge.png" alt="In A Pinch AV" />

          </a>

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

            {catalogView || cartCount > 0 ? (

              <button className="cartpill" type="button" onClick={() => setCartOpen(true)}>

                Order • {cartCount}

              </button>

            ) : null}

          </nav>

          {consumer ? (

            <a className="staff-nav-link" href={staffLoginHref(staffHubHref())}>

              Staff

            </a>

          ) : null}

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

          setCart={setCart}

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

            void releaseHoldsKeepCart();

          }}

          onCheckoutStarted={() => setCheckoutLocked(true)}

          onOrderCancelled={() => {

            setCart([]);

            clearStickyCart();

            setCartOpen(false);

            setCheckoutLocked(false);

            setStillShopping(false);

            bumpCatalog();

            window.location.hash = '#rentals';

          }}

        />

      ) : null}

      {stillShopping ? (

        <StillShoppingModal busy={keepingHold} onContinue={() => void keepShopping()} />

      ) : null}

      {sessionIdle.warningOpen ? (

        <SessionIdleModal

          secondsLeft={sessionIdle.secondsLeft}

          busy={sessionIdle.busy}

          onContinue={() => void sessionIdle.onContinue()}

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


