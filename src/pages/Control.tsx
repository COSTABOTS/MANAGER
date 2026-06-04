import { useMemo, useState } from 'react';
import type { Reservation } from '../types';
import { formatDisplayDate } from '../utils/date';

interface ControlProps {
  reservations: Reservation[];
  totalCapacity: number;
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

function addDays(date: string, days: number) {
  const baseDate = new Date(`${date}T12:00:00`);
  baseDate.setDate(baseDate.getDate() + days);
  return baseDate.toISOString().slice(0, 10);
}

function getDayName(date: string) {
  return DAY_NAMES[new Date(`${date}T12:00:00`).getDay()];
}

export function Control({ reservations, totalCapacity }: ControlProps) {
  const [rangeStart, setRangeStart] = useState('2026-06-04');
  const [rangeDays, setRangeDays] = useState(7);
  const [closedDates, setClosedDates] = useState<Set<string>>(new Set(['2026-06-05', '2026-12-31']));

  const cards = useMemo(
    () =>
      Array.from({ length: rangeDays }, (_, index) => addDays(rangeStart, index)).map((date) => {
        const pax = reservations
          .filter((reservation) => reservation.date === date && reservation.status === 'CONFIRMADA')
          .reduce((total, reservation) => total + reservation.pax, 0);
        return {
          date,
          dayName: getDayName(date),
          pax,
          occupancy: Math.min(100, Math.round((pax / totalCapacity) * 100)),
          fullyBooked: closedDates.has(date),
        };
      }),
    [closedDates, totalCapacity, rangeDays, rangeStart, reservations],
  );

  function updateDateBookingStatus(date: string, status: boolean) {
    setClosedDates((current) => {
      const next = new Set(current);
      if (status) {
        next.add(date);
      } else {
        next.delete(date);
      }
      return next;
    });
    // Future Make integration: updateDateBookingStatus(date, status)
  }

  return (
    <main className="app-shell">
      <PageHeader eyebrow="CONTROL RESERVAS" title="CONTROL" />

      <section className="toolbar-card control-toolbar">
        <label>
          Fecha inicio
          <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
        </label>
        <label>
          Dias visibles
          <input min="7" max="31" type="number" value={rangeDays} onChange={(event) => setRangeDays(Math.max(7, Number(event.target.value)))} />
        </label>
        <span className="reservation-count">Fully booked por fecha</span>
      </section>

      <section className="control-grid">
        {cards.map((card) => (
          <article key={card.date} className={`control-card ${card.fullyBooked ? 'is-closed' : ''}`}>
            <div className="control-card-header">
              <div>
                <p className="eyebrow">{card.dayName}</p>
                <h2>{formatDisplayDate(card.date)}</h2>
              </div>
              <span className={`status-pill ${card.fullyBooked ? 'is-cancelada' : ''}`}>
                {card.fullyBooked ? 'FULLY BOOKED' : 'ABIERTO'}
              </span>
            </div>
            <dl className="control-metrics">
              <div>
                <dt>PAX</dt>
                <dd>{card.pax}</dd>
              </div>
              <div>
                <dt>OCUPACION</dt>
                <dd>{card.occupancy}%</dd>
              </div>
            </dl>
            <button
              className={`compact-toggle ${card.fullyBooked ? 'is-closed' : 'is-open'}`}
              type="button"
              onClick={() => updateDateBookingStatus(card.date, !card.fullyBooked)}
            >
              <span>FULLY BOOKED</span>
              <strong>{card.fullyBooked ? 'ON' : 'OFF'}</strong>
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}

function PageHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <section className="top-bar">
      <div className="brand-lockup">
        <div className="logo-mark" aria-hidden="true">
          S
        </div>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
      </div>
    </section>
  );
}
