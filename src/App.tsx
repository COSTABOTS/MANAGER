import { useMemo, useState } from 'react';
import type { SetStateAction } from 'react';
import { Layout } from './components/Layout';
import { Control } from './pages/Control';
import { Feedbacks } from './pages/Feedbacks';
import { Reservations } from './pages/Reservations';
import { Settings } from './pages/Settings';
import { Shows } from './pages/Shows';
import { Today } from './pages/Today';
import { mockReservations, todayState } from './data/mockReservations';
import { loadSettingsFromStorage, saveSettingsToStorage } from './services/settingsStorage';
import { sendWalkIn, updateReservationField } from './services/webhooks';
import type { DayState, ManagerSettings, Reservation, WalkInPayload } from './types';
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

  function handleBookingStatus() {
    updateSettings((current) => ({
      ...current,
      reservasActivas: !current.reservasActivas,
    }));
    setLastSync('Estado actualizado correctamente');
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
      arrived: false,
    };

    setReservations((current) => [...current, optimisticReservation]);
    setLastSync('Enviando nueva mesa...');
    await sendWalkIn(payload);
    setLastSync('Nueva mesa enviada a Make');
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
    setLastSync('Reserva manual añadida');
    // Future Make integration: addManualReservation(reservation)
  }

  async function handleUpdateReservation(id: string, field: 'table' | 'arrived', value: string | boolean) {
    setReservations((current) =>
      current.map((reservation) => (reservation.id === id ? { ...reservation, [field]: value } : reservation)),
    );
    setLastSync('Guardando cambio...');
    await updateReservationField(id, field, value);
    setLastSync('Cambio enviado a Make');
  }

  function renderPage() {
    if (activePage === 'reservations') {
      return <Reservations reservations={reservations} />;
    }

    if (activePage === 'control') {
      return <Control reservations={reservations} totalCapacity={settings.totalCapacity} />;
    }

    if (activePage === 'feedbacks') {
      return <Feedbacks />;
    }

    if (activePage === 'shows') {
      return <Shows />;
    }

    if (activePage === 'settings') {
      return <Settings settings={settings} reservations={reservations} onSettingsChange={updateSettings} />;
    }

    return (
      <Today
        dayStatus={{
          ...dayStatus,
          bookingsOpen: settings.reservasActivas,
          fullyBooked: !settings.reservasActivas,
        }}
        lastSync={lastSync}
        costabotsLogoUrl={settings.costabotsLogoUrl}
        restaurantName={settings.restaurantName}
        restaurantLogoUrl={settings.restaurantLogoUrl}
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
      costabotsLogoUrl={settings.costabotsLogoUrl}
      restaurantName={settings.restaurantName}
      restaurantLogoUrl={settings.restaurantLogoUrl}
      onNavigate={setActivePage}
    >
      {renderPage()}
    </Layout>
  );
}
