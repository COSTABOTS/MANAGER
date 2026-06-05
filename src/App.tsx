import { useMemo, useState } from 'react';
import { Layout } from './components/Layout';
import { Control } from './pages/Control';
import { Feedbacks } from './pages/Feedbacks';
import { Reservations } from './pages/Reservations';
import { Settings } from './pages/Settings';
import { Shows } from './pages/Shows';
import { Today } from './pages/Today';
import { mockSettings } from './data/mockData';
import { mockReservations, todayState } from './data/mockReservations';
import { sendWalkIn, updateReservationField } from './services/webhooks';
import type { DayState, Reservation, WalkInPayload } from './types';
import { getCurrentTime, getLocalDateString } from './utils/date';

export type PageKey = 'today' | 'reservations' | 'control' | 'feedbacks' | 'shows' | 'settings';

export function App() {
  const [activePage, setActivePage] = useState<PageKey>('today');
  const [reservations, setReservations] = useState(mockReservations);
  const [dayStatus] = useState<DayState>({
    ...todayState,
    date: getLocalDateString(new Date()),
  });
  const [settings, setSettings] = useState(mockSettings);
  const [lastSync, setLastSync] = useState('Datos mock cargados');

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
    setSettings((current) => ({
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
      return <Settings settings={settings} reservations={reservations} onSettingsChange={setSettings} />;
    }

    return (
      <Today
        dayStatus={{
          ...dayStatus,
          bookingsOpen: settings.reservasActivas,
          fullyBooked: !settings.reservasActivas,
        }}
        lastSync={lastSync}
        reservations={todaysReservations}
        tableOptions={activeTableOptions}
        totalPax={totalPax}
        arrivals={arrivals}
        occupancyPercent={occupancyPercent}
        totalCapacity={settings.totalCapacity}
        onAddWalkIn={handleAddWalkIn}
        onBookingStatus={handleBookingStatus}
        onUpdateReservation={handleUpdateReservation}
      />
    );
  }

  return (
    <Layout activePage={activePage} onNavigate={setActivePage}>
      {renderPage()}
    </Layout>
  );
}
