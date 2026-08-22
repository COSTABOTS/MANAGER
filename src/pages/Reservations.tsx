import { useMemo, useState } from 'react';
import type { BookingService, Reservation } from '../types';
import { formatDisplayDate, getLocalDateString, normalizeDateForCompare } from '../utils/date';
import { isActiveReservation, isCanceledReservation } from '../utils/reservationStatus';

type ReservationFilter = 'today' | 'tomorrow' | 'week' | 'all';
type ServiceFilter = 'all' | 'cena' | 'balinesa' | 'desayuno' | 'almuerzo' | 'walkin';

interface ReservationsProps {
  reservations: Reservation[];
  onRefreshReservations: () => Promise<void>;
  isRefreshingReservations: boolean;
  lastUpdatedAt: string;
  onCancelReservation: (reservation: Reservation) => Promise<boolean>;
  onBalinesePayment: (id: string, paid: boolean) => Promise<void>;
}

function addDays(date: string, days: number) {
  const baseDate = new Date(`${date}T12:00:00`);
  baseDate.setDate(baseDate.getDate() + days);
  return baseDate.toISOString().slice(0, 10);
}

export function Reservations({ reservations, onRefreshReservations, isRefreshingReservations, lastUpdatedAt, onCancelReservation, onBalinesePayment }: ReservationsProps) {
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [filter, setFilter] = useState<ReservationFilter>('all');
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('all');
  const [showPastReservations, setShowPastReservations] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [paymentError, setPaymentError] = useState('');
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const today = getLocalDateString(new Date());
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);

  const filteredReservations = useMemo(() => {
    return reservations
      .filter((reservation) => {
        const service = getReservationService(reservation);
        const search = `${reservation.name} ${reservation.room} ${reservation.phone ?? ''} ${reservation.specialRequest} ${reservation.status} ${service}`.toLowerCase();
        const matchesQuery = search.includes(query.toLowerCase());
        const reservationDate = normalizeDateForCompare(reservation.date);
        const matchesDate = date ? reservationDate === date : true;
        const matchesService = matchesServiceFilter(reservation, serviceFilter);

        if (filter === 'today') {
          return matchesQuery && matchesDate && matchesService && reservationDate === today;
        }

        if (filter === 'tomorrow') {
          return matchesQuery && matchesDate && matchesService && reservationDate === tomorrow;
        }

        if (filter === 'week') {
          return matchesQuery && matchesDate && matchesService && reservationDate >= today && reservationDate <= weekEnd;
        }

        return matchesQuery && matchesDate && matchesService;
      })
      .sort((a, b) => `${normalizeDateForCompare(a.date)} ${a.time}`.localeCompare(`${normalizeDateForCompare(b.date)} ${b.time}`));
  }, [date, filter, query, reservations, serviceFilter, today, tomorrow, weekEnd]);

  const upcomingReservations = useMemo(
    () => filteredReservations.filter((reservation) => !isPastReservation(reservation, today)),
    [filteredReservations, today],
  );

  const pastReservations = useMemo(
    () =>
      filteredReservations
        .filter((reservation) => isPastReservation(reservation, today))
        .sort((a, b) => `${normalizeDateForCompare(b.date)} ${b.time}`.localeCompare(`${normalizeDateForCompare(a.date)} ${a.time}`)),
    [filteredReservations, today],
  );

  const visibleReservations = showPastReservations ? [...upcomingReservations, ...pastReservations] : upcomingReservations;

  return (
    <main className="app-shell">
      <PageHeader eyebrow="Libro completo" title="RESERVAS" />

      <section className="toolbar-card reservations-filter-toolbar">
        <label>
          Buscador
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, habitacion, estado..." />
        </label>
        <label>
          Filtro fecha
          <input value={date} onChange={(event) => setDate(event.target.value)} type="date" />
        </label>
        <label>
          Servicio
          <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value as ServiceFilter)}>
            <option value="all">Todos</option>
            <option value="cena">Cena / Restaurante</option>
            <option value="balinesa">Balinesas</option>
            <option value="desayuno">Desayuno</option>
            <option value="almuerzo">Almuerzo</option>
            <option value="walkin">Walk-in</option>
          </select>
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
          <div className="reservation-actions">
            <button className="secondary-button" type="button" disabled={isRefreshingReservations} onClick={() => void onRefreshReservations()}>
              Actualizar datos
            </button>
            <button className="secondary-button" type="button" onClick={() => setShowPastReservations((current) => !current)}>
              {showPastReservations ? 'Ocultar anteriores' : `Ver anteriores (${pastReservations.length})`}
            </button>
            <span className="reservation-count">{visibleReservations.length} registros</span>
            <span className="last-updated">Última actualización: {lastUpdatedAt || '--:--:--'}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="reservations-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Servicio</th>
                <th>Hora</th>
                <th>Nombre</th>
                <th>Habitacion</th>
                <th>Pax</th>
                <th>Pago</th>
                <th>Origen</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibleReservations.map((reservation) => {
                const pastReservation = isPastReservation(reservation, today);
                const canceledReservation = isCanceledReservation(reservation);
                const service = getReservationService(reservation);

                return (
                  <tr key={reservation.idReserva} className={getReservationRowClassName(canceledReservation, pastReservation, service)} onClick={() => setSelectedReservation(reservation)}>
                    <td data-label="Fecha">{formatDisplayDate(reservation.date)}</td>
                    <td data-label="Servicio">
                      <span className={`service-book-badge service-book-badge-${service.toLowerCase()}`}>{service}</span>
                    </td>
                    <td data-label="Hora">{reservation.time}</td>
                    <td data-label="Nombre">{reservation.name}</td>
                    <td data-label="Habitacion">{reservation.room || '-'}</td>
                    <td data-label="Pax">{reservation.pax}</td>
                    <td data-label="Pago"><span className={`reservation-payment-status ${reservation.balinesePaid ? 'is-paid' : 'is-pending'}`}>{service === 'BALINESA' ? (reservation.balinesePaid ? 'PAGADO' : 'NO PAGADO') : '—'}</span></td>
                    <td data-label="Origen">{getReservationOrigin(reservation.source)}</td>
                    <td data-label="Estado">
                      <span className={`status-pill is-${reservation.status.toLowerCase()}`}>{reservation.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {selectedReservation && (
        <div className="modal-backdrop" role="presentation" onPointerDown={() => !isSavingPayment && setSelectedReservation(null)}>
          <div className="show-modal reservation-detail-modal" role="dialog" aria-modal="true" onPointerDown={(event) => event.stopPropagation()}>
            <div className="section-title compact"><div><p className="eyebrow">{selectedReservation.service === 'BALINESA' ? 'Detalle de balinesa' : 'Detalle de reserva'}</p><h2>{selectedReservation.name || selectedReservation.room || selectedReservation.service}</h2></div><button className="icon-button" type="button" onClick={() => setSelectedReservation(null)} aria-label="Cerrar">×</button></div>
            <div className="reservation-detail-grid"><span>Fecha: {formatDisplayDate(selectedReservation.date)}</span><span>Hora: {selectedReservation.time}</span><span>Nombre: {selectedReservation.name || '-'}</span><span>Habitación: {selectedReservation.room || '-'}</span><span>Teléfono: {selectedReservation.phone || '-'}</span><span>Pax: {selectedReservation.pax}</span><span>Petición: {selectedReservation.specialRequest || '-'}</span><span>Origen: {getReservationOrigin(selectedReservation.source)}</span><span>Estado: {selectedReservation.status}</span><span>Servicio: {selectedReservation.service}</span>{selectedReservation.service === 'BALINESA' && <><span>Paquete: {selectedReservation.balinesePackage || '-'}</span><span>Recurso: {selectedReservation.resource || '-'}</span></>}</div>
            {selectedReservation.service === 'BALINESA' && (isCanceledReservation(selectedReservation) ? <p className="muted-cell">Pago: {selectedReservation.balinesePaid ? 'PAGADO' : 'NO PAGADO'}</p> : <button className={`balinese-paid-badge ${selectedReservation.balinesePaid ? 'is-paid' : 'is-pending'}`} type="button" disabled={isSavingPayment} onClick={async () => { const previous = selectedReservation.balinesePaid === true; const next = !previous; setIsSavingPayment(true); setPaymentError(''); setSelectedReservation({ ...selectedReservation, balinesePaid: next }); try { await onBalinesePayment(selectedReservation.id, next); } catch (error) { setSelectedReservation({ ...selectedReservation, balinesePaid: previous }); setPaymentError(error instanceof Error ? error.message : 'No se pudo guardar el pago'); } finally { setIsSavingPayment(false); } }}>{selectedReservation.balinesePaid ? '● PAGADO' : 'NO PAGADO'}</button>)}
            {canCancelReservation(selectedReservation, today) && <button className="danger-button compact-action" type="button" onClick={async () => { const cancelled = await onCancelReservation(selectedReservation); if (cancelled) setSelectedReservation(null); }}>Cancelar reserva</button>}
            {paymentError && <p className="form-error">{paymentError}</p>}
          </div>
        </div>
      )}
    </main>
  );
}

function isPastReservation(reservation: Reservation, today: string) {
  return normalizeDateForCompare(reservation.date) < today;
}

function canCancelReservation(reservation: Reservation, today: string) {
  return isActiveReservation(reservation) && !isPastReservation(reservation, today) && Boolean(reservation.idReserva);
}

function getReservationService(reservation: Reservation): BookingService {
  const service = String(reservation.service ?? '').trim().toUpperCase();
  if (service === 'DESAYUNO' || service === 'ALMUERZO' || service === 'BALINESA') {
    return service;
  }

  return 'CENA';
}

function matchesServiceFilter(reservation: Reservation, filter: ServiceFilter) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'walkin') {
    return reservation.source === 'WALKIN';
  }

  const service = getReservationService(reservation).toLowerCase();
  return service === filter;
}

function getReservationRowClassName(isCanceled: boolean, isPast: boolean, service: BookingService) {
  return [
    'reservation-row',
    isCanceled ? 'is-cancelada' : '',
    isPast ? 'is-past' : '',
    !isCanceled && !isPast ? `service-${service.toLowerCase()}` : '',
  ]
    .filter(Boolean)
    .join(' ');
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
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
      </div>
    </section>
  );
}
