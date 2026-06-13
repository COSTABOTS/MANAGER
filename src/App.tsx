import { useEffect, useMemo, useState } from 'react';
import type { SetStateAction } from 'react';
import { Layout } from './components/Layout';
import { LoginScreen } from './components/LoginScreen';
import { Control } from './pages/Control';
import { Feedbacks } from './pages/Feedbacks';
import { Reports } from './pages/Reports';
import { Reservations } from './pages/Reservations';
import { Settings } from './pages/Settings';
import { Shows } from './pages/Shows';
import { Today } from './pages/Today';
import { mockReservations, todayState } from './mock';
import { loadReservations as loadReservationsFromWebhook } from './services/api';
import {
  CLIENT_CONFIG_KEY,
  LOGIN_FLAG_KEY,
  getClientConfig,
  getClientSheetId,
  getClientWebhook,
  isValidClientConfig,
  normalizeClientConfig,
  populateAdminFromClientConfig,
} from './services/clientConfig';
import type { ExternalClientConfig } from './services/clientConfig';
import { clearDateBookingStatusStorage, loadDateBookingStatusFromStorage, saveDateBookingStatusToStorage } from './services/dateBookingStatusStorage';
import { clearSettingsStorage, loadSettingsFromStorage, saveSettingsToStorage } from './services/settingsStorage';
import { loadRestaurantTables, saveRestaurantTable } from './services/tables';
import { sendWebhook } from './services/webhookClient';
import { requireNameOrRoom, requireWebhookFields } from './services/webhookValidation';
import type { DateBookingStatus, DateBookingStatusValue, DayState, ManagerSettings, Reservation, RestaurantTable, WalkInPayload } from './types';
import { buildCapacityPayload, generateTimeSlots } from './utils/capacity';
import { getCurrentTime, getLocalDateString, normalizeDateForCompare } from './utils/date';
import { createReservationId } from './utils/reservationId';
import { isActiveReservation } from './utils/reservationStatus';

export type PageKey = 'today' | 'reservations' | 'control' | 'reports' | 'feedbacks' | 'shows' | 'settings';

const LOGIN_WEBHOOK_URL = 'https://hook.eu1.make.com/nt1tpv599c07vq26u107ddgbsnjdpook';

function clearLoginSession() {
  sessionStorage.removeItem(LOGIN_FLAG_KEY);
  sessionStorage.removeItem(CLIENT_CONFIG_KEY);
  clearSettingsStorage();
  clearDateBookingStatusStorage();
}

function loadClientConfigFromSession() {
  try {
    const isLoggedIn = sessionStorage.getItem(LOGIN_FLAG_KEY) === 'true';
    const config = getClientConfig();

    if (!isLoggedIn || !isValidClientConfig(config)) {
      clearLoginSession();
      return null;
    }

    return config;
  } catch {
    clearLoginSession();
    return null;
  }
}

export function App() {
  const [activePage, setActivePage] = useState<PageKey>('today');
  const [clientConfig, setClientConfig] = useState<ExternalClientConfig | null>(() => loadClientConfigFromSession());
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [allReservations, setAllReservations] = useState<Reservation[]>(() => (clientConfig ? [] : mockReservations));
  const [dayStatus] = useState<DayState>({
    ...todayState,
    date: getLocalDateString(new Date()),
  });
  const [settings, setSettings] = useState<ManagerSettings>(() => {
    const storedSettings = loadSettingsFromStorage();
    const sessionConfig = loadClientConfigFromSession();
    return sessionConfig ? populateAdminFromClientConfig(storedSettings, sessionConfig) : storedSettings;
  });
  const [dateBookingStatus, setDateBookingStatus] = useState<DateBookingStatus>(() => (clientConfig ? {} : loadDateBookingStatusFromStorage()));
  const [lastSync, setLastSync] = useState('Datos mock cargados');
  const [isLoadingReservations, setIsLoadingReservations] = useState(false);
  const [restaurantTables, setRestaurantTables] = useState<RestaurantTable[]>([]);
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  const [tablesSyncMessage, setTablesSyncMessage] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [reservationToCancel, setReservationToCancel] = useState<Reservation | null>(null);

  function updateSettings(action: SetStateAction<ManagerSettings>) {
    setSettings((current) => {
      const nextSettings = typeof action === 'function' ? action(current) : action;
      saveSettingsToStorage(nextSettings);
      return nextSettings;
    });
  }

  const todayReservations = useMemo(
    () =>
      allReservations
        .filter((reservation) => normalizeDateForCompare(reservation.date) === dayStatus.date && isActiveReservation(reservation))
        .sort((a, b) => a.time.localeCompare(b.time)),
    [allReservations, dayStatus.date],
  );

  const reservationsList = useMemo(() => allReservations, [allReservations]);

  const totalPax = useMemo(
    () => todayReservations.reduce((total, reservation) => total + reservation.pax, 0),
    [todayReservations],
  );

  const arrivals = useMemo(
    () => todayReservations.filter((reservation) => reservation.arrived).length,
    [todayReservations],
  );

  const occupancyPercent = Math.min(100, Math.round((totalPax / settings.totalCapacity) * 100));

  const activeTableOptions = useMemo(
    () => restaurantTables.filter((table) => table.active).map((table) => table.name),
    [restaurantTables],
  );

  const todayBookingStatus = dateBookingStatus[dayStatus.date] ?? (settings.reservasActivas ? 'open' : 'fully_booked');
  const isTodayFullyBooked = todayBookingStatus === 'fully_booked';

  useEffect(() => {
    if (!clientConfig) {
      return;
    }

    void refreshManagerData();
  }, [clientConfig, settings.googleSheetId, settings.webhookLeerReservas, settings.webhookGetMesas]);

  useEffect(() => {
    if (clientConfig) {
      console.log('CLIENTE ACTIVO:', clientConfig.client_id, clientConfig.rest_nombre);
      console.log('WEBHOOKS ACTIVOS:', {
        get: clientConfig.webhook_get_reservas,
        manual: clientConfig.webhook_manual,
        walkin: clientConfig.webhook_walkin,
      });
      setAllReservations([]);
      setRestaurantTables([]);
      setTablesSyncMessage('');
      setDateBookingStatus({});
      setSettings((current) => populateAdminFromClientConfig(current, clientConfig));
      console.log('Admin cargado desde configuración cliente:', clientConfig.rest_nombre);
    }
  }, [clientConfig]);

  async function handleLogin(usuario: string, password: string) {
    setIsLoggingIn(true);
    setLoginError('');
    clearLoginSession();

    try {
      const response = await fetch(LOGIN_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ usuario, password }),
      });

      if (!response.ok) {
        throw new Error(`Login request failed with status ${response.status}`);
      }

      const loginResponse = (await response.json()) as ExternalClientConfig;

      if (!isValidClientConfig(loginResponse)) {
        clearLoginSession();
        setClientConfig(null);
        setLoginError('Usuario o contraseña incorrectos');
        return;
      }

      const config = normalizeClientConfig(loginResponse);
      sessionStorage.setItem(CLIENT_CONFIG_KEY, JSON.stringify(config));
      sessionStorage.setItem(LOGIN_FLAG_KEY, 'true');
      setAllReservations([]);
      setRestaurantTables([]);
      setTablesSyncMessage('');
      setClientConfig(config);
      setSettings((current) => populateAdminFromClientConfig(current, config));
      console.log('Cliente cargado:', config.rest_nombre);
      console.log('Admin cargado desde configuración cliente:', config.rest_nombre);
    } catch {
      clearLoginSession();
      setClientConfig(null);
      setLoginError('Usuario o contraseña incorrectos');
    } finally {
      setIsLoggingIn(false);
    }
  }

  function handleLogout() {
    clearLoginSession();
    setClientConfig(null);
    setRestaurantTables([]);
    setActivePage('today');
  }

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
    const reservationsWebhook = getClientWebhook('webhook_get_reservas');
    const sheetId = getClientSheetId();

    if (!reservationsWebhook.trim()) {
      setLastSync('Webhook leer reservas no configurado');
      return;
    }

    setIsLoadingReservations(true);

    try {
      const nextReservations = await loadReservationsFromWebhook(reservationsWebhook, sheetId);
      setAllReservations(nextReservations);
      setLastUpdatedAt(getCurrentTime({ includeSeconds: true }));
      setLastSync('Datos actualizados correctamente');
    } catch (error) {
      console.error('GET_RESERVATIONS error', error);
      setLastSync('No se pudieron cargar las reservas');
    } finally {
      setIsLoadingReservations(false);
    }
  }

  async function loadTables() {
    const tablesWebhook = getClientWebhook('webhook_get_mesas') || settings.webhookGetMesas;
    const sheetId = getClientSheetId();

    if (!tablesWebhook.trim()) {
      setRestaurantTables([]);
      setTablesSyncMessage('Webhook de mesas no configurado');
      return;
    }

    setIsLoadingTables(true);

    try {
      const nextTables = await loadRestaurantTables(tablesWebhook, sheetId, clientConfig?.client_id);
      setRestaurantTables(nextTables);
      setTablesSyncMessage(nextTables.length ? 'Mesas actualizadas correctamente' : 'No hay mesas configuradas para este restaurante.');
    } catch (error) {
      console.error('GET_MESAS error', error);
      setRestaurantTables([]);
      setTablesSyncMessage('No se pudieron cargar mesas');
    } finally {
      setIsLoadingTables(false);
    }
  }

  async function refreshManagerData() {
    await Promise.all([loadReservations(), loadTables()]);
  }

  async function syncTable(action: 'create' | 'update' | 'deactivate' | 'delete', table: RestaurantTable) {
    const tableWebhook = getClientWebhook('webhook_save_mesa') || settings.webhookSaveMesa;

    if (!tableWebhook.trim()) {
      setTablesSyncMessage('Webhook de mesas no configurado');
      return;
    }

    if (action === 'delete' && !table.mesaId) {
      setTablesSyncMessage('No se puede borrar una mesa sin ID_MESA');
      return;
    }

    try {
      await saveRestaurantTable(tableWebhook, {
        action,
        table,
        clientId: clientConfig?.client_id,
      });
      setTablesSyncMessage('Mesa sincronizada correctamente');
      await loadTables();
    } catch (error) {
      console.error('SAVE_MESA error', error);
      setTablesSyncMessage('No se pudo guardar la mesa');
    }
  }

  async function handleCreateTable(table: Omit<RestaurantTable, 'id' | 'active'>) {
    const nextTable: RestaurantTable = {
      ...table,
      id: `MESA-${Date.now()}`,
      active: true,
    };

    await syncTable('create', nextTable);
  }

  async function handleUpdateTable(table: RestaurantTable) {
    await syncTable('update', table);
  }

  async function handleDeactivateTable(table: RestaurantTable) {
    await syncTable('deactivate', { ...table, active: false });
  }

  async function handleDeleteTable(table: RestaurantTable) {
    await syncTable('delete', table);
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
    const capacitySlots = generateTimeSlots(nextSettings.openingTime, nextSettings.closingTime, nextSettings.bookingInterval);
    const capacityPayload = buildCapacityPayload(nextSettings.restaurantName, nextSettings.slotCapacity, capacitySlots);
    const settingsWebhook = getClientWebhook('webhook_settings');
    const capacityWebhook = getClientWebhook('webhook_capacidad');
    setLastSync('Configuración guardada correctamente');

    if (!settingsWebhook.trim() && capacityWebhook.trim()) {
      const capacityResult = await sendWebhook(
        capacityWebhook,
        capacityPayload,
      );

      if (capacityResult.success) {
        setLastSync('Sincronizado correctamente');
        return 'success';
      }

      setLastSync('ConfiguraciÃ³n guardada localmente, pero no sincronizada');
      return 'error';
    }

    if (!settingsWebhook.trim()) {
      setLastSync('Webhook de capacidad no configurado');
      return 'skipped';
    }

    const settingsResult = await sendWebhook(settingsWebhook, {
      accion: 'actualizar_settings',
      settings: nextSettings,
    });

    if (!settingsResult.success) {
      setLastSync('ConfiguraciÃ³n guardada localmente, pero no sincronizada');
      return 'error';
    }

    if (!capacityWebhook.trim()) {
      setLastSync('Webhook de capacidad no configurado');
      return 'skipped';
    }

    const capacityResult = await sendWebhook(
      capacityWebhook,
      capacityPayload,
    );

    if (capacityResult.success) {
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
    void syncValidatedWebhook(getClientWebhook('webhook_fully_booked'), {
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

    setAllReservations((current) => [...current, optimisticReservation]);
    setLastSync('Mesa añadida correctamente');
    void syncValidatedWebhook(getClientWebhook('webhook_walkin'), {
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

    setAllReservations((current) => [...current, manualReservation]);
    setLastSync('Reserva añadida correctamente');
    void syncValidatedWebhook(
      getClientWebhook('webhook_manual'),
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
    const currentReservation = allReservations.find((reservation) => reservation.id === id);
    if (!currentReservation) {
      return;
    }

    const nextReservation = {
      ...currentReservation,
      [field]: value,
    };

    setAllReservations((current) =>
      current.map((reservation) => (reservation.id === id ? { ...reservation, [field]: value } : reservation)),
    );
    setLastSync('Guardando cambio...');

    if (!canSyncReservationAction(nextReservation, field === 'arrived' ? 'la llegada' : 'la mesa')) {
      return;
    }

    if (field === 'arrived') {
      await syncValidatedWebhook(getClientWebhook('webhook_arrived'), {
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

    await syncValidatedWebhook(getClientWebhook('webhook_mesa'), {
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

  async function confirmCancelReservation() {
    if (!reservationToCancel) {
      return;
    }

    const cancelWebhook = getClientWebhook('webhook_cancel');

    if (!cancelWebhook.trim()) {
      setLastSync('Webhook cancelar reserva no configurado');
      return;
    }

    const result = await sendWebhook<{ ok?: boolean; estado?: string }>(cancelWebhook, {
      action: 'CANCEL_BY_ID',
      id_reserva: reservationToCancel.idReserva,
    });

    if (result.success && result.data?.ok === true) {
      setAllReservations((current) =>
        current.map((reservation) =>
          reservation.idReserva === reservationToCancel.idReserva ? { ...reservation, status: 'CANCELADA' } : reservation,
        ),
      );
      setReservationToCancel(null);
      setLastSync('Reserva cancelada');
      return;
    }

    setLastSync('No se pudo cancelar la reserva');
  }

  function renderPage() {
    if (activePage === 'reservations') {
      return (
        <Reservations
          reservations={reservationsList}
          onRefreshReservations={refreshManagerData}
          isRefreshingReservations={isLoadingReservations}
          lastUpdatedAt={lastUpdatedAt}
          onCancelReservation={setReservationToCancel}
        />
      );
    }

    if (activePage === 'control') {
      return (
        <Control
          dateBookingStatus={dateBookingStatus}
          reservations={allReservations}
          totalCapacity={settings.totalCapacity}
          onDateBookingStatusChange={updateDateBookingStatus}
        />
      );
    }

    if (activePage === 'feedbacks') {
      return <Feedbacks />;
    }

    if (activePage === 'reports') {
      return <Reports reservations={allReservations} />;
    }

    if (activePage === 'shows') {
      return <Shows webhookShows={getClientWebhook('webhook_shows')} />;
    }

    if (activePage === 'settings') {
      return (
        <Settings
          settings={settings}
          restaurantTables={restaurantTables}
          tableSyncMessage={tablesSyncMessage}
          isLoadingTables={isLoadingTables}
          onRefreshTables={loadTables}
          onCreateTable={handleCreateTable}
          onUpdateTable={handleUpdateTable}
          onDeactivateTable={handleDeactivateTable}
          onDeleteTable={handleDeleteTable}
          onSettingsSave={handleSettingsSave}
        />
      );
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
        restaurantLogoUrl={settings.restaurantLogoUrl}
        openingTime={settings.openingTime}
        closingTime={settings.closingTime}
        bookingInterval={settings.bookingInterval}
        reservations={todayReservations}
        tableOptions={activeTableOptions}
        totalPax={totalPax}
        arrivals={arrivals}
        occupancyPercent={occupancyPercent}
        totalCapacity={settings.totalCapacity}
        onAddWalkIn={handleAddWalkIn}
        onAddManualReservation={addManualReservation}
        onBookingStatus={handleBookingStatus}
        onUpdateReservation={handleUpdateReservation}
        onCancelReservation={setReservationToCancel}
        onRefreshReservations={refreshManagerData}
        isRefreshingReservations={isLoadingReservations}
        lastUpdatedAt={lastUpdatedAt}
      />
    );
  }

  if (!clientConfig) {
    return <LoginScreen error={loginError} isLoading={isLoggingIn} onLogin={handleLogin} />;
  }

  return (
    <Layout
      activePage={activePage}
      restaurantName={settings.restaurantName}
      restaurantLogoUrl={settings.restaurantLogoUrl}
      onNavigate={setActivePage}
      onLogout={handleLogout}
    >
      {renderPage()}
      {reservationToCancel && (
        <div className="modal-backdrop" role="presentation" onPointerDown={() => setReservationToCancel(null)}>
          <div className="show-modal cancel-modal" role="dialog" aria-modal="true" onPointerDown={(event) => event.stopPropagation()}>
            <div className="section-title compact">
              <div>
                <p className="eyebrow">Cancelar reserva</p>
                <h2>¿Cancelar esta reserva?</h2>
              </div>
            </div>
            <div className="cancel-summary">
              <strong>{reservationToCancel.name || reservationToCancel.room || 'Reserva sin nombre'}</strong>
              <span>{reservationToCancel.date} · {reservationToCancel.time} · {reservationToCancel.pax} pax</span>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setReservationToCancel(null)}>
                No, mantener
              </button>
              <button className="danger-button" type="button" onClick={() => void confirmCancelReservation()}>
                Sí, cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
