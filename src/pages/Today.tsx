import { Plus, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BookingStatusToggle } from '../components/BookingStatusToggle';
import { BrandLogo } from '../components/BrandLogo';
import { ReservationsTable } from '../components/ReservationsTable';
import { WalkInForm } from '../components/WalkInForm';
import { DEFAULT_COSTABOTS_LOGO, DEFAULT_RESTAURANT_LOGO, getRestaurantLogo } from '../config/branding';
import { getTodayData, hasTodayDataEndpoint } from '../services/api';
import type { TodayData } from '../services/api';
import type { BookingStatus, DayState, Reservation } from '../types';
import { formatDisplayDate, getCurrentTime } from '../utils/date';

interface TodayProps {
  dayStatus: DayState;
  lastSync: string;
  restaurantName: string;
  restaurantLogoUrl?: string;
  openingTime: string;
  closingTime: string;
  bookingInterval: 30 | 60;
  reservations: Reservation[];
  tableOptions: string[];
  totalPax: number;
  arrivals: number;
  occupancyPercent: number;
  totalCapacity: number;
  onAddWalkIn: (nameOrRoom: string, pax: number) => Promise<void>;
  onAddManualReservation: (reservation: Omit<Reservation, 'id' | 'status' | 'source' | 'table' | 'arrived'>) => void;
  onBookingStatus: () => void;
  onUpdateReservation: (id: string, field: 'table' | 'arrived', value: string | boolean) => Promise<void>;
}

const EMPTY_MANUAL_RESERVATION = {
  date: '',
  time: '',
  name: '',
  room: '',
  phone: '',
  pax: 2,
  specialRequest: '',
};

export function Today({
  dayStatus,
  lastSync,
  restaurantName,
  restaurantLogoUrl,
  openingTime,
  closingTime,
  bookingInterval,
  reservations,
  tableOptions,
  totalPax,
  occupancyPercent,
  totalCapacity,
  onAddWalkIn,
  onAddManualReservation,
  onBookingStatus,
  onUpdateReservation,
}: TodayProps) {
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [isLoadingToday, setIsLoadingToday] = useState(false);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualError, setManualError] = useState('');
  const [isToastVisible, setIsToastVisible] = useState(false);
  const timeSlots = useMemo(() => generateTimeSlots(openingTime, closingTime, bookingInterval), [bookingInterval, closingTime, openingTime]);
  const [manualDraft, setManualDraft] = useState({
    ...EMPTY_MANUAL_RESERVATION,
    date: dayStatus.date,
    time: timeSlots[0] ?? getCurrentTime(),
  });

  useEffect(() => {
    if (!hasTodayDataEndpoint()) {
      setIsLoadingToday(false);
      return;
    }

    let isMounted = true;

    async function loadTodayData() {
      setIsLoadingToday(true);
      setTodayError(null);

      try {
        const data = await getTodayData();
        if (isMounted) {
          setTodayData(data);
        }
      } catch (error) {
        if (isMounted) {
          setTodayError(error instanceof Error ? error.message : 'No se pudieron cargar los datos de hoy');
        }
      } finally {
        if (isMounted) {
          setIsLoadingToday(false);
        }
      }
    }

    void loadTodayData();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setManualDraft((current) => (timeSlots.includes(current.time) ? current : { ...current, time: timeSlots[0] ?? getCurrentTime() }));
  }, [timeSlots]);

  const apiReservations = useMemo<Reservation[]>(
    () =>
      (todayData?.reservations ?? []).map((reservation) => ({
        ...reservation,
        date: todayData?.date ?? dayStatus.date,
        source: 'WEB',
        status: (reservation.status === 'CANCELADA' ? 'CANCELADA' : 'CONFIRMADA') as BookingStatus,
      })),
    [dayStatus.date, todayData],
  );

  const displayReservations = todayData ? apiReservations : reservations;
  const displayDate = dayStatus.date;
  const displayBookingsOpen = todayData?.bookingsOpen ?? dayStatus.bookingsOpen;
  const displayTotalPax = todayData?.totalPax ?? totalPax;
  const displayCapacity = todayData?.capacity ?? totalCapacity;
  const displayOccupancyPercent = todayData
    ? Math.min(100, Math.round((displayTotalPax / displayCapacity) * 100))
    : occupancyPercent;
  const syncLabel = isLoadingToday ? 'Cargando datos de HOY...' : todayError ? `Error: ${todayError}` : lastSync;

  useEffect(() => {
    if (!syncLabel) {
      setIsToastVisible(false);
      return;
    }

    setIsToastVisible(true);
    const timeoutId = window.setTimeout(() => setIsToastVisible(false), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [syncLabel]);

  function updateManualDraft<T extends keyof typeof manualDraft>(key: T, value: (typeof manualDraft)[T]) {
    setManualDraft((current) => ({ ...current, [key]: value }));
    setManualError('');
  }

  function resetManualDraft() {
    setManualDraft({ ...EMPTY_MANUAL_RESERVATION, date: dayStatus.date, time: timeSlots[0] ?? getCurrentTime() });
    setManualError('');
  }

  function closeManualModal() {
    resetManualDraft();
    setIsManualModalOpen(false);
  }

  function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!manualDraft.date || !manualDraft.time || manualDraft.pax < 1) {
      return;
    }

    if (!manualDraft.name.trim() && !manualDraft.room.trim()) {
      setManualError('Introduce al menos nombre o habitación.');
      return;
    }

    onAddManualReservation({
      date: manualDraft.date,
      time: manualDraft.time,
      name: manualDraft.name.trim(),
      room: manualDraft.room.trim(),
      phone: manualDraft.phone.trim(),
      pax: manualDraft.pax,
      specialRequest: manualDraft.specialRequest.trim() || 'No, ninguna',
    });

    resetManualDraft();
    setIsManualModalOpen(false);
  }

  return (
    <main className="app-shell">
      <section className="top-bar today-brand-bar" aria-label="Resumen del dia">
        <div className="today-header-spacer" aria-hidden="true" />
        <div className="app-brand-header today-restaurant-brand">
          <div className="brand-lockup">
            <BrandLogo logoUrl={getRestaurantLogo(restaurantLogoUrl)} fallbackUrl={DEFAULT_RESTAURANT_LOGO} fallbackLabel={restaurantName} alt={restaurantName} variant="restaurant" />
            <h1>{restaurantName}</h1>
          </div>
        </div>
        <div className="today-header-aside">
          <div className="costabots-lockup today-costabots-brand">
            <BrandLogo fallbackUrl={DEFAULT_COSTABOTS_LOGO} fallbackLabel="C" alt="Costabots" variant="platform" preferFallback />
            <span>COSTABOTS MANAGER</span>
          </div>
        </div>
      </section>

      {isToastVisible && (
        <div className="toast-notification" role="status">
          <span>{syncLabel}</span>
          <button type="button" onClick={() => setIsToastVisible(false)} aria-label="Cerrar aviso">
            <X size={16} />
          </button>
        </div>
      )}

      <section className="today-sheet-header" aria-label="Fecha de hoy">
        <strong>HOY</strong>
        <span>{formatDisplayDate(displayDate)}</span>
      </section>

      <section className="today-main-grid" aria-label="Resumen operativo de hoy">
        <article className="today-summary-card">
          <p className="eyebrow">Resumen</p>
          <div className="summary-lines">
            <div>
              <span>Pax totales</span>
              <strong>{displayTotalPax}</strong>
            </div>
            <div>
              <span>Ocupacion</span>
              <strong>{displayOccupancyPercent}%</strong>
            </div>
          </div>
          <div className="occupancy-meter compact" aria-label={`Ocupacion ${displayOccupancyPercent}%`}>
            <span style={{ width: `${displayOccupancyPercent}%` }} />
          </div>
        </article>

        <BookingStatusToggle bookingsOpen={displayBookingsOpen} onToggle={onBookingStatus} />
        <WalkInForm onAddWalkIn={onAddWalkIn} />

        <button className="manual-reservation-card" type="button" onClick={() => setIsManualModalOpen(true)}>
          <span>Reserva manual</span>
          <strong>
            <Plus size={18} />
            Añadir reserva
          </strong>
        </button>
      </section>

      <section className="table-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">Turno de hoy</p>
            <h2>Reservas</h2>
          </div>
          <span className="reservation-count">
            <Plus size={16} />
            {displayReservations.length} reservas
          </span>
        </div>
        {isLoadingToday ? (
          <div className="sync-status">Cargando reservas...</div>
        ) : todayError ? (
          <div className="sync-status">No se pudieron cargar reservas desde Make.</div>
        ) : displayReservations.length === 0 ? (
          <div className="sync-status">No hay reservas para hoy</div>
        ) : (
          <ReservationsTable reservations={displayReservations} tableOptions={tableOptions} onUpdate={onUpdateReservation} />
        )}
      </section>

      {isManualModalOpen && (
        <div className="modal-backdrop" role="presentation" onPointerDown={closeManualModal}>
          <form className="show-modal manual-modal" onPointerDown={(event) => event.stopPropagation()} onSubmit={handleManualSubmit}>
            <div className="section-title compact">
              <div>
                <p className="eyebrow">Nueva reserva manual</p>
                <h2>Reserva</h2>
              </div>
              <button className="icon-button" type="button" onClick={closeManualModal} aria-label="Cerrar">
                <X size={22} />
              </button>
            </div>

            {manualError && <p className="form-error">{manualError}</p>}

            <div className="manual-form-grid">
              <label>
                Fecha
                <input value={manualDraft.date} type="date" onChange={(event) => updateManualDraft('date', event.target.value)} />
              </label>
              <label>
                Hora
                <select value={manualDraft.time} onChange={(event) => updateManualDraft('time', event.target.value)}>
                  {timeSlots.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nombre
                <input value={manualDraft.name} onChange={(event) => updateManualDraft('name', event.target.value)} />
              </label>
              <label>
                Habitacion
                <input value={manualDraft.room} onChange={(event) => updateManualDraft('room', event.target.value)} />
              </label>
              <label>
                Telefono
                <input value={manualDraft.phone} onChange={(event) => updateManualDraft('phone', event.target.value)} />
              </label>
              <label>
                Pax
                <input min="1" type="number" value={manualDraft.pax} onChange={(event) => updateManualDraft('pax', Number(event.target.value))} />
              </label>
              <label className="manual-form-wide">
                Peticion especial
                <input value={manualDraft.specialRequest} onChange={(event) => updateManualDraft('specialRequest', event.target.value)} />
              </label>
            </div>

            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeManualModal}>
                Cancelar
              </button>
              <button type="submit">Guardar reserva</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const mins = (minutes % 60).toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

function generateTimeSlots(openingTime: string, closingTime: string, interval: 30 | 60) {
  const opening = timeToMinutes(openingTime);
  const closing = timeToMinutes(closingTime);

  if (closing < opening) {
    return [openingTime];
  }

  const slots: string[] = [];
  for (let current = opening; current <= closing; current += interval) {
    slots.push(minutesToTime(current));
  }
  return slots;
}
