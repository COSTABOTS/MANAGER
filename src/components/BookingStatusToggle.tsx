import { LockOpen, XCircle } from 'lucide-react';

interface BookingStatusToggleProps {
  bookingsOpen: boolean;
  onToggle: () => void;
}

export function BookingStatusToggle({ bookingsOpen, onToggle }: BookingStatusToggleProps) {
  return (
    <button
      className={`booking-toggle ${bookingsOpen ? 'is-open' : 'is-closed'}`}
      type="button"
      onClick={onToggle}
      aria-pressed={!bookingsOpen}
    >
      <span className="toggle-icon">{bookingsOpen ? <LockOpen size={32} /> : <XCircle size={32} />}</span>
      <span>{bookingsOpen ? 'RESERVAS ABIERTAS' : 'FULLY BOOKED'}</span>
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </button>
  );
}
