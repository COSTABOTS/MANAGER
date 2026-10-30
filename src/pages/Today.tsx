import { Plus, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BookingStatusToggle } from '../components/BookingStatusToggle';
import { BrandLogo } from '../components/BrandLogo';
import { ReservationsTable } from '../components/ReservationsTable';
import { WalkInForm } from '../components/WalkInForm';
import { DEFAULT_COSTABOTS_LOGO, RESTAURANT_LOGO } from '../config/branding';
import { getTodayData, hasTodayDataEndpoint } from '../services/api';
import { getWeeklyHours } from '../services/weeklyHoursApi';
import type { WeeklyHoursRow } from '../services/weeklyHoursApiContract';
import type { TodayData } from '../services/api';
import type { BookingService, DayState, ReservableResource, Reservation, ServiceWithHours } from '../types';
import { generateTimeSlots } from '../utils/capacity';
import { formatDisplayDate, getCurrentTime, normalizeDateForCompare } from '../utils/date';
import { isActiveReservation } from '../utils/reservationStatus';
import { getInactiveServiceReservations, getScheduledTodayTabs } from '../utils/todayServices';
import { getMadridClock, getManualRestaurantServices, getManualRestaurantSlots, getOpenRestaurantServiceAt } from '../utils/internalBookingPreview';

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
  clientId?: string;
  weeklyPreview?: boolean;
  weeklyModeUnknown?: boolean;
  reservableResources: ReservableResource[];
  serviceTabs: BookingService[];
  selectedService: BookingService | null;
  onServiceChange: (service: BookingService) => void;
  tableOptions: string[];
  hasLoadedTables: boolean;
  isLoadingTables: boolean;
  totalPax: number;
  arrivals: number;
  occupancyPercent: number;
  totalCapacity: number;
  onAddWalkIn: (nameOrRoom: string, pax: number, selection?: { service: ServiceWithHours; date: string; time: string }) => Promise<void>;
  onAddManualReservation: (reservation: Omit<Reservation, 'id' | 'idReserva' | 'status' | 'source' | 'table' | 'arrived'>) => void | Promise<void>;
  onBookingStatus: () => void;
  onUpdateReservation: (id: string, field: 'table' | 'arrived', value: string | boolean) => Promise<void>;
  onEnsureTables: () => Promise<void>;
  onCancelReservation: (reservation: Reservation) => void;
  onBalinesePayment: (id: string, paid: boolean) => Promise<void>;
  onRefreshReservations: () => Promise<void>;
  isRefreshingReservations: boolean;
  lastUpdatedAt: string;
}

const EMPTY_MANUAL_RESERVATION = {
  date: '',
  time: '',
  service: '' as ServiceWithHours | '',
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
  paid: false,
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
  clientId = '',
  weeklyPreview = false,
  weeklyModeUnknown = false,
  reservableResources,
  serviceTabs,
  selectedService: requestedService,
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
  onBalinesePayment,
  onRefreshReservations,
  isRefreshingReservations,
  lastUpdatedAt,
}: TodayProps) {
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [isLoadingToday, setIsLoadingToday] = useState(false);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [weeklySnapshot, setWeeklySnapshot] = useState<{ clientId: string; rules: WeeklyHoursRow[]; error: boolean } | null>(null);
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
  const [madridNow, setMadridNow] = useState(getMadridClock);
  const [isToastVisible, setIsToastVisible] = useState(false);
  const timeSlots = useMemo(() => generateTimeSlots(openingTime, closingTime, bookingInterval), [bookingInterval, closingTime, openingTime]);
  const [manualDraft, setManualDraft] = useState({
    ...EMPTY_MANUAL_RESERVATION,
    date: weeklyPreview ? getMadridClock().date : dayStatus.date,
    time: weeklyPreview ? '' : timeSlots[0] ?? getCurrentTime(),
  });

  useEffect(() => {
    if (!weeklyPreview) return;
    const refresh = () => setMadridNow(getMadridClock());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [weeklyPreview]);

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
    if (!weeklyPreview || !clientId) return;
    let cancelled = false;
    void getWeeklyHours(clientId).then((snapshot) => {
      if (!cancelled) setWeeklySnapshot({ clientId, rules: snapshot.rules, error: false });
    }).catch(() => {
      if (!cancelled) setWeeklySnapshot({ clientId, rules: [], error: true });
    });
    return () => { cancelled = true; };
  }, [clientId, weeklyPreview, dayStatus.date]);

  useEffect(() => {
    if (weeklyPreview) return;
    setManualDraft((current) => (timeSlots.includes(current.time) ? current : { ...current, time: timeSlots[0] ?? getCurrentTime() }));
  }, [timeSlots, weeklyPreview]);

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

  const scheduledTabs = weeklyPreview
    ? getScheduledTodayTabs(serviceTabs, dayStatus.date, weeklySnapshot?.clientId === clientId && !weeklySnapshot.error ? weeklySnapshot.rules : null)
    : { tabs: serviceTabs, status: 'ready' as const };
  const visibleServiceTabs = scheduledTabs.tabs;
  const verifiedWeeklyRows = weeklyPreview && weeklySnapshot?.clientId === clientId && !weeklySnapshot.error
    ? weeklySnapshot.rules : null;
  const walkInService = weeklyPreview ? getOpenRestaurantServiceAt(serviceTabs, madridNow, verifiedWeeklyRows) : null;
  const walkInDisabledReason = weeklyModeUnknown ? 'No se pudo verificar el modo de horarios. Actualiza SETTINGS antes de crear un walk-in.'
    : !weeklyPreview ? undefined
    : scheduledTabs.status === 'unavailable' ? 'Horario semanal no disponible; no se puede crear un walk-in desde Preview.'
      : madridNow.date !== dayStatus.date ? 'La fecha de HOY ha cambiado. Actualiza la página antes de crear un walk-in.'
        : !walkInService ? 'No hay ningún servicio de restaurante abierto ahora.' : undefined;
  const manualServices = weeklyPreview ? getManualRestaurantServices(serviceTabs, manualDraft.date, verifiedWeeklyRows) : [];
  const manualSlots = weeklyPreview && manualDraft.service
    ? getManualRestaurantSlots(serviceTabs, manualDraft.date, manualDraft.service, verifiedWeeklyRows, bookingInterval) : [];
  const selectedService = requestedService && visibleServiceTabs.includes(requestedService)
    ? requestedService : visibleServiceTabs[0] ?? null;
  useEffect(() => {
    if (selectedService && selectedService !== requestedService) onServiceChange(selectedService);
  }, [onServiceChange, requestedService, selectedService]);
  const displayReservations = requestedService === selectedService ? reservations
    : allReservations.filter((reservation) => normalizeDateForCompare(reservation.date) === dayStatus.date
      && isActiveReservation(reservation) && (reservation.service ?? 'CENA') === selectedService);
  const inactiveServiceReservations = getInactiveServiceReservations(allReservations.filter((reservation) =>
    normalizeDateForCompare(reservation.date) === dayStatus.date && isActiveReservation(reservation)), visibleServiceTabs);
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
        displayReservations
          .filter((reservation) => normalizeResourceName(reservation.resource))
          .map((reservation) => [normalizeResourceName(reservation.resource), reservation]),
      ),
    [displayReservations],
  );
  const otherDaySelectedResource = useMemo(
    () => activeBalineseResources.find((resource) => resource.id === otherDayBalineseDraft.resourceId) ?? null,
    [activeBalineseResources, otherDayBalineseDraft.resourceId],
  );
  const displayDate = dayStatus.date;
  const displayBookingsOpen = todayData?.bookingsOpen ?? dayStatus.bookingsOpen;
  const displayCapacity = totalCapacity;
  const displayServicePax = displayReservations.reduce((total, reservation) => total + reservation.pax, 0);
  const displayOccupancyPercent = displayCapacity > 0 ? Math.min(100, Math.round((displayServicePax / displayCapacity) * 100)) : occupancyPercent;
  const selectedServiceLabel = visibleServiceTabs.length === 0 ? 'SIN SERVICIOS ABIERTOS' : selectedService === 'BALINESA' ? 'BALINESAS' : selectedService ?? 'SIN SERVICIO';
  const inactiveRestaurantReservations = inactiveServiceReservations.filter((reservation) => reservation.service !== 'BALINESA');
  const inactiveBalineseReservations = inactiveServiceReservations.filter((reservation) => reservation.service === 'BALINESA');
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

  function changeManualDate(date: string) {
    setManualDraft((current) => ({ ...current, date, service: '', time: '' }));
    setManualError('');
  }

  function resetManualDraft() {
    setManualDraft({ ...EMPTY_MANUAL_RESERVATION, date: weeklyPreview ? getMadridClock().date : dayStatus.date,
      time: weeklyPreview ? '' : timeSlots[0] ?? getCurrentTime() });
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
        balinesePaid: otherDayBalineseDraft.paid,
        resource: otherDaySelectedResource.name,
      });

      closeOtherDayBalineseModal();
    } catch (error) {
      setOtherDayBalineseError(getSubmitErrorMessage(error));
    }
  }

  async function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (weeklyModeUnknown) {
      setManualError('No se pudo verificar el modo de horarios. No se enviará la reserva.');
      return;
    }

    const pax = parseIntegerInput(manualDraft.pax);

    if (!manualDraft.date || !manualDraft.time) {
      setManualError('Selecciona una fecha y una hora válidas.');
      return;
    }
    if (weeklyPreview && (!manualDraft.service || !manualServices.includes(manualDraft.service)
      || !manualSlots.includes(manualDraft.time))) {
      setManualError('Selecciona un servicio abierto y una hora válida para esa fecha. Si falta el horario, no se enviará la reserva.');
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
        ...(weeklyPreview ? { service: manualDraft.service as ServiceWithHours } : {}),
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
            <BrandLogo className="restaurant-avatar-header" logoUrl={restaurantLogoUrl} fallbackUrl={RESTAURANT_LOGO} fallbackLabel={restaurantName} alt={restaurantName} variant="restaurant" />
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
        <WalkInForm disabledReason={walkInDisabledReason} onAddWalkIn={async (nameOrRoom, pax) => {
          if (weeklyModeUnknown) throw new Error('WEEKLY_MODE_NOT_VERIFIED');
          if (!weeklyPreview) return onAddWalkIn(nameOrRoom, pax);
          const clock = getMadridClock();
          const service = getOpenRestaurantServiceAt(serviceTabs, clock, verifiedWeeklyRows);
          if (!service || clock.date !== dayStatus.date) throw new Error('WALKIN_HOURS_CLOSED');
          return onAddWalkIn(nameOrRoom, pax, { service, date: clock.date, time: clock.time.slice(0, 5) });
        }} />

        <button className="manual-reservation-card" type="button" disabled={weeklyModeUnknown} onClick={() => setIsManualModalOpen(true)}>
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
            {visibleServiceTabs.length > 0 && (
              <div className="segmented-control today-service-tabs" aria-label="Servicio">
                {visibleServiceTabs.map((service) => (
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
            {weeklyPreview && scheduledTabs.status === 'unavailable' && (
              <span className="today-hours-warning" role="status">Horario semanal sin configurar o no disponible: se mantienen las pestañas habituales.</span>
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
                        <button
                          className={`balinese-paid-badge ${reservedReservation.balinesePaid ? 'is-paid' : 'is-pending'}`}
                          type="button"
                          onClick={() => void onBalinesePayment(reservedReservation.id, !reservedReservation.balinesePaid).catch(() => undefined)}
                          aria-label={reservedReservation.balinesePaid ? 'Marcar como no pagado' : 'Marcar como pagado'}
                        >
                          {reservedReservation.balinesePaid ? '● PAGADO' : 'NO PAGADO'}
                        </button>
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
        ) : visibleServiceTabs.length === 0 ? (
          <div className="sync-status today-no-services">No hay servicios abiertos hoy. Las reservas existentes siguen disponibles abajo.</div>
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

      {inactiveServiceReservations.length > 0 && <section className="table-section" aria-label="Reservas existentes de servicios cerrados o desactivados">
        <h2>Reservas existentes de servicios cerrados o desactivados</h2>
        <p className="weekly-hours-notice">Cerrar un día o desactivar un servicio no borra sus reservas actuales. Puedes seguir gestionándolas aquí.</p>
        {inactiveRestaurantReservations.length > 0 && <ReservationsTable
          reservations={inactiveRestaurantReservations} tableOptions={tableOptions} hasLoadedTables={hasLoadedTables}
          isLoadingTables={isLoadingTables} onEnsureTables={onEnsureTables} onUpdate={onUpdateReservation} onCancel={onCancelReservation}
        />}
        {inactiveBalineseReservations.map((reservation) => <article className="weekly-inactive-balinese" key={reservation.id}>
          <strong>Balinesa · {reservation.name || reservation.room || 'Sin nombre'}</strong>
          <span>{reservation.pax} pax · {reservation.balinesePackage || 'Paquete sin indicar'}</span>
          <button className="balinese-paid-badge" type="button" onClick={() => void onBalinesePayment(reservation.id, !reservation.balinesePaid).catch(() => undefined)}>
            {reservation.balinesePaid ? '● PAGADO' : 'NO PAGADO'}
          </button>
          <button className="danger-button compact-action" type="button" onClick={() => onCancelReservation(reservation)}>Cancelar</button>
        </article>)}
      </section>}

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
                <input value={manualDraft.date} type="date" onChange={(event) => weeklyPreview
                  ? changeManualDate(event.target.value) : updateManualDraft('date', event.target.value)} />
              </label>
              {weeklyPreview && <label>
                Servicio
                <select value={manualDraft.service} onChange={(event) => {
                  setManualDraft((current) => ({ ...current, service: event.target.value as ServiceWithHours | '', time: '' }));
                  setManualError('');
                }}>
                  <option value="">Selecciona un servicio</option>
                  {manualServices.map((service) => <option key={service} value={service}>{service}</option>)}
                </select>
              </label>}
              <label>
                Hora
                <select value={manualDraft.time} disabled={weeklyPreview && !manualDraft.service}
                  onChange={(event) => updateManualDraft('time', event.target.value)}>
                  {weeklyPreview && <option value="">Selecciona una hora</option>}
                  {(weeklyPreview ? manualSlots : timeSlots).map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </label>
              {weeklyPreview && manualServices.length === 0 && <p className="manual-hours-status" role="status">
                No hay servicios de restaurante abiertos para esta fecha, o no se pudo verificar el horario.
              </p>}
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
              <label>
                Pago inicial
                <select value={otherDayBalineseDraft.paid ? 'paid' : 'unpaid'} onChange={(event) => updateOtherDayBalineseDraft('paid', event.target.value === 'paid')}>
                  <option value="unpaid">NO PAGADO</option>
                  <option value="paid">PAGADO</option>
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

