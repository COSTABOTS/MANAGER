import { Plus } from 'lucide-react';
import { BookingStatusToggle } from '../components/BookingStatusToggle';
import { HeaderSummary } from '../components/HeaderSummary';
import { OccupancyCard } from '../components/OccupancyCard';
import { ReservationsTable } from '../components/ReservationsTable';
import { WalkInForm } from '../components/WalkInForm';
import type { DayState, Reservation } from '../types';
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
        <div className="sync-status">{lastSync}</div>
      </section>

      <HeaderSummary
        date={formatDisplayDate(dayStatus.date)}
        bookingsOpen={dayStatus.bookingsOpen}
        totalPax={totalPax}
        arrivals={arrivals}
        occupancyPercent={occupancyPercent}
      />

      <section className="operations-grid">
        <WalkInForm onAddWalkIn={onAddWalkIn} />
        <BookingStatusToggle bookingsOpen={dayStatus.bookingsOpen} onToggle={onBookingStatus} />
        <OccupancyCard totalPax={totalPax} totalCapacity={totalCapacity} occupancyPercent={occupancyPercent} />
      </section>

      <section className="table-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">Turno de hoy</p>
            <h2>Reservas</h2>
          </div>
          <span className="reservation-count">
            <Plus size={16} />
            {reservations.length} reservas
          </span>
        </div>
        <ReservationsTable reservations={reservations} tableOptions={tableOptions} onUpdate={onUpdateReservation} />
      </section>
    </main>
  );
}
