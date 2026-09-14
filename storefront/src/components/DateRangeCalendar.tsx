import type { CalendarDay } from '../lib/inventoryApi';
import { localIsoDate } from '../lib/dates';

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

export type DateRangeCalendarProps = {
  year: number;
  month: number;
  startsOn: string;
  endsOn: string;
  minDate?: string;
  days?: CalendarDay[];
  unitsTotal?: number;
  loading?: boolean;
  onShift: (delta: number) => void;
  onPick: (iso: string) => void;
  onHover?: (iso: string | null) => void;
  hoverDate?: string | null;
};

function monthIsoDays(year: number, month: number): string[] {
  const last = new Date(year, month, 0).getDate();
  return Array.from({ length: last }, (_, i) => localIsoDate(new Date(year, month - 1, i + 1)));
}

export default function DateRangeCalendar({
  year,
  month,
  startsOn,
  endsOn,
  minDate,
  days,
  unitsTotal = 0,
  loading = false,
  onShift,
  onPick,
  onHover,
  hoverDate = null,
}: DateRangeCalendarProps) {
  const pad = new Date(year, month - 1, 1).getDay();
  const isoDays = monthIsoDays(year, month);
  const byDate = new Map((days || []).map((d) => [d.date, d]));
  const rangeEnd = endsOn || hoverDate || startsOn;
  const previewEnd =
    !endsOn && hoverDate && startsOn && hoverDate >= startsOn ? hoverDate : rangeEnd;

  return (
    <div>
      <div className="calendar-head">
        <button type="button" onClick={() => onShift(-1)}>
          ←
        </button>
        <div className="calendar-title">
          {MONTHS[month - 1]} {year}
        </div>
        <button type="button" onClick={() => onShift(1)}>
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
      <div className="calendar-grid" onMouseLeave={() => onHover?.(null)}>
        {Array.from({ length: pad }, (_, i) => (
          <div className="day empty" key={`e${i}`} />
        ))}
        {loading
          ? null
          : isoDays.map((iso) => {
              const info = byDate.get(iso);
              const past = Boolean(minDate && iso < minDate);
              const inRange = Boolean(startsOn && previewEnd && iso >= startsOn && iso <= previewEnd);
              const isStart = iso === startsOn;
              const isEnd = Boolean(previewEnd) && iso === previewEnd && Boolean(startsOn);
              const classes = [
                'day',
                'selectable',
                past ? 'past' : '',
                inRange ? 'in-range' : '',
                isStart ? 'range-start' : '',
                isEnd ? 'range-end' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  type="button"
                  className={classes}
                  key={iso}
                  disabled={past}
                  onClick={() => onPick(iso)}
                  onMouseEnter={() => {
                    if (!past) onHover?.(iso);
                  }}
                >
                  <div className="num">{Number(iso.slice(8, 10))}</div>
                  {info ? (
                    <span className={`availability ${info.band}`}>
                      {info.available} of {unitsTotal}
                    </span>
                  ) : null}
                </button>
              );
            })}
      </div>
    </div>
  );
}
