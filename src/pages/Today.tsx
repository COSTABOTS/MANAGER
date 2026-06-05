import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BookingStatusToggle } from '../components/BookingStatusToggle';
import { HeaderSummary } from '../components/HeaderSummary';
import { OccupancyCard } from '../components/OccupancyCard';
import { ReservationsTable } from '../components/ReservationsTable';
import { WalkInForm } from '../components/WalkInForm';
import { getTodayData, hasTodayDataEndpoint } from '../services/api';
import type { TodayData } from '../services/api';
import type { BookingStatus, DayState, Reservation } from '../types';
import { formatDisplayDate } from '../utils/date';

interface TodayProps {
  dayStatus: DayState;
  lastSync: string;
  reservations: Reservation[];
  tableOptions: string[];
  totalPax: number;
  arrivals: number;
  occupancyPercent: number;
  totalCapacity: number;
  onAddWalkIn: (nameOrRoom: string, pax: number) => Promise<void>;
  onBookingStatus: () => void;
  onUpdateReservation: (id: string, field: 'table' | 'arrived', value: string | boolean) => Promise<void>;
}

export function Today({
  dayStatus,
  lastSync,
  reservations,
  tableOptions,
  totalPax,
  arrivals,
  occupancyPercent,
  totalCapacity,
  onAddWalkIn,
  onBookingStatus,
  onUpdateReservation,
}: TodayProps) {
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [isLoadingToday, setIsLoadingToday] = useState(false);
  const [todayError, setTodayError] = useState<string | null>(null);

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
  const displayArrivals = todayData?.arrivals ?? arrivals;
  const displayCapacity = todayData?.capacity ?? totalCapacity;
  const displayOccupancyPercent = todayData
    ? Math.min(100, Math.round((displayTotalPax / displayCapacity) * 100))
    : occupancyPercent;
  const syncLabel = isLoadingToday ? 'Cargando datos de HOY...' : todayError ? `Error: ${todayError}` : lastSync;

  return (
    <main className="app-shell">
      <section className="top-bar" aria-label="Resumen del dia">
        <div className="brand-lockup">
          <div className="logo-mark" aria-hidden="true">
            S
          </div>
          <div>
            <p className="eyebrow">Safari Manager</p>
            <h1>SAFARI HOY</h1>
          </div>
        </div>
        <div className="sync-status">{syncLabel}</div>
      </section>

      <HeaderSummary
        date={formatDisplayDate(displayDate)}
        bookingsOpen={displayBookingsOpen}
        totalPax={displayTotalPax}
        arrivals={displayArrivals}
        occupancyPercent={displayOccupancyPercent}
      />

      <section className="operations-grid">
        <WalkInForm onAddWalkIn={onAddWalkIn} />
        <BookingStatusToggle bookingsOpen={displayBookingsOpen} onToggle={onBookingStatus} />
        <OccupancyCard totalPax={displayTotalPax} totalCapacity={displayCapacity} occupancyPercent={displayOccupancyPercent} />
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
    </main>
  );
}
