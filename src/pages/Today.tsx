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
import { formatDisplayDate, getCurrentTime, normalizeDateForCompare } from '../utils/date';
import { isActiveReservation } from '../utils/reservationStatus';

interface TodayProps {
  dayStatus: DayState;
  lastSync: string;
  restaurantName: string;
  restaurantLogoUrl: string;
  openingTime: string;
  closingTime: string;
  bookingInterval: 30 | 60;
  reservations: Reservation[];
  allReservations: Reservation[];
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
  pax: '2',
  specialRequest: '',
};

const EMPTY_BALINESE_DRAFT = {
  name: '',
  room: '',
  phone: '',
  adults: '2',
  children: '0',
  package: 'BASIC' as 'BASIC' | 'PREMIUM',
  specialRequest: '',
};

const EMPTY_OTHER_DAY_BALINESE_DRAFT = {
  date: '',
  resourceId: '',
  name: '',
  room: '',
  phone: '',
  adults: '2',
  children: '0',
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

function parseIntegerInput(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue || !/^\d+$/.test(trimmedValue)) {
    return null;
  }

  const parsedValue = Number(trimmedValue);
  return Number.isInteger(parsedValue) ? parsedValue : null;
}

function selectPaxInput(event: { currentTarget: HTMLInputElement }) {
  const input = event.currentTarget;
  requestAnimationFrame(() => {
    input.select();
  });
}

function numericInputValue(value: string) {
  return value.replace(/\D/g, '');
}

function getSubmitErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return message ? `No se pudo guardar la reserva: ${message}` : 'No se pudo guardar la reserva. Revisa el error e intentalo de nuevo.';
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
  allReservations,
  reservableResources,
  serviceTabs,
  selectedService,
  onServiceChange,
  tableOptions,
  hasLoadedTables,
  isLoadingTables,
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
  const [isOtherDayBalineseOpen, setIsOtherDayBalineseOpen] = useState(false);
  const [otherDayBalineseDraft, setOtherDayBalineseDraft] = useState({
    ...EMPTY_OTHER_DAY_BALINESE_DRAFT,
    date: dayStatus.date,
  });
  const [otherDayBalineseError, setOtherDayBalineseError] = useState('');
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
  const otherDaySelectedResource = useMemo(
    () => activeBalineseResources.find((resource) => resource.id === otherDayBalineseDraft.resourceId) ?? null,
    [activeBalineseResources, otherDayBalineseDraft.resourceId],
  );
  const displayDate = dayStatus.date;
  const displayBookingsOpen = todayData?.bookingsOpen ?? dayStatus.bookingsOpen;
  const displayCapacity = totalCapacity;
  const displayServicePax = reservations.reduce((total, reservation) => total + reservation.pax, 0);
  const displayOccupancyPercent = displayCapacity > 0 ? Math.min(100, Math.round((displayServicePax / displayCapacity) * 100)) : occupancyPercent;
  const selectedServiceLabel = selectedService === 'BALINESA' ? 'BALINESAS' : selectedService;
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

  function openOtherDayBalineseModal() {
    setOtherDayBalineseDraft({
      ...EMPTY_OTHER_DAY_BALINESE_DRAFT,
      date: dayStatus.date,
      resourceId: activeBalineseResources[0]?.id ?? '',
    });
    setOtherDayBalineseError('');
    setIsOtherDayBalineseOpen(true);
  }

  function closeOtherDayBalineseModal() {
    setOtherDayBalineseDraft({
      ...EMPTY_OTHER_DAY_BALINESE_DRAFT,
      date: dayStatus.date,
    });
    setOtherDayBalineseError('');
    setIsOtherDayBalineseOpen(false);
  }

  function updateOtherDayBalineseDraft<T extends keyof typeof otherDayBalineseDraft>(key: T, value: (typeof otherDayBalineseDraft)[T]) {
    setOtherDayBalineseDraft((current) => ({ ...current, [key]: value }));
    setOtherDayBalineseError('');
  }

  function isBalineseResourceBooked(resourceName: string, date: string) {
    const normalizedResource = normalizeResourceName(resourceName);
    const normalizedDate = normalizeDateForCompare(date);

    return allReservations.some((reservation) => {
      return (
        isActiveReservation(reservation)
        && reservation.service === 'BALINESA'
        && normalizeDateForCompare(reservation.date) === normalizedDate
        && normalizeResourceName(reservation.resource) === normalizedResource
      );
    });
  }

  async function handleBalineseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedBalineseResource) {
      return;
    }

    const adults = parseIntegerInput(balineseDraft.adults);
    const children = parseIntegerInput(balineseDraft.children);
    const pax = (adults ?? 0) + (children ?? 0);
    const maxCapacity = Math.min(selectedBalineseResource.capacity || 4, 4);

    if (!balineseDraft.name.trim() && !balineseDraft.room.trim()) {
      setBalineseError('Introduce al menos nombre o habitación.');
      return;
    }

    if (adults === null || children === null) {
      setBalineseError('Introduce un numero valido de adultos y ninos.');
      return;
    }

    if (pax < 1 || pax > maxCapacity) {
      setBalineseError(`La capacidad máxima de este recurso es ${maxCapacity} personas.`);
      return;
    }

    try {
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
    } catch (error) {
      setBalineseError(getSubmitErrorMessage(error));
    }
  }

  async function handleOtherDayBalineseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!otherDaySelectedResource) {
      setOtherDayBalineseError('Selecciona una balinesa.');
      return;
    }

    const adults = parseIntegerInput(otherDayBalineseDraft.adults);
    const children = parseIntegerInput(otherDayBalineseDraft.children);
    const pax = (adults ?? 0) + (children ?? 0);
    const maxCapacity = Math.min(otherDaySelectedResource.capacity || 4, 4);

    if (!otherDayBalineseDraft.date) {
      setOtherDayBalineseError('Selecciona una fecha.');
      return;
    }

    if (!otherDayBalineseDraft.name.trim() && !otherDayBalineseDraft.room.trim()) {
      setOtherDayBalineseError('Introduce al menos nombre o habitacion.');
      return;
    }

    if (adults === null || children === null) {
      setOtherDayBalineseError('Introduce un numero valido de adultos y ninos.');
      return;
    }

    if (pax < 1 || pax > maxCapacity) {
      setOtherDayBalineseError(`La capacidad maxima de este recurso es ${maxCapacity} personas.`);
      return;
    }

    if (isBalineseResourceBooked(otherDaySelectedResource.name, otherDayBalineseDraft.date)) {
      setOtherDayBalineseError('Esta balinesa ya esta reservada para ese dia.');
      return;
    }

    try {
      await onAddManualReservation({
        date: otherDayBalineseDraft.date,
        time: '00:00',
        name: otherDayBalineseDraft.name.trim(),
        room: otherDayBalineseDraft.room.trim(),
        phone: otherDayBalineseDraft.phone.trim(),
        pax,
        specialRequest: otherDayBalineseDraft.specialRequest.trim(),
        service: 'BALINESA',
        balinesePackage: otherDayBalineseDraft.package,
        resource: otherDaySelectedResource.name,
      });

      closeOtherDayBalineseModal();
    } catch (error) {
      setOtherDayBalineseError(getSubmitErrorMessage(error));
    }
  }

  async function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const pax = parseIntegerInput(manualDraft.pax);

    if (!manualDraft.date || !manualDraft.time) {
      return;
    }

    if (pax === null || pax < 1) {
      setManualError('Introduce un pax valido.');
      return;
    }

    if (!manualDraft.name.trim() && !manualDraft.room.trim()) {
      setManualError('Introduce al menos nombre o habitación.');
      return;
    }

    try {
      await onAddManualReservation({
        date: manualDraft.date,
        time: manualDraft.time,
        name: manualDraft.name.trim(),
        room: manualDraft.room.trim(),
        phone: manualDraft.phone.trim(),
        pax,
        specialRequest: manualDraft.specialRequest.trim() || 'No, ninguna',
      });

      resetManualDraft();
      setIsManualModalOpen(false);
    } catch (error) {
      setManualError(getSubmitErrorMessage(error));
    }
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

      <section className="today-compact-header" aria-label="Resumen operativo de hoy">
        <div className="today-compact-date">
          <span>HOY</span>
          <strong>{formatDisplayDate(displayDate)}</strong>
        </div>
        <div className="today-compact-stat">
          <span>Pax {selectedServiceLabel}</span>
          <strong>{displayServicePax} / {displayCapacity}</strong>
          <small>{displayOccupancyPercent}% ocupacion</small>
        </div>
        <BookingStatusToggle bookingsOpen={displayBookingsOpen} onToggle={onBookingStatus} />
      </section>

      <section className="today-main-grid" aria-label="Acciones operativas de hoy">
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
          <>
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
                    <p>{reservedReservation ? `Tel: ${reservedReservation.phone || '—'}` : `Capacidad: ${resource.capacity || 4}`}</p>
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
            <div className="balinese-secondary-action">
              <button className="balinese-other-day-button" type="button" disabled={activeBalineseResources.length === 0} onClick={openOtherDayBalineseModal}>
                + Reservar balinesa otro dia
              </button>
            </div>
          </>
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
                <input min="1" step="1" inputMode="numeric" pattern="[0-9]*" type="text" value={manualDraft.pax} onFocus={selectPaxInput} onClick={selectPaxInput} onPointerUp={selectPaxInput} onChange={(event) => updateManualDraft('pax', numericInputValue(event.target.value))} />
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
                <input min={0} max={4} step="1" inputMode="numeric" pattern="[0-9]*" type="text" value={balineseDraft.adults} onFocus={selectPaxInput} onClick={selectPaxInput} onPointerUp={selectPaxInput} onChange={(event) => updateBalineseDraft('adults', numericInputValue(event.target.value))} />
              </label>
              <label>
                Niños
                <input min={0} max={4} step="1" inputMode="numeric" pattern="[0-9]*" type="text" value={balineseDraft.children} onFocus={selectPaxInput} onClick={selectPaxInput} onPointerUp={selectPaxInput} onChange={(event) => updateBalineseDraft('children', numericInputValue(event.target.value))} />
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

      {isOtherDayBalineseOpen && (
        <div className="modal-backdrop" role="presentation" onPointerDown={closeOtherDayBalineseModal}>
          <form className="show-modal manual-modal" onPointerDown={(event) => event.stopPropagation()} onSubmit={handleOtherDayBalineseSubmit}>
            <div className="section-title compact">
              <div>
                <p className="eyebrow">Reservar balinesa</p>
                <h2>Otro dia</h2>
              </div>
              <button className="icon-button" type="button" onClick={closeOtherDayBalineseModal} aria-label="Cerrar">
                <X size={22} />
              </button>
            </div>

            {otherDayBalineseError && <p className="form-error">{otherDayBalineseError}</p>}

            <div className="manual-form-grid">
              <label>
                Fecha
                <input value={otherDayBalineseDraft.date} type="date" onChange={(event) => updateOtherDayBalineseDraft('date', event.target.value)} />
              </label>
              <label>
                Balinesa
                <select value={otherDayBalineseDraft.resourceId} onChange={(event) => updateOtherDayBalineseDraft('resourceId', event.target.value)}>
                  <option value="">Seleccionar</option>
                  {activeBalineseResources.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nombre
                <input value={otherDayBalineseDraft.name} onChange={(event) => updateOtherDayBalineseDraft('name', event.target.value)} />
              </label>
              <label>
                Habitacion
                <input value={otherDayBalineseDraft.room} onChange={(event) => updateOtherDayBalineseDraft('room', event.target.value)} />
              </label>
              <label>
                Telefono
                <input value={otherDayBalineseDraft.phone} onChange={(event) => updateOtherDayBalineseDraft('phone', event.target.value)} />
              </label>
              <label>
                Adultos
                <input min={0} max={4} step="1" inputMode="numeric" pattern="[0-9]*" type="text" value={otherDayBalineseDraft.adults} onFocus={selectPaxInput} onClick={selectPaxInput} onPointerUp={selectPaxInput} onChange={(event) => updateOtherDayBalineseDraft('adults', numericInputValue(event.target.value))} />
              </label>
              <label>
                Ninos
                <input min={0} max={4} step="1" inputMode="numeric" pattern="[0-9]*" type="text" value={otherDayBalineseDraft.children} onFocus={selectPaxInput} onClick={selectPaxInput} onPointerUp={selectPaxInput} onChange={(event) => updateOtherDayBalineseDraft('children', numericInputValue(event.target.value))} />
              </label>
              <label>
                Paquete
                <select value={otherDayBalineseDraft.package} onChange={(event) => updateOtherDayBalineseDraft('package', event.target.value as 'BASIC' | 'PREMIUM')}>
                  <option value="BASIC">BASIC - {BALINESE_PACKAGES.BASIC}</option>
                  <option value="PREMIUM">PREMIUM - {BALINESE_PACKAGES.PREMIUM}</option>
                </select>
              </label>
              <label className="manual-form-wide">
                Peticiones / notas
                <input value={otherDayBalineseDraft.specialRequest} onChange={(event) => updateOtherDayBalineseDraft('specialRequest', event.target.value)} />
              </label>
            </div>

            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeOtherDayBalineseModal}>
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

