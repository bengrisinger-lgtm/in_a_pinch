import type { CartLine } from '../pages/CatalogPage';
import { formatUsd } from '../lib/dates';

type Props = {
  cart: CartLine[];
  startsOn: string;
  endsOn: string;
  nights: number;
  onClose: () => void;
  onRemove: (skuId: string) => void;
};

export default function CartDrawer({ cart, startsOn, endsOn, nights, onClose, onRemove }: Props) {
  const subtotal = cart.reduce((sum, line) => sum + line.dailyRate * line.quantity * nights, 0);
  const ttl = cart.find((l) => l.heldUntil)?.heldUntil;

  return (
    <div className="overlay open" onClick={onClose} role="presentation">
      <div
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="cart-title"
      >
        <button className="close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="eyebrow" style={{ color: 'var(--crab)' }}>
          Order
        </div>
        <h2 id="cart-title">Your In a Pinch AV order</h2>
        <div className="steps">
          <span className="step active">1. Order</span>
          <span className="step">2. Details</span>
          <span className="step">3. Agreement</span>
          <span className="step">4. Payment</span>
        </div>
        {cart.length === 0 ? <p className="muted">Cart is empty.</p> : null}
        {cart.map((line) => (
          <div className="cartitem" key={line.skuId}>
            <div>
              <strong>{line.name}</strong>
              <div className="muted">
                Qty {line.quantity} · {line.serials.join(', ')}
              </div>
              <div className="muted">
                {startsOn} → {endsOn} · {formatUsd(line.dailyRate * line.quantity * nights)}
              </div>
            </div>
            <button type="button" onClick={() => onRemove(line.skuId)}>
              Remove
            </button>
          </div>
        ))}
        <div className="summary">
          <div className="row">
            <span>Rental period</span>
            <span>
              {nights} day{nights === 1 ? '' : 's'}
            </span>
          </div>
          <div className="row total">
            <span>Subtotal</span>
            <span>{formatUsd(subtotal)}</span>
          </div>
          {ttl ? (
            <p className="muted">Holds expire around {new Date(ttl).toLocaleString()} (2-hour TTL).</p>
          ) : null}
          <p className="muted">
            Next slices: customer details, kit e-sign for the service agreement, then Square. No
            card number on this page.
          </p>
        </div>
      </div>
    </div>
  );
}
