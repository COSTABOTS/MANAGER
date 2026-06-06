import { useMemo, useState } from 'react';
import type { SetStateAction } from 'react';
import { Layout } from './components/Layout';
import { Control } from './pages/Control';
import { Feedbacks } from './pages/Feedbacks';
import { Reservations } from './pages/Reservations';
import { Settings } from './pages/Settings';
import { Shows } from './pages/Shows';
import { Today } from './pages/Today';
import { mockReservations, todayState } from './mock';
import { loadDateBookingStatusFromStorage, saveDateBookingStatusToStorage } from './services/dateBookingStatusStorage';
import { loadSettingsFromStorage, saveSettingsToStorage } from './services/settingsStorage';
import { sendWebhook } from './services/webhookClient';
import type { DateBookingStatus, DateBookingStatusValue, DayState, ManagerSettings, Reservation, WalkInPayload } from './types';
import { getCurrentTime, getLocalDateString } from './utils/date';

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
        .filter((reservation) => reservation.date === dayStatus.date && reservation.status === 'CONFIRMADA')
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

  async function syncWebhook(webhookUrl: string, payload: unknown, missingMessage = 'Webhook no configurado') {
    const result = await sendWebhook(webhookUrl, payload);
    if (result.success) {
      setLastSync('Sincronizado correctamente');
      return result;
    }

    setLastSync(result.skipped ? missingMessage : 'Cambio guardado en la app, pero no sincronizado');
    return result;
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
    void syncWebhook(settings.webhookFullyBooked, {
      accion: 'actualizar_fully_booked',
      fecha: date,
      fullyBooked: status === 'fully_booked',
    });
    // Future Make integration: updateDateBookingStatus(date, status)
  }

  function handleBookingStatus() {
    updateDateBookingStatus(dayStatus.date, isTodayFullyBooked ? 'open' : 'fully_booked');
    // Future Make integration: updateBookingStatus({ bookingsOpen, fullyBooked })
  }

  async function handleAddWalkIn(nameOrRoom: string, pax: number) {
    const payload: WalkInPayload = {
      nameOrRoom,
      pax,
      date: dayStatus.date,
      time: getCurrentTime(),
      status: 'CONFIRMADA',
      source: 'WALKIN',
    };

    const optimisticReservation: Reservation = {
      id: `walkin-${Date.now()}`,
      name: nameOrRoom,
      room: /^\d+$/.test(nameOrRoom) ? nameOrRoom : '',
      date: payload.date,
      time: payload.time,
      pax,
      specialRequest: 'Walk-in',
      status: 'CONFIRMADA',
      source: 'WALKIN',
      table: '',
      arrived: true,
    };

    setReservations((current) => [...current, optimisticReservation]);
    setLastSync('Mesa añadida correctamente');
    void syncWebhook(settings.webhookWalkin, {
      accion: 'crear_walkin',
      nombre: optimisticReservation.name,
      habitacion: optimisticReservation.room,
      fecha: optimisticReservation.date,
      hora: optimisticReservation.time,
      pax: optimisticReservation.pax,
      origen: 'WALK-IN',
      estado: 'CONFIRMADA',
      llego: true,
    });
  }

  function addManualReservation(reservation: Omit<Reservation, 'id' | 'status' | 'source' | 'table' | 'arrived'>) {
    const manualReservation: Reservation = {
      ...reservation,
      id: `manual-${Date.now()}`,
      status: 'CONFIRMADA',
      source: 'MANUAL',
      table: '',
      arrived: false,
    };

    setReservations((current) => [...current, manualReservation]);
    setLastSync('Reserva añadida correctamente');
    void syncWebhook(
      settings.webhookReservas,
      {
        accion: 'crear_reserva_manual',
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
      'Webhook de reservas no configurado',
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

    if (field === 'arrived') {
      await syncWebhook(settings.webhookLlegada, {
        accion: 'actualizar_llegada',
        id: nextReservation.id,
        fecha: nextReservation.date,
        hora: nextReservation.time,
        nombre: nextReservation.name,
        habitacion: nextReservation.room,
        llego: nextReservation.arrived,
      });
      return;
    }

    await syncWebhook(settings.webhookMesa, {
      accion: 'actualizar_mesa',
      id: nextReservation.id,
      fecha: nextReservation.date,
      hora: nextReservation.time,
      nombre: nextReservation.name,
      habitacion: nextReservation.room,
      mesa: nextReservation.table,
    });
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
