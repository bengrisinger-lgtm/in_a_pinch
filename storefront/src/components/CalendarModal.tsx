import { useEffect, useState } from 'react';
import type { Sku } from '../lib/inventoryApi';
import { InventoryApiError, loadCalendar, type CalendarDay } from '../lib/inventoryApi';
import { billingDays, formatPrettyDate, formatPrettyTime, localIsoDate } from '../lib/dates';
import DateRangeCalendar from './DateRangeCalendar';

type Props = {
  sku?: Sku | null;
  startsOn: string;
  endsOn: string;
  loadIn: string;
  loadOut: string;
  onClose: () => void;
  onCommit: (startsOn: string, endsOn: string) => void;
  onPreview?: (startsOn: string, endsOn: string) => void;
};

export default function CalendarModal({
  sku,
  startsOn,
  endsOn,
  loadIn,
  loadOut,
  onClose,
  onCommit,
  onPreview,
}: Props) {
  const initial = parseYearMonth(startsOn);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [unitsTotal, setUnitsTotal] = useState(sku?.units_total || 0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(sku));
  const [draftStart, setDraftStart] = useState(startsOn);
  const [draftEnd, setDraftEnd] = useState<string | null>(endsOn);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const today = localIsoDate();

  useEffect(() => {
    if (!sku) {
      setLoading(false);
      setDays([]);
      return;
    }
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
          setError('Could not load the calendar. Try again, or sign in as staff from the footer.');
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
  }, [sku, sku?.id, year, month]);

  function shift(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }

  function pick(iso: string) {
    if (iso < today) return;
    if (!draftStart || draftEnd) {
      setDraftStart(iso);
      setDraftEnd(null);
      onPreview?.(iso, iso);
      return;
    }
    if (iso < draftStart) {
      setDraftStart(iso);
      setDraftEnd(null);
      onPreview?.(iso, iso);
      return;
    }
    setDraftEnd(iso);
    onPreview?.(draftStart, iso);
    onCommit(draftStart, iso);
  }

  const nights =
    billingDays(draftStart, loadIn, draftEnd || draftStart, loadOut) ?? 1;

  return (
    <div className="overlay open" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="cal-title">
        <button className="close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="eyebrow" style={{ color: 'var(--crab)' }}>
          {sku ? 'Availability calendar' : 'Pickup and return'}
        </div>
        <h2 id="cal-title">{sku ? sku.name : 'Choose dates'}</h2>
        <p className="muted">
          Click load-in day, then load-out day. Charge is by the 24-hour clock — Friday 3:00 p.m.
          to Saturday 2:00 p.m. is one day. {formatPrettyDate(draftStart)} {formatPrettyTime(loadIn)}
          {draftEnd ? ` → ${formatPrettyDate(draftEnd)} ${formatPrettyTime(loadOut)}` : ''}
          {' · '}
          {nights} day{nights === 1 ? '' : 's'}.
        </p>
        {sku ? (
          <p className="muted">
            Plenty / limited / fully booked from live serial reservations. {unitsTotal} unit
            {unitsTotal === 1 ? '' : 's'} in stock.
          </p>
        ) : null}
        {error ? <p className="banner error">{error}</p> : null}
        <div className="calendar-wrap">
          <DateRangeCalendar
            year={year}
            month={month}
            startsOn={draftStart}
            endsOn={draftEnd || ''}
            minDate={today}
            days={sku ? days : undefined}
            unitsTotal={unitsTotal}
            loading={loading}
            hoverDate={hoverDate}
            onShift={shift}
            onPick={pick}
            onHover={(iso) => {
              setHoverDate(iso);
              if (draftStart && !draftEnd && iso && iso >= draftStart) {
                onPreview?.(draftStart, iso);
              }
            }}
          />
          <div>
            <div className="legend">
              <h4>{sku ? 'Availability' : 'How to pick'}</h4>
              {sku ? (
                <>
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
                </>
              ) : (
                <p>
                  First click is load-in day. Second click is load-out day. Times stay on the bar
                  above. One billed day is up to 24 hours.
                </p>
              )}
              <button
                className="btn orange"
                type="button"
                style={{ marginTop: 12 }}
                onClick={() => onCommit(draftStart, draftEnd || draftStart)}
              >
                Use these dates
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function parseYearMonth(iso: string): { year: number; month: number } {
  const [y, m] = iso.split('-').map(Number);
  if (y && m) return { year: y, month: m };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}
