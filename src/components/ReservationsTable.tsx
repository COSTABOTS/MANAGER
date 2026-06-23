import type { Reservation } from '../types';
import { isActiveReservation } from '../utils/reservationStatus';

interface ReservationsTableProps {
  reservations: Reservation[];
  tableOptions: string[];
  hasLoadedTables: boolean;
  isLoadingTables: boolean;
  onEnsureTables: () => Promise<void>;
  onUpdate: (id: string, field: 'table' | 'arrived', value: string | boolean) => Promise<void>;
  onCancel: (reservation: Reservation) => void;
}

function getReservationService(reservation: Reservation) {
  const service = String(reservation.service ?? '').trim().toUpperCase();
  if (service === 'DESAYUNO' || service === 'ALMUERZO' || service === 'BALINESA') {
    return service;
  }

  return 'CENA';
}

function getReservationRowClassName(reservation: Reservation) {
  return [reservation.arrived ? 'has-arrived' : '', `service-${getReservationService(reservation).toLowerCase()}`]
    .filter(Boolean)
    .join(' ');
}

export function ReservationsTable({ reservations, tableOptions, hasLoadedTables, isLoadingTables, onEnsureTables, onUpdate, onCancel }: ReservationsTableProps) {
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
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((reservation) => (
              <tr key={reservation.id} className={getReservationRowClassName(reservation)}>
                <td data-label="Nombre">{reservation.name}</td>
                <td data-label="Habitacion">{reservation.room || '-'}</td>
                <td data-label="Hora">{reservation.time}</td>
                <td data-label="Pax">{reservation.pax}</td>
                <td data-label="Peticion especial">{reservation.specialRequest || '-'}</td>
                <td data-label="Mesa">
                  {isLoadingTables ? (
                    <span className="muted-cell">Cargando mesas...</span>
                  ) : tableOptions.length === 0 && !hasLoadedTables ? (
                    <button className="secondary-button compact-action" type="button" onClick={() => void onEnsureTables()}>
                      Asignar mesa
                    </button>
                  ) : tableOptions.length === 0 ? (
                    <span className="muted-cell">No hay mesas configuradas para este restaurante.</span>
                  ) : (
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
                  )}
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
                <td data-label="Acciones">
                  {isActiveReservation(reservation) ? (
                    <button className="danger-button compact-action" type="button" onClick={() => onCancel(reservation)}>
                      Cancelar
                    </button>
                  ) : (
                    <span className="muted-cell">Cancelada</span>
                  )}
                </td>
              </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
