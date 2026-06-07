import { useMemo, useState } from 'react';
import type { Reservation } from '../types';
import { formatDisplayDate, getLocalDateString, normalizeDateForCompare } from '../utils/date';
import { isCanceledReservation } from '../utils/reservationStatus';

type ReservationFilter = 'today' | 'tomorrow' | 'week' | 'all';

interface ReservationsProps {
  reservations: Reservation[];
}

function addDays(date: string, days: number) {
  const baseDate = new Date(`${date}T12:00:00`);
  baseDate.setDate(baseDate.getDate() + days);
  return baseDate.toISOString().slice(0, 10);
}

export function Reservations({ reservations }: ReservationsProps) {
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [filter, setFilter] = useState<ReservationFilter>('all');
  const today = getLocalDateString(new Date());
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);

  const visibleReservations = useMemo(() => {
    return reservations
      .filter((reservation) => {
        const search = `${reservation.name} ${reservation.room} ${reservation.phone ?? ''} ${reservation.specialRequest} ${reservation.status}`.toLowerCase();
        const matchesQuery = search.includes(query.toLowerCase());
        const reservationDate = normalizeDateForCompare(reservation.date);
        const matchesDate = date ? reservationDate === date : true;

        if (filter === 'today') {
          return matchesQuery && matchesDate && reservationDate === today;
        }

        if (filter === 'tomorrow') {
          return matchesQuery && matchesDate && reservationDate === tomorrow;
        }

        if (filter === 'week') {
          return matchesQuery && matchesDate && reservationDate >= today && reservationDate <= weekEnd;
        }

        return matchesQuery && matchesDate;
      })
      .sort((a, b) => `${normalizeDateForCompare(a.date)} ${a.time}`.localeCompare(`${normalizeDateForCompare(b.date)} ${b.time}`));
  }, [date, filter, query, reservations, today, tomorrow, weekEnd]);

  return (
    <main className="app-shell">
      <PageHeader eyebrow="Libro completo" title="RESERVAS" />

      <section className="toolbar-card">
        <label>
          Buscador
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, habitacion, estado..." />
        </label>
        <label>
          Filtro fecha
          <input value={date} onChange={(event) => setDate(event.target.value)} type="date" />
        </label>
        <div className="segmented-control" aria-label="Filtro rapido">
          {[
            ['today', 'Hoy'],
            ['tomorrow', 'Mañana'],
            ['week', 'Semana'],
            ['all', 'Todas'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={filter === key ? 'is-active' : ''}
              type="button"
              onClick={() => setFilter(key as ReservationFilter)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="table-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">Preparado para edicion futura</p>
            <h2>Libro de reservas</h2>
          </div>
          <span className="reservation-count">{visibleReservations.length} registros</span>
        </div>
        <div className="table-wrap">
          <table className="reservations-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Nombre</th>
                <th>Habitacion</th>
                <th>Telefono</th>
                <th>Pax</th>
                <th>Peticion especial</th>
                <th>Origen</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibleReservations.map((reservation) => (
                <tr key={reservation.id} className={isCanceledReservation(reservation) ? 'reservation-row is-cancelada' : 'reservation-row'}>
                  <td data-label="Fecha">{formatDisplayDate(reservation.date)}</td>
                  <td data-label="Hora">{reservation.time}</td>
                  <td data-label="Nombre">{reservation.name}</td>
                  <td data-label="Habitacion">{reservation.room || '-'}</td>
                  <td data-label="Telefono">{reservation.phone || '-'}</td>
                  <td data-label="Pax">{reservation.pax}</td>
                  <td data-label="Peticion especial">{reservation.specialRequest}</td>
                  <td data-label="Origen">{getReservationOrigin(reservation.source)}</td>
                  <td data-label="Estado">
                    <span className={`status-pill is-${reservation.status.toLowerCase()}`}>{reservation.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function getReservationOrigin(source: Reservation['source']) {
  if (source === 'WALKIN') {
    return 'WALK-IN';
  }

  if (source === 'MANUAL') {
    return 'MANUAL';
  }

  return 'BOT';
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
