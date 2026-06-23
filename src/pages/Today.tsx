import { Plus, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BookingStatusToggle } from '../components/BookingStatusToggle';
import { BrandLogo } from '../components/BrandLogo';
import { ReservationsTable } from '../components/ReservationsTable';
import { WalkInForm } from '../components/WalkInForm';
import { DEFAULT_COSTABOTS_LOGO, RESTAURANT_LOGO } from '../config/branding';
import { getTodayData, hasTodayDataEndpoint } from '../services/api';
import type { TodayData } from '../services/api';
import type { BookingService, DayState, ReservableResource, Reservation } from '../types';
import { generateTimeSlots } from '../utils/capacity';
import { formatDisplayDate, getCurrentTime } from '../utils/date';

interface TodayProps {
  dayStatus: DayState;
  lastSync: string;
  restaurantName: string;
  restaurantLogoUrl: string;
  openingTime: string;
  closingTime: string;
  bookingInterval: 30 | 60;
  reservations: Reservation[];
  reservableResources: ReservableResource[];
  serviceTabs: BookingService[];
  selectedService: BookingService;
  onServiceChange: (service: BookingService) => void;
  tableOptions: string[];
  hasLoadedTables: boolean;
  isLoadingTables: boolean;
  totalPax: number;
  arrivals: number;
  occupancyPercent: number;
  totalCapacity: number;
  onAddWalkIn: (nameOrRoom: string, pax: number) => Promise<void>;
  onAddManualReservation: (reservation: Omit<Reservation, 'id' | 'idReserva' | 'status' | 'source' | 'table' | 'arrived'>) => void | Promise<void>;
  onBookingStatus: () => void;
  onUpdateReservation: (id: string, field: 'table' | 'arrived', value: string | boolean) => Promise<void>;
  onEnsureTables: () => Promise<void>;
  onCancelReservation: (reservation: Reservation) => void;
  onRefreshReservations: () => Promise<void>;
  isRefreshingReservations: boolean;
  lastUpdatedAt: string;
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

const EMPTY_BALINESE_DRAFT = {
  name: '',
  room: '',
  phone: '',
  adults: 2,
  children: 0,
  package: 'BASIC' as 'BASIC' | 'PREMIUM',
  specialRequest: '',
};

const BALINESE_PACKAGES = {
  BASIC: '50€ Agua + fruta',
  PREMIUM: '100€ Agua + fruta + almuerzo en Safari',
};

function normalizeResourceName(value: string | undefined) {
  return String(value ?? '').trim().toUpperCase();
}

export function Today({
  dayStatus,
  lastSync,
  restaurantName,
  restaurantLogoUrl,
  openingTime,
  closingTime,
  bookingInterval,
  reservations,
  reservableResources,
  serviceTabs,
  selectedService,
  onServiceChange,
  tableOptions,
  hasLoadedTables,
  isLoadingTables,
  totalPax,
  occupancyPercent,
  totalCapacity,
  onAddWalkIn,
  onAddManualReservation,
  onBookingStatus,
  onUpdateReservation,
  onEnsureTables,
  onCancelReservation,
  onRefreshReservations,
  isRefreshingReservations,
  lastUpdatedAt,
}: TodayProps) {
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [isLoadingToday, setIsLoadingToday] = useState(false);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [selectedBalineseResource, setSelectedBalineseResource] = useState<ReservableResource | null>(null);
  const [balineseDraft, setBalineseDraft] = useState(EMPTY_BALINESE_DRAFT);
  const [balineseError, setBalineseError] = useState('');
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

  useEffect(() => {
    if (!isManualModalOpen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousOverscroll = document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior = previousOverscroll;
    };
  }, [isManualModalOpen]);

  const displayReservations = reservations;
  const activeBalineseResources = useMemo(
    () =>
      reservableResources
        .filter((resource) => resource.active)
        .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name)),
    [reservableResources],
  );
  const balineseReservationsByResource = useMemo(
    () =>
      new Map(
        reservations
          .filter((reservation) => normalizeResourceName(reservation.resource))
          .map((reservation) => [normalizeResourceName(reservation.resource), reservation]),
      ),
    [reservations],
  );
  const displayDate = dayStatus.date;
  const displayBookingsOpen = todayData?.bookingsOpen ?? dayStatus.bookingsOpen;
  const displayTotalPax = totalPax;
  const displayCapacity = totalCapacity;
  const displayOccupancyPercent = occupancyPercent;
  const syncLabel = isLoadingToday ? 'Cargando datos de HOY...' : todayError ? `Error: ${todayError}` : lastSync;

  useEffect(() => {
    console.log('Logo visual recibido:', restaurantLogoUrl);
  }, [restaurantLogoUrl]);

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

  function updateBalineseDraft<T extends keyof typeof balineseDraft>(key: T, value: (typeof balineseDraft)[T]) {
    setBalineseDraft((current) => ({ ...current, [key]: value }));
    setBalineseError('');
  }

  function closeBalineseModal() {
    setSelectedBalineseResource(null);
    setBalineseDraft(EMPTY_BALINESE_DRAFT);
    setBalineseError('');
  }

  async function handleBalineseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedBalineseResource) {
      return;
    }

    const pax = balineseDraft.adults + balineseDraft.children;
    const maxCapacity = Math.min(selectedBalineseResource.capacity || 4, 4);

    if (!balineseDraft.name.trim() && !balineseDraft.room.trim()) {
      setBalineseError('Introduce al menos nombre o habitación.');
      return;
    }

    if (pax < 1 || pax > maxCapacity) {
      setBalineseError(`La capacidad máxima de este recurso es ${maxCapacity} personas.`);
      return;
    }

    await onAddManualReservation({
      date: dayStatus.date,
      time: '00:00',
      name: balineseDraft.name.trim(),
      room: balineseDraft.room.trim(),
      phone: balineseDraft.phone.trim(),
      pax,
      specialRequest: balineseDraft.specialRequest.trim(),
      service: 'BALINESA',
      balinesePackage: balineseDraft.package,
      resource: selectedBalineseResource.name,
    });

    closeBalineseModal();
  }

  async function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!manualDraft.date || !manualDraft.time || manualDraft.pax < 1) {
      return;
    }

    if (!manualDraft.name.trim() && !manualDraft.room.trim()) {
      setManualError('Introduce al menos nombre o habitación.');
      return;
    }

    await onAddManualReservation({
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
            <BrandLogo logoUrl={restaurantLogoUrl} fallbackUrl={RESTAURANT_LOGO} fallbackLabel={restaurantName} alt={restaurantName} variant="restaurant" />
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
        <div className="today-reservations-toolbar">
          <div className="today-service-tabs-area">
            {serviceTabs.length > 1 && (
              <div className="segmented-control today-service-tabs" aria-label="Servicio">
                {serviceTabs.map((service) => (
                  <button
                    key={service}
                    className={selectedService === service ? 'is-active' : undefined}
                    type="button"
                    onClick={() => onServiceChange(service)}
                  >
                    {service}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="today-refresh-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={isRefreshingReservations}
              onClick={() => void onRefreshReservations()}
            >
              Actualizar datos
            </button>
            <span className="last-updated">Última actualización: {lastUpdatedAt || '--:--:--'}</span>
          </div>
        </div>
        {selectedService === 'BALINESA' ? (
          <div className="balinese-resource-grid">
            {activeBalineseResources.length === 0 && <div className="sync-status">No hay recursos activos configurados.</div>}
            {activeBalineseResources.map((resource) => {
              const reservedReservation = balineseReservationsByResource.get(normalizeResourceName(resource.name));
              const isReserved = Boolean(reservedReservation);

              return (
                <article className={`balinese-resource-card ${isReserved ? 'is-reserved' : 'is-free'}`} key={resource.id}>
                  <div className="balinese-resource-header">
                    <strong>{resource.name}</strong>
                    <span>{isReserved ? 'Reservada' : 'Libre'}</span>
                  </div>
                  <p>Capacidad: {resource.capacity || 4}</p>
                  {reservedReservation ? (
                    <div className="balinese-reservation-summary">
                      <span>Nombre: {reservedReservation.name || '-'}</span>
                      <span>Hab: {reservedReservation.room || '-'}</span>
                      <span>Paquete: {reservedReservation.balinesePackage || '-'}</span>
                      <button className="danger-button compact-action" type="button" onClick={() => onCancelReservation(reservedReservation)}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setSelectedBalineseResource(resource)}>
                      Reservar
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ) : isLoadingToday ? (
          <div className="sync-status">Cargando reservas...</div>
        ) : todayError ? (
          <div className="sync-status">No se pudieron cargar reservas desde Make.</div>
        ) : displayReservations.length === 0 ? (
          <div className="sync-status">No hay reservas para hoy</div>
        ) : (
          <ReservationsTable
            reservations={displayReservations}
            tableOptions={tableOptions}
            hasLoadedTables={hasLoadedTables}
            isLoadingTables={isLoadingTables}
            onEnsureTables={onEnsureTables}
            onUpdate={onUpdateReservation}
            onCancel={onCancelReservation}
          />
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

      {selectedBalineseResource && (
        <div className="modal-backdrop" role="presentation" onPointerDown={closeBalineseModal}>
          <form className="show-modal manual-modal" onPointerDown={(event) => event.stopPropagation()} onSubmit={handleBalineseSubmit}>
            <div className="section-title compact">
              <div>
                <p className="eyebrow">Reservar balinesa</p>
                <h2>{selectedBalineseResource.name}</h2>
              </div>
              <button className="icon-button" type="button" onClick={closeBalineseModal} aria-label="Cerrar">
                <X size={22} />
              </button>
            </div>

            {balineseError && <p className="form-error">{balineseError}</p>}

            <div className="manual-form-grid">
              <label>
                Nombre
                <input value={balineseDraft.name} onChange={(event) => updateBalineseDraft('name', event.target.value)} />
              </label>
              <label>
                Habitación
                <input value={balineseDraft.room} onChange={(event) => updateBalineseDraft('room', event.target.value)} />
              </label>
              <label>
                Teléfono
                <input value={balineseDraft.phone} onChange={(event) => updateBalineseDraft('phone', event.target.value)} />
              </label>
              <label>
                Adultos
                <input min={0} max={4} type="number" value={balineseDraft.adults} onChange={(event) => updateBalineseDraft('adults', Number(event.target.value))} />
              </label>
              <label>
                Niños
                <input min={0} max={4} type="number" value={balineseDraft.children} onChange={(event) => updateBalineseDraft('children', Number(event.target.value))} />
              </label>
              <label>
                Paquete
                <select value={balineseDraft.package} onChange={(event) => updateBalineseDraft('package', event.target.value as 'BASIC' | 'PREMIUM')}>
                  <option value="BASIC">BASIC - {BALINESE_PACKAGES.BASIC}</option>
                  <option value="PREMIUM">PREMIUM - {BALINESE_PACKAGES.PREMIUM}</option>
                </select>
              </label>
              <label className="manual-form-wide">
                Petición especial
                <input value={balineseDraft.specialRequest} onChange={(event) => updateBalineseDraft('specialRequest', event.target.value)} />
              </label>
            </div>

            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeBalineseModal}>
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
