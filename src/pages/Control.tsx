import { useMemo, useState } from 'react';
import type { DateBookingStatus, DateBookingStatusValue, Reservation } from '../types';
import { formatDisplayDate, getLocalDateString, normalizeDateForCompare } from '../utils/date';
import { isActiveReservation } from '../utils/reservationStatus';

interface ControlProps {
  dateBookingStatus: DateBookingStatus;
  reservations: Reservation[];
  totalCapacity: number;
  onDateBookingStatusChange: (date: string, status: DateBookingStatusValue) => void;
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
type ControlView = 'cards' | 'list';
const CONTROL_START_DATE_KEY = 'manager_control_start_date';
const CONTROL_VISIBLE_DAYS_KEY = 'manager_control_visible_days';
const CONTROL_VIEW_MODE_KEY = 'manager_control_view_mode';

function addDays(date: string, days: number) {
  const baseDate = new Date(`${date}T12:00:00`);
  baseDate.setDate(baseDate.getDate() + days);
  return baseDate.toISOString().slice(0, 10);
}

function getDayName(date: string) {
  return DAY_NAMES[new Date(`${date}T12:00:00`).getDay()];
}

export function Control({ dateBookingStatus, reservations, totalCapacity, onDateBookingStatusChange }: ControlProps) {
  const [rangeStart, setRangeStart] = useState(() => localStorage.getItem(CONTROL_START_DATE_KEY) ?? getLocalDateString(new Date()));
  const [rangeDays, setRangeDays] = useState(() => Number(localStorage.getItem(CONTROL_VISIBLE_DAYS_KEY) ?? 7));
  const [view, setView] = useState<ControlView>(() => {
    const stored = localStorage.getItem(CONTROL_VIEW_MODE_KEY);
    return stored === 'cards' ? 'cards' : 'list';
  });
  const cards = useMemo(
    () =>
      Array.from({ length: rangeDays }, (_, index) => addDays(rangeStart, index)).map((date) => {
        const pax = reservations
          .filter((reservation) => normalizeDateForCompare(reservation.date) === date && isActiveReservation(reservation))
          .reduce((total, reservation) => total + reservation.pax, 0);
        return {
          date,
          dayName: getDayName(date),
          pax,
          occupancy: Math.min(100, Math.round((pax / totalCapacity) * 100)),
          fullyBooked: dateBookingStatus[date] === 'fully_booked',
        };
      }),
    [dateBookingStatus, totalCapacity, rangeDays, rangeStart, reservations],
  );

  function updateDateBookingStatus(date: string, status: boolean) {
    onDateBookingStatusChange(date, status ? 'fully_booked' : 'open');
    // Future Make integration: updateDateBookingStatus(date, status)
  }

  function updateRangeStart(date: string) {
    setRangeStart(date);
    localStorage.setItem(CONTROL_START_DATE_KEY, date);
  }

  function updateRangeDays(days: number) {
    const nextDays = Math.max(7, days);
    setRangeDays(nextDays);
    localStorage.setItem(CONTROL_VISIBLE_DAYS_KEY, String(nextDays));
  }

  function updateView(nextView: ControlView) {
    setView(nextView);
    localStorage.setItem(CONTROL_VIEW_MODE_KEY, nextView);
  }

  return (
    <main className="app-shell">
      <PageHeader eyebrow="CONTROL RESERVAS" title="CONTROL" />

      <section className="toolbar-card control-toolbar">
        <label>
          Fecha inicio
          <input type="date" value={rangeStart} onChange={(event) => updateRangeStart(event.target.value)} />
        </label>
        <label>
          Dias visibles
          <input min="7" max="31" type="number" value={rangeDays} onChange={(event) => updateRangeDays(Number(event.target.value))} />
        </label>
        <div className="segmented-control" aria-label="Vista control">
          <button className={view === 'cards' ? 'is-active' : ''} type="button" onClick={() => updateView('cards')}>
            Tarjetas
          </button>
          <button className={view === 'list' ? 'is-active' : ''} type="button" onClick={() => updateView('list')}>
            Lista
          </button>
        </div>
      </section>

      {view === 'cards' ? (
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
      ) : (
        <section className="table-section">
          <div className="table-wrap">
            <table className="reservations-table control-list-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Dia semana</th>
                  <th>Pax</th>
                  <th>Ocupacion</th>
                  <th>Estado</th>
                  <th>Fully booked</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr key={card.date}>
                    <td data-label="Fecha">{formatDisplayDate(card.date)}</td>
                    <td data-label="Dia semana">{card.dayName}</td>
                    <td data-label="Pax">{card.pax}</td>
                    <td data-label="Ocupacion">{card.occupancy}%</td>
                    <td data-label="Estado">
                      <span className={`status-pill ${card.fullyBooked ? 'is-cancelada' : ''}`}>
                        {card.fullyBooked ? 'FULLY BOOKED' : 'ABIERTO'}
                      </span>
                    </td>
                    <td data-label="Fully booked">
                      <button
                        className={`compact-toggle ${card.fullyBooked ? 'is-closed' : 'is-open'}`}
                        type="button"
                        onClick={() => updateDateBookingStatus(card.date, !card.fullyBooked)}
                      >
                        <span>{card.fullyBooked ? 'ON' : 'OFF'}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function PageHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <section className="top-bar">
      <div className="brand-lockup">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
      </div>
    </section>
  );
}
