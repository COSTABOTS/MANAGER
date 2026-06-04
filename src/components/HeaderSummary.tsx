import { CheckCircle2, Lock, LockOpen, Percent, Users } from 'lucide-react';

interface HeaderSummaryProps {
  date: string;
  bookingsOpen: boolean;
  totalPax: number;
  arrivals: number;
  occupancyPercent: number;
}

export function HeaderSummary({ date, bookingsOpen, totalPax, arrivals, occupancyPercent }: HeaderSummaryProps) {
  return (
    <section className="summary-grid">
      <div className="summary-main">
        <span className="summary-label">Fecha</span>
        <strong>{date}</strong>
      </div>
      <div className={`summary-state ${bookingsOpen ? 'is-open' : 'is-closed'}`}>
        {bookingsOpen ? <LockOpen size={24} /> : <Lock size={24} />}
        <span>{bookingsOpen ? 'Reservas abiertas' : 'Fully booked'}</span>
      </div>
      <div className="summary-pax">
        <span>Pax totales</span>
        <strong>
          <Users size={30} />
          {totalPax}
        </strong>
      </div>
      <div className="summary-flag">
        <span>Llegadas</span>
        <strong>
          <CheckCircle2 size={28} />
          {arrivals}
        </strong>
      </div>
      <div className="summary-occupancy">
        <span>Ocupacion</span>
        <strong>
          <Percent size={28} />
          {occupancyPercent}
        </strong>
      </div>
    </section>
  );
}
