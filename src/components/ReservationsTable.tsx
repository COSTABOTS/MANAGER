import type { Reservation } from '../types';

interface ReservationsTableProps {
  reservations: Reservation[];
  tableOptions: string[];
  onUpdate: (id: string, field: 'table' | 'arrived', value: string | boolean) => Promise<void>;
}

export function ReservationsTable({ reservations, tableOptions, onUpdate }: ReservationsTableProps) {
  function getAvailableTables(currentReservation: Reservation) {
    const occupiedTables = new Set(
      reservations
        .filter((reservation) => reservation.id !== currentReservation.id)
        .map((reservation) => reservation.table)
        .filter(Boolean),
    );

    const availableTables = tableOptions.filter(
      (table) => !occupiedTables.has(table) || table === currentReservation.table,
    );

    if (currentReservation.table && !availableTables.includes(currentReservation.table)) {
      return [currentReservation.table, ...availableTables];
    }

    return availableTables;
  }

  return (
    <div className="table-wrap">
      <table className="reservations-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Habitacion</th>
            <th>Hora</th>
            <th>Pax</th>
            <th>Peticion especial</th>
            <th>Mesa</th>
            <th>Llego</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((reservation) => (
            <tr key={reservation.id} className={reservation.arrived ? 'has-arrived' : undefined}>
              <td data-label="Nombre">{reservation.name}</td>
              <td data-label="Habitacion">{reservation.room || '-'}</td>
              <td data-label="Hora">{reservation.time}</td>
              <td data-label="Pax">{reservation.pax}</td>
              <td data-label="Peticion especial">{reservation.specialRequest || '-'}</td>
              <td data-label="Mesa">
                <select
                  className="table-input"
                  value={reservation.table}
                  onChange={(event) => onUpdate(reservation.id, 'table', event.target.value)}
                >
                  <option value="">Sin asignar</option>
                  {getAvailableTables(reservation).map((table) => (
                    <option key={table} value={table}>
                      {table}
                    </option>
                  ))}
                </select>
              </td>
              <td data-label="Llego">
                <label className="arrival-check">
                  <input
                    type="checkbox"
                    checked={reservation.arrived}
                    onChange={(event) => onUpdate(reservation.id, 'arrived', event.target.checked)}
                  />
                  <span>{reservation.arrived ? 'Ha llegado' : 'No ha llegado'}</span>
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
