import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, SetStateAction } from 'react';
import { Layout } from './components/Layout';
import { LoginScreen } from './components/LoginScreen';
import { BrandLogo } from './components/BrandLogo';
import { DEFAULT_COSTABOTS_LOGO } from './config/branding';
import { Control } from './pages/Control';
import { FeedbackPublic } from './pages/FeedbackPublic';
import { Feedbacks } from './pages/Feedbacks';
import { Reports } from './pages/Reports';
import { Reservations } from './pages/Reservations';
import { Settings } from './pages/Settings';
import { Shows } from './pages/Shows';
import { Today } from './pages/Today';
import { mockReservations, todayState } from './mock';
import { loadReservations as loadReservationsFromWebhook } from './services/api';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';
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
import { loadFeedbacks as loadFeedbacksFromWebhook } from './services/feedbacks';
import type { Feedback } from './services/feedbacks';
import { loadCapacitySettings } from './services/capacitySettings';
import { applyOperationalDefaults, applyOperationalSettings, loadOperationalSettings, saveOperationalSettings } from './services/operationalSettings';
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
const SETTINGS_WEBHOOK_FALLBACK = '';

console.log('[App loaded]', window.location.pathname);

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

function pickSupabaseValue(row: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
}

function toSupabaseBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', '1', 'yes', 'si', 'sí', 'active'].includes(String(value ?? '').trim().toLowerCase());
}

interface ManagerAppProps {
  onLogoutComplete?: () => void;
}

function ManagerApp({ onLogoutComplete }: ManagerAppProps = {}) {
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
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [isLoadingFeedbacks, setIsLoadingFeedbacks] = useState(false);
  const [feedbacksMessage, setFeedbacksMessage] = useState('');
  const [feedbacksLoaded, setFeedbacksLoaded] = useState(false);
  const [isLoadingOperationalSettings, setIsLoadingOperationalSettings] = useState(false);
  const [operationalSettingsLoaded, setOperationalSettingsLoaded] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
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
  const isDemoClient = Boolean(clientConfig && (clientConfig.IS_DEMO === true || clientConfig.is_demo === true || toSupabaseBoolean(clientConfig.IS_DEMO) || toSupabaseBoolean(clientConfig.is_demo)));

  useEffect(() => {
    if (!clientConfig) {
      return;
    }

    void refreshManagerData();
  }, [clientConfig, settings.googleSheetId, settings.webhookLeerReservas, settings.webhookGetMesas, settings.webhookFeedbacks]);

  useEffect(() => {
    if (activePage === 'feedbacks' && !feedbacksLoaded && !isLoadingFeedbacks) {
      void loadFeedbacks();
    }
  }, [activePage, feedbacksLoaded, isLoadingFeedbacks]);

  useEffect(() => {
    if (activePage === 'settings' && !operationalSettingsLoaded && !isLoadingOperationalSettings) {
      void loadSettingsFromMake();
    }
  }, [activePage, operationalSettingsLoaded, isLoadingOperationalSettings]);

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
      setFeedbacks([]);
      setFeedbacksLoaded(false);
      setOperationalSettingsLoaded(false);
      setSettingsMessage('');
      setTablesSyncMessage('');
      setDateBookingStatus({});
      setSettings((current) => populateAdminFromClientConfig(current, clientConfig));
      console.log('Admin cargado desde configuración cliente:', clientConfig.rest_nombre);
      void loadSettingsFromMake();
    }
  }, [clientConfig]);

  async function handleLogin(usuario: string, password: string) {
    setIsLoggingIn(true);
    setLoginError('');
    clearLoginSession();

    try {
      console.log('[Login debug] URL llamada:', LOGIN_WEBHOOK_URL);
      const response = await fetch(LOGIN_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ usuario, password }),
      });

      console.log('[Login debug] Status HTTP recibido:', response.status, response.statusText);

      if (!response.ok) {
        console.warn('[Login debug] Punto de error: response.ok es false. Se mostrará "Usuario o contraseña incorrectos".');
        throw new Error(`Login request failed with status ${response.status}`);
      }

      const loginResponse = (await response.json()) as ExternalClientConfig;
      console.log('[Login debug] JSON completo recibido:', loginResponse);
      console.log('[Login debug] Valor de response.success:', loginResponse.success);
      const loginDebugSnapshot = {
        success: loginResponse.success,
        client_id: loginResponse.client_id,
        rest_nombre: loginResponse.rest_nombre,
      };

      if (!isValidClientConfig(loginResponse)) {
        console.warn('[Login debug] Punto de error: isValidClientConfig(loginResponse) es false. Se mostrará "Usuario o contraseña incorrectos".', {
          success: loginDebugSnapshot.success,
          client_id: loginDebugSnapshot.client_id,
          rest_nombre: loginDebugSnapshot.rest_nombre,
        });
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
      setFeedbacks([]);
      setFeedbacksLoaded(false);
      setOperationalSettingsLoaded(false);
      setSettingsMessage('');
      setTablesSyncMessage('');
      setClientConfig(config);
      setSettings((current) => populateAdminFromClientConfig(current, config));
      console.log('Cliente cargado:', config.rest_nombre);
      console.log('Admin cargado desde configuración cliente:', config.rest_nombre);
    } catch (error) {
      console.warn('[Login debug] Punto de error: catch ejecutado. Se mostrará "Usuario o contraseña incorrectos".', error);
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
    setFeedbacks([]);
    setFeedbacksLoaded(false);
    setOperationalSettingsLoaded(false);
    setSettingsMessage('');
    setActivePage('today');
    onLogoutComplete?.();
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

  async function loadFeedbacks() {
    const feedbacksWebhook = getClientWebhook('webhook_feedbacks') || settings.webhookFeedbacks;
    const sheetId = getClientSheetId();

    if (!feedbacksWebhook.trim()) {
      setFeedbacks([]);
      setFeedbacksLoaded(true);
      setFeedbacksMessage('Webhook de feedbacks no configurado.');
      return;
    }

    setIsLoadingFeedbacks(true);

    try {
      const nextFeedbacks = await loadFeedbacksFromWebhook(feedbacksWebhook, sheetId);
      setFeedbacks(nextFeedbacks);
      setFeedbacksLoaded(true);
      setFeedbacksMessage(nextFeedbacks.length ? 'Feedbacks actualizados correctamente' : 'No hay feedbacks todavía.');
    } catch (error) {
      console.error('GET_FEEDBACKS error', error);
      setFeedbacks([]);
      setFeedbacksLoaded(true);
      setFeedbacksMessage('No se pudieron cargar los feedbacks');
    } finally {
      setIsLoadingFeedbacks(false);
    }
  }

  function getOperationalSettingsWebhook() {
    return getClientWebhook('webhook_settings') || settings.webhookSettings || SETTINGS_WEBHOOK_FALLBACK;
  }

  function getCapacityReadWebhook() {
    const getCapacityUrl = getClientWebhook('webhook_get_capacidad') || settings.webhookGetCapacidad;
    if (!getCapacityUrl.trim()) {
      console.warn('No hay WEBHOOK_GET_CAPACIDAD configurado; usando fallback');
    }
    return getCapacityUrl || getClientWebhook('webhook_capacidad') || settings.webhookSettingsCapacityUrl;
  }

  function getCapacitySaveWebhook() {
    return getClientWebhook('webhook_capacidad') || settings.webhookSettingsCapacityUrl;
  }

  function buildVisibleSlotCapacity(sourceSettings: ManagerSettings, loadedCapacity: Record<string, number> = {}) {
    const visibleSlots = generateTimeSlots(sourceSettings.openingTime, sourceSettings.closingTime, sourceSettings.bookingInterval);
    const fallbackCapacity = sourceSettings.totalCapacity || 40;

    return visibleSlots.reduce<Record<string, number>>((slots, slot) => {
      slots[slot] = loadedCapacity[slot] ?? sourceSettings.slotCapacity[slot] ?? fallbackCapacity;
      return slots;
    }, {});
  }

  async function loadCapacityFromMake(baseSettings?: ManagerSettings) {
    console.log('LOAD CAPACITY START');
    const capacityWebhook = getCapacityReadWebhook();
    console.log('GET CAPACITY webhook URL usado:', capacityWebhook);

    if (!capacityWebhook.trim()) {
      setSettings((current) => {
        const mergedSource = baseSettings ?? current;
        const nextSettings = {
          ...mergedSource,
          slotCapacity: buildVisibleSlotCapacity(mergedSource),
        };
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      setSettingsMessage((current) =>
        current && current !== 'Cargando SETTINGS...'
          ? `${current} Capacidad no configurada.`
          : 'Webhook de capacidad no configurado. Usando defaults seguros.',
      );
      return false;
    }

    try {
      const loadedCapacity = await loadCapacitySettings(capacityWebhook);
      setSettings((current) => {
        const mergedSource = baseSettings ?? current;
        const nextSettings = {
          ...mergedSource,
          slotCapacity: buildVisibleSlotCapacity(mergedSource, loadedCapacity),
        };
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      return true;
    } catch (error) {
      console.error('error al cargar capacidad', error);
      setSettings((current) => {
        const mergedSource = baseSettings ?? current;
        const nextSettings = {
          ...mergedSource,
          slotCapacity: buildVisibleSlotCapacity(mergedSource),
        };
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      setSettingsMessage('No se pudo cargar CAPACIDAD. Usando defaults seguros.');
      return false;
    }
  }

  async function loadSettingsFromMake() {
    const settingsWebhook = getOperationalSettingsWebhook();

    if (!settingsWebhook.trim()) {
      let nextSettingsSnapshot: ManagerSettings | null = null;
      setSettings((current) => {
        const nextSettings = {
          ...applyOperationalDefaults(current),
        };
        nextSettings.slotCapacity = buildVisibleSlotCapacity(nextSettings);
        nextSettingsSnapshot = nextSettings;
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      setOperationalSettingsLoaded(true);
      setSettingsMessage('Webhook SETTINGS no configurado. Usando defaults operativos.');
      await loadCapacityFromMake(nextSettingsSnapshot ?? undefined);
      return;
    }

    setIsLoadingOperationalSettings(true);
    setSettingsMessage('Cargando SETTINGS...');

    try {
      const rawSettings = await loadOperationalSettings(settingsWebhook);
      let nextSettingsSnapshot: ManagerSettings | null = null;
      setSettings((current) => {
        const nextSettings = applyOperationalSettings(current, rawSettings);
        nextSettings.slotCapacity = buildVisibleSlotCapacity(nextSettings);
        nextSettingsSnapshot = nextSettings;
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      const capacityLoaded = await loadCapacityFromMake(nextSettingsSnapshot ?? undefined);
      setOperationalSettingsLoaded(true);
      if (capacityLoaded) {
        setSettingsMessage('SETTINGS cargados correctamente');
      }
    } catch (error) {
      console.error('error al cargar SETTINGS', error);
      let nextSettingsSnapshot: ManagerSettings | null = null;
      setSettings((current) => {
        const nextSettings = applyOperationalDefaults(current);
        nextSettings.slotCapacity = buildVisibleSlotCapacity(nextSettings);
        nextSettingsSnapshot = nextSettings;
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      await loadCapacityFromMake(nextSettingsSnapshot ?? undefined);
      setOperationalSettingsLoaded(true);
      setSettingsMessage('No se pudieron cargar SETTINGS. Usando defaults operativos.');
    } finally {
      setIsLoadingOperationalSettings(false);
    }
  }

  async function refreshManagerData() {
    await Promise.all([loadReservations(), loadTables(), loadFeedbacks()]);
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
    const settingsWebhook = getOperationalSettingsWebhook();
    const capacityWebhook = getCapacitySaveWebhook();
    console.log('SAVE CAPACITY webhook URL:', capacityWebhook);
    setLastSync('Configuracion guardada correctamente');

    if (!settingsWebhook.trim()) {
      setSettingsMessage('Webhook SETTINGS no configurado');
      return 'skipped';
    }

    try {
      await saveOperationalSettings(settingsWebhook, nextSettings);
      setSettingsMessage('SETTINGS guardados correctamente');
    } catch (error) {
      console.error('error al guardar SETTINGS', error);
      setSettingsMessage('No se pudieron guardar SETTINGS');
      setLastSync('Configuracion guardada localmente, pero no sincronizada');
      return 'error';
    }

    if (!capacityWebhook.trim()) {
      setLastSync('Webhook de capacidad no configurado');
      return 'success';
    }

    console.log('capacidad guardada', capacityPayload);
    const capacityResult = await sendWebhook(
      capacityWebhook,
      capacityPayload,
    );

    if (capacityResult.success) {
      setLastSync('Sincronizado correctamente');
      return 'success';
    }

    console.error('error al guardar capacidad', capacityResult.error);
    setLastSync('Configuracion guardada localmente, pero no sincronizada');
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
      return (
        <Feedbacks
          feedbacks={feedbacks}
          message={feedbacksMessage}
          isLoading={isLoadingFeedbacks}
          onRefresh={loadFeedbacks}
        />
      );
    }

    if (activePage === 'reports') {
      return <Reports reservations={allReservations} feedbacks={feedbacks} restaurantLogoUrl={settings.restaurantLogoUrl} restaurantName={settings.restaurantName} />;
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
          isLoadingSettings={isLoadingOperationalSettings}
          settingsMessage={settingsMessage}
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
      {isDemoClient && <div className="demo-banner">DEMO · Datos simulados</div>}
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

function getPublicFeedbackReservationId() {
  const match = window.location.pathname.match(/^\/feedback\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function DemoAuthGate() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const config = getClientConfig();
    return sessionStorage.getItem(LOGIN_FLAG_KEY) === 'true' && isValidClientConfig(config) && (config.auth_provider === 'supabase' || toSupabaseBoolean(config.IS_DEMO) || toSupabaseBoolean(config.is_demo));
  });

  async function handleDemoLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!isSupabaseConfigured) {
      setError('Supabase no esta configurado');
      return;
    }

    setIsLoading(true);
    clearLoginSession();

    try {
      const authResult = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authResult.error || !authResult.data.user) {
        setError('Credenciales incorrectas');
        return;
      }

      const userId = authResult.data.user.id;
      const profileResult = await supabase
        .from('PROFILES')
        .select('user_id, client_id, role, status')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileResult.error) {
        setError('Usuario sin profile');
        return;
      }

      const profile = profileResult.data as Record<string, unknown> | null;
      if (!profile) {
        setError('Usuario sin profile');
        return;
      }

      if (pickSupabaseValue(profile, ['status', 'STATUS']).toUpperCase() !== 'ACTIVE') {
        setError('Profile inactivo');
        return;
      }

      const clientId = pickSupabaseValue(profile, ['client_id']).trim();
      const role = pickSupabaseValue(profile, ['role', 'ROLE']);

      const { data: clientData, error: clientError } = await supabase
        .from('CLIENTES')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();

      if (clientError) {
        setError('Cliente no encontrado');
        return;
      }

      const client = clientData as Record<string, unknown> | null;
      if (!client) {
        setError('Cliente no encontrado');
        return;
      }

      if (pickSupabaseValue(client, ['status']).toUpperCase() !== 'ACTIVE') {
        setError('Cliente inactivo');
        return;
      }

      const config = normalizeClientConfig({
        success: true,
        auth_provider: 'supabase',
        client_id: clientId,
        rest_nombre: pickSupabaseValue(client, ['rest_name']),
        logo_restaurante: pickSupabaseValue(client, ['logo_url']),
        color: pickSupabaseValue(client, ['primary_color']),
        sheet_id: pickSupabaseValue(client, ['sheet_id']),
        role,
        IS_DEMO: toSupabaseBoolean(client.is_demo),
        is_demo: toSupabaseBoolean(client.is_demo),
      });

      if (!isValidClientConfig(config)) {
        setError('Cliente no encontrado');
        return;
      }

      sessionStorage.setItem(CLIENT_CONFIG_KEY, JSON.stringify(config));
      sessionStorage.setItem(LOGIN_FLAG_KEY, 'true');
      console.log('Cliente demo cargado:', config.rest_nombre);
      setIsAuthenticated(true);
    } catch (loginError) {
      console.error('Demo login error', loginError);
      setError('Credenciales incorrectas');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDemoLogout() {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
  }

  if (isAuthenticated) {
    return <ManagerApp onLogoutComplete={handleDemoLogout} />;
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-label="Acceso demo CostaBots Manager">
        <div className="login-brand">
          <BrandLogo fallbackUrl={DEFAULT_COSTABOTS_LOGO} fallbackLabel="C" alt="Costabots" variant="platform" preferFallback />
          <div>
            <p className="eyebrow">Acceso demo</p>
            <h1>CostaBots Manager</h1>
          </div>
        </div>

        <form className="login-form" onSubmit={handleDemoLogin}>
          <label>
            Email
            <input autoComplete="email" autoFocus name="email" onChange={(event) => setEmail(event.target.value)} placeholder="email@restaurante.com" required type="email" value={email} />
          </label>

          <label>
            Password
            <input autoComplete="current-password" name="password" onChange={(event) => setPassword(event.target.value)} placeholder="Password" required type="password" value={password} />
          </label>

          {error && <p className="login-error">{error}</p>}

          <button className="primary-button login-submit" disabled={isLoading} type="submit">
            {isLoading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}

export function App() {
  const feedbackReservationId = getPublicFeedbackReservationId();

  if (feedbackReservationId) {
    console.log('[FeedbackPublic render]', feedbackReservationId);
    return <FeedbackPublic idReserva={feedbackReservationId} />;
  }

  if (window.location.pathname === '/demo') {
    return <DemoAuthGate />;
  }

  return <ManagerApp />;
}
