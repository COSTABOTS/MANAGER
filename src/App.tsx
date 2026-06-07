import { useEffect, useMemo, useState } from 'react';
import type { SetStateAction } from 'react';
import { Layout } from './components/Layout';
import { Control } from './pages/Control';
import { Feedbacks } from './pages/Feedbacks';
import { Reservations } from './pages/Reservations';
import { Settings } from './pages/Settings';
import { Shows } from './pages/Shows';
import { Today } from './pages/Today';
import { mockReservations, todayState } from './mock';
import { loadReservations as loadReservationsFromWebhook } from './services/api';
import { loadDateBookingStatusFromStorage, saveDateBookingStatusToStorage } from './services/dateBookingStatusStorage';
import { loadSettingsFromStorage, saveSettingsToStorage } from './services/settingsStorage';
import { sendWebhook } from './services/webhookClient';
import { requireNameOrRoom, requireWebhookFields } from './services/webhookValidation';
import type { DateBookingStatus, DateBookingStatusValue, DayState, ManagerSettings, Reservation, WalkInPayload } from './types';
import { getCurrentTime, getLocalDateString, normalizeDateForCompare } from './utils/date';
import { createReservationId } from './utils/reservationId';
import { isActiveReservation } from './utils/reservationStatus';

export type PageKey = 'today' | 'reservations' | 'control' | 'feedbacks' | 'shows' | 'settings';

export function App() {
  const [activePage, setActivePage] = useState<PageKey>('today');
  const [reservations, setReservations] = useState(mockReservations);
  const [dayStatus] = useState<DayState>({
    ...todayState,
    date: getLocalDateString(new Date()),
  });
  const [settings, setSettings] = useState<ManagerSettings>(() => loadSettingsFromStorage());
  const [dateBookingStatus, setDateBookingStatus] = useState<DateBookingStatus>(() => loadDateBookingStatusFromStorage());
  const [lastSync, setLastSync] = useState('Datos mock cargados');
  const [isLoadingReservations, setIsLoadingReservations] = useState(false);

  function updateSettings(action: SetStateAction<ManagerSettings>) {
    setSettings((current) => {
      const nextSettings = typeof action === 'function' ? action(current) : action;
      saveSettingsToStorage(nextSettings);
      return nextSettings;
    });
  }

  const todaysReservations = useMemo(
    () =>
      reservations
        .filter((reservation) => normalizeDateForCompare(reservation.date) === dayStatus.date && isActiveReservation(reservation))
        .sort((a, b) => a.time.localeCompare(b.time)),
    [dayStatus.date, reservations],
  );

  const totalPax = useMemo(
    () => todaysReservations.reduce((total, reservation) => total + reservation.pax, 0),
    [todaysReservations],
  );

  const arrivals = useMemo(
    () => todaysReservations.filter((reservation) => reservation.arrived).length,
    [todaysReservations],
  );

  const occupancyPercent = Math.min(100, Math.round((totalPax / settings.totalCapacity) * 100));

  const activeTableOptions = useMemo(
    () => settings.tables.filter((table) => table.active).map((table) => table.name),
    [settings.tables],
  );

  const todayBookingStatus = dateBookingStatus[dayStatus.date] ?? (settings.reservasActivas ? 'open' : 'fully_booked');
  const isTodayFullyBooked = todayBookingStatus === 'fully_booked';

  useEffect(() => {
    if (!settings.webhookLeerReservas.trim()) {
      return;
    }

    void loadReservations();
  }, [settings.googleSheetId, settings.webhookLeerReservas]);

  function getReservationSyncId(reservation: Reservation) {
    return reservation.idReserva || reservation.id;
  }

  function canSyncReservationAction(reservation: Reservation, actionLabel: string) {
    if (!getReservationSyncId(reservation) || !reservation.date || !reservation.time) {
      setLastSync(`Faltan datos para sincronizar ${actionLabel}`);
      return false;
    }

    return true;
  }

  async function syncWebhook(webhookUrl: string, payload: unknown, missingMessage = 'Webhook no configurado') {
    const result = await sendWebhook(webhookUrl, payload);
    if (result.success) {
      setLastSync('Sincronizado correctamente');
      return result;
    }

    setLastSync(result.skipped ? missingMessage : 'Cambio guardado en la app, pero no sincronizado');
    return result;
  }

  async function loadReservations() {
    if (!settings.webhookLeerReservas.trim()) {
      setLastSync('Webhook leer reservas no configurado');
      return;
    }

    setIsLoadingReservations(true);

    try {
      const nextReservations = await loadReservationsFromWebhook(settings.webhookLeerReservas, settings.googleSheetId);
      setReservations(nextReservations);
      setLastSync('Datos actualizados correctamente');
    } catch (error) {
      console.error('GET_RESERVATIONS error', error);
      setLastSync('No se pudieron cargar las reservas');
    } finally {
      setIsLoadingReservations(false);
    }
  }

  async function syncValidatedWebhook(
    webhookUrl: string,
    payload: Record<string, unknown>,
    requiredFields: string[],
    actionLabel: string,
    missingMessage = 'Webhook no configurado',
    requiresNameOrRoom = false,
  ) {
    const requiredValidation = requireWebhookFields(payload, requiredFields, actionLabel);
    if (!requiredValidation.valid) {
      setLastSync(requiredValidation.message);
      return { success: false, skipped: true, error: requiredValidation.message };
    }

    if (requiresNameOrRoom) {
      const nameValidation = requireNameOrRoom(payload, actionLabel);
      if (!nameValidation.valid) {
        setLastSync(nameValidation.message);
        return { success: false, skipped: true, error: nameValidation.message };
      }
    }

    if (payload.id_reserva) {
      console.info('[Safari Manager] sync reservation', {
        accion: payload.accion,
        id_reserva: payload.id_reserva,
      });
    }

    return syncWebhook(webhookUrl, payload, missingMessage);
  }

  async function handleSettingsSave(nextSettings: ManagerSettings): Promise<'success' | 'error' | 'skipped'> {
    updateSettings(nextSettings);
    setLastSync('Configuración guardada correctamente');

    if (!nextSettings.webhookSettings.trim()) {
      return 'skipped';
    }

    const result = await sendWebhook(nextSettings.webhookSettings, {
      accion: 'actualizar_settings',
      settings: nextSettings,
    });

    if (result.success) {
      setLastSync('Sincronizado correctamente');
      return 'success';
    }

    setLastSync('Configuración guardada localmente, pero no sincronizada');
    return 'error';
  }

  function updateDateBookingStatus(date: string, status: DateBookingStatusValue) {
    setDateBookingStatus((current) => {
      const nextStatus = {
        ...current,
        [date]: status,
      };
      saveDateBookingStatusToStorage(nextStatus);
      return nextStatus;
    });
    setLastSync('Estado de reservas actualizado');
    void syncValidatedWebhook(settings.webhookFullyBooked, {
      accion: 'actualizar_fully_booked',
      fecha: date,
      fullyBooked: status === 'fully_booked',
    }, ['fecha'], 'fully booked');
    // Future Make integration: updateDateBookingStatus(date, status)
  }

  function handleBookingStatus() {
    updateDateBookingStatus(dayStatus.date, isTodayFullyBooked ? 'open' : 'fully_booked');
    // Future Make integration: updateBookingStatus({ bookingsOpen, fullyBooked })
  }

  async function handleAddWalkIn(nameOrRoom: string, pax: number) {
    const idReserva = createReservationId();
    const payload: WalkInPayload = {
      nameOrRoom,
      pax,
      date: dayStatus.date,
      time: getCurrentTime(),
      status: 'CONFIRMADA',
      source: 'WALKIN',
    };

    const optimisticReservation: Reservation = {
      id: idReserva,
      idReserva,
      name: nameOrRoom,
      room: /^\d+$/.test(nameOrRoom) ? nameOrRoom : '',
      date: payload.date,
      time: payload.time,
      pax,
      specialRequest: '',
      status: 'CONFIRMADA',
      source: 'WALKIN',
      table: '',
      arrived: true,
    };

    setReservations((current) => [...current, optimisticReservation]);
    setLastSync('Mesa añadida correctamente');
    void syncValidatedWebhook(settings.webhookWalkin, {
      accion: 'crear_walkin',
      id_reserva: optimisticReservation.idReserva,
      ID_RESERVA: optimisticReservation.idReserva,
      nombre: optimisticReservation.name,
      habitacion: optimisticReservation.room,
      fecha: optimisticReservation.date,
      hora: optimisticReservation.time,
      pax: optimisticReservation.pax,
      origen: 'WALK-IN',
      estado: 'CONFIRMADA',
      llego: true,
    }, ['id_reserva', 'fecha', 'hora', 'pax'], 'walk-in', 'Webhook no configurado', true);
  }

  function addManualReservation(reservation: Omit<Reservation, 'id' | 'idReserva' | 'status' | 'source' | 'table' | 'arrived'>) {
    const idReserva = createReservationId();
    const manualReservation: Reservation = {
      ...reservation,
      id: idReserva,
      idReserva,
      status: 'CONFIRMADA',
      source: 'MANUAL',
      table: '',
      arrived: false,
    };

    setReservations((current) => [...current, manualReservation]);
    setLastSync('Reserva añadida correctamente');
    void syncValidatedWebhook(
      settings.webhookReservas,
      {
        accion: 'crear_reserva_manual',
        id_reserva: manualReservation.idReserva,
        ID_RESERVA: manualReservation.idReserva,
        nombre: manualReservation.name,
        habitacion: manualReservation.room,
        telefono: manualReservation.phone,
        fecha: manualReservation.date,
        hora: manualReservation.time,
        pax: manualReservation.pax,
        peticiones: manualReservation.specialRequest,
        origen: 'MANUAL',
        estado: 'CONFIRMADA',
      },
      ['id_reserva', 'fecha', 'hora', 'pax'],
      'reserva manual',
      'Webhook de reservas no configurado',
      true,
    );
    // Future Make integration: addManualReservation(reservation)
  }

  async function handleUpdateReservation(id: string, field: 'table' | 'arrived', value: string | boolean) {
    const currentReservation = reservations.find((reservation) => reservation.id === id);
    if (!currentReservation) {
      return;
    }

    const nextReservation = {
      ...currentReservation,
      [field]: value,
    };

    setReservations((current) =>
      current.map((reservation) => (reservation.id === id ? { ...reservation, [field]: value } : reservation)),
    );
    setLastSync('Guardando cambio...');

    if (!canSyncReservationAction(nextReservation, field === 'arrived' ? 'la llegada' : 'la mesa')) {
      return;
    }

    if (field === 'arrived') {
      await syncValidatedWebhook(settings.webhookLlegada, {
        accion: 'actualizar_llegada',
        id_reserva: getReservationSyncId(nextReservation),
        ID_RESERVA: getReservationSyncId(nextReservation),
        fecha: nextReservation.date,
        hora: nextReservation.time,
        nombre: nextReservation.name,
        habitacion: nextReservation.room,
        llego: nextReservation.arrived,
      }, ['id_reserva', 'fecha', 'hora'], 'la llegada');
      return;
    }

    await syncValidatedWebhook(settings.webhookMesa, {
      accion: 'actualizar_mesa',
      id_reserva: getReservationSyncId(nextReservation),
      ID_RESERVA: getReservationSyncId(nextReservation),
      fecha: nextReservation.date,
      hora: nextReservation.time,
      nombre: nextReservation.name,
      habitacion: nextReservation.room,
      mesa: nextReservation.table,
    }, ['id_reserva', 'fecha', 'hora'], 'la mesa');
  }

  function renderPage() {
    if (activePage === 'reservations') {
      return <Reservations reservations={reservations} />;
    }

    if (activePage === 'control') {
      return (
        <Control
          dateBookingStatus={dateBookingStatus}
          reservations={reservations}
          totalCapacity={settings.totalCapacity}
          onDateBookingStatusChange={updateDateBookingStatus}
        />
      );
    }

    if (activePage === 'feedbacks') {
      return <Feedbacks />;
    }

    if (activePage === 'shows') {
      return <Shows webhookShows={settings.webhookShows} />;
    }

    if (activePage === 'settings') {
      return <Settings settings={settings} reservations={reservations} onSettingsSave={handleSettingsSave} />;
    }

    return (
      <Today
        dayStatus={{
          ...dayStatus,
          bookingsOpen: !isTodayFullyBooked,
          fullyBooked: isTodayFullyBooked,
        }}
        lastSync={lastSync}
        restaurantName={settings.restaurantName}
        openingTime={settings.openingTime}
        closingTime={settings.closingTime}
        bookingInterval={settings.bookingInterval}
        reservations={todaysReservations}
        tableOptions={activeTableOptions}
        totalPax={totalPax}
        arrivals={arrivals}
        occupancyPercent={occupancyPercent}
        totalCapacity={settings.totalCapacity}
        onAddWalkIn={handleAddWalkIn}
        onAddManualReservation={addManualReservation}
        onBookingStatus={handleBookingStatus}
        onUpdateReservation={handleUpdateReservation}
        onRefreshReservations={loadReservations}
        isRefreshingReservations={isLoadingReservations}
      />
    );
  }

  return (
    <Layout
      activePage={activePage}
      restaurantName={settings.restaurantName}
      onNavigate={setActivePage}
    >
      {renderPage()}
    </Layout>
  );
}
