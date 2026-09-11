import { useEffect, useState } from 'react';
import type { Sku } from '../lib/inventoryApi';
import { InventoryApiError, loadCalendar, type CalendarDay } from '../lib/inventoryApi';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

type Props = {
  sku: Sku;
  onClose: () => void;
};

export default function CalendarModal({ sku, onClose }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [unitsTotal, setUnitsTotal] = useState(sku.units_total || 0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await loadCalendar(sku.id, year, month);
        if (cancelled) return;
        setDays(data.days);
        setUnitsTotal(data.units_total);
      } catch (err) {
        if (cancelled) return;
        setDays([]);
        if (err instanceof InventoryApiError && err.status === 401) {
          setError('Calendar 401 until gateway HMAC cutover.');
        } else {
          setError(err instanceof Error ? err.message : 'Calendar failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sku.id, year, month]);

  function shift(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }

  const pad = new Date(year, month - 1, 1).getDay();

  return (
    <div className="overlay open" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="cal-title">
        <button className="close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="eyebrow" style={{ color: 'var(--crab)' }}>
          Availability Calendar
        </div>
        <h2 id="cal-title">{sku.name}</h2>
        <p className="muted">
          Plenty / limited / fully booked from live serial reservations. {unitsTotal} unit
          {unitsTotal === 1 ? '' : 's'} in stock.
        </p>
        {error ? <p className="banner error">{error}</p> : null}
        <div className="calendar-wrap">
          <div>
            <div className="calendar-head">
              <button type="button" onClick={() => shift(-1)}>
                ←
              </button>
              <div className="calendar-title">
                {MONTHS[month - 1]} {year}
              </div>
              <button type="button" onClick={() => shift(1)}>
                →
              </button>
            </div>
            <div className="weekdays">
              <div>Sun</div>
              <div>Mon</div>
              <div>Tue</div>
              <div>Wed</div>
              <div>Thu</div>
              <div>Fri</div>
              <div>Sat</div>
            </div>
            <div className="calendar-grid">
              {Array.from({ length: pad }, (_, i) => (
                <div className="day empty" key={`e${i}`} />
              ))}
              {loading
                ? null
                : days.map((day) => (
                    <div className="day" key={day.date}>
                      <div className="num">{Number(day.date.slice(8, 10))}</div>
                      <span className={`availability ${day.band}`}>
                        {day.available} of {unitsTotal}
                      </span>
                    </div>
                  ))}
            </div>
          </div>
          <div>
            <div className="legend">
              <h4>Availability</h4>
              <div className="legend-item">
                <span className="dot good" /> Plenty available
              </div>
              <div className="legend-item">
                <span className="dot low" /> Limited quantity
              </div>
              <div className="legend-item">
                <span className="dot none" /> Fully booked
              </div>
              <p>
                If 4 speakers are owned and 2 are reserved, the day shows <b>2 of 4 available</b>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
