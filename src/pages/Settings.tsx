import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ManagerSettings, Reservation, RestaurantTable, RestaurantTableType, Weekday } from '../types';

interface SettingsProps {
  settings: ManagerSettings;
  reservations: Reservation[];
  onSettingsChange: Dispatch<SetStateAction<ManagerSettings>>;
}

type ReservationInterval = 30 | 60;
type SlotCapacity = Record<string, number>;

const userRole: 'admin' | 'manager' = 'admin';
const DEFAULT_SLOT_CAPACITY = 40;
const TABLE_TYPES: Array<{ value: RestaurantTableType; label: string }> = [
  { value: 'interior', label: 'Interior' },
  { value: 'terraza', label: 'Terraza' },
  { value: 'vip', label: 'VIP' },
  { value: 'barra', label: 'Barra' },
  { value: 'otro', label: 'Otro' },
];
const WEEKDAYS: Array<{ key: Weekday; label: string }> = [
  { key: 'monday', label: 'Lunes' },
  { key: 'tuesday', label: 'Martes' },
  { key: 'wednesday', label: 'Miercoles' },
  { key: 'thursday', label: 'Jueves' },
  { key: 'friday', label: 'Viernes' },
  { key: 'saturday', label: 'Sabado' },
  { key: 'sunday', label: 'Domingo' },
];

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const mins = (minutes % 60).toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

function generateSlots(openingTime: string, closingTime: string, interval: ReservationInterval) {
  const opening = timeToMinutes(openingTime);
  const closing = timeToMinutes(closingTime);

  if (closing < opening) {
    return [openingTime];
  }

  const slots: string[] = [];
  for (let current = opening; current <= closing; current += interval) {
    slots.push(minutesToTime(current));
  }
  return slots;
}

function rebuildSlotCapacity(
  openingTime: string,
  closingTime: string,
  interval: ReservationInterval,
  currentCapacity: SlotCapacity,
  fallbackCapacity: number,
) {
  return generateSlots(openingTime, closingTime, interval).reduce<SlotCapacity>((slots, slot) => {
    slots[slot] = currentCapacity[slot] ?? (fallbackCapacity || DEFAULT_SLOT_CAPACITY);
    return slots;
  }, {});
}

export function Settings({ settings, reservations, onSettingsChange }: SettingsProps) {
  const [costabotsLogoDraft, setCostabotsLogoDraft] = useState(settings.costabotsLogoUrl);
  const [restaurantLogoDraft, setRestaurantLogoDraft] = useState(settings.restaurantLogoUrl);

  useEffect(() => {
    setCostabotsLogoDraft(settings.costabotsLogoUrl);
  }, [settings.costabotsLogoUrl]);

  useEffect(() => {
    setRestaurantLogoDraft(settings.restaurantLogoUrl);
  }, [settings.restaurantLogoUrl]);

  function updateSetting<T extends keyof ManagerSettings>(key: T, value: ManagerSettings[T]) {
    onSettingsChange((current) => ({ ...current, [key]: value }));
    // Future Make integration: saveSettings(settings)
  }

  function updateTotalCapacity(totalCapacity: number) {
    onSettingsChange((current) => ({
      ...current,
      totalCapacity,
      slotCapacity: rebuildSlotCapacity(
        current.openingTime,
        current.closingTime,
        current.bookingInterval,
        current.slotCapacity,
        totalCapacity || DEFAULT_SLOT_CAPACITY,
      ),
    }));
  }

  function updateSchedule(next: Partial<{ openingTime: string; closingTime: string; bookingInterval: ReservationInterval }>) {
    onSettingsChange((current) => {
      const openingTime = next.openingTime ?? current.openingTime;
      const closingTime = next.closingTime ?? current.closingTime;
      const bookingInterval = next.bookingInterval ?? current.bookingInterval;

      return {
        ...current,
        openingTime,
        closingTime,
        bookingInterval,
        slotCapacity: rebuildSlotCapacity(
          openingTime,
          closingTime,
          bookingInterval,
          current.slotCapacity,
          current.totalCapacity || DEFAULT_SLOT_CAPACITY,
        ),
      };
    });
  }

  function updateSlotCapacity(slot: string, value: number) {
    onSettingsChange((current) => ({
      ...current,
      slotCapacity: {
        ...current.slotCapacity,
        [slot]: value,
      },
    }));
  }

  function updateOpeningDay(day: Weekday, value: boolean) {
    onSettingsChange((current) => ({
      ...current,
      openingDays: {
        ...current.openingDays,
        [day]: value,
      },
    }));
  }

  function addTable() {
    onSettingsChange((current) => {
      const nextNumber = current.tables.length + 1;
      return {
        ...current,
        tables: [
          ...current.tables,
          {
            id: `table-${Date.now()}`,
            name: `Mesa ${nextNumber}`,
            type: 'interior',
            active: true,
          },
        ],
      };
    });
  }

  function updateTable(tableId: string, patch: Partial<RestaurantTable>) {
    onSettingsChange((current) => ({
      ...current,
      tables: current.tables.map((table) => (table.id === tableId ? { ...table, ...patch } : table)),
    }));
  }

  function deleteTable(tableId: string) {
    onSettingsChange((current) => ({
      ...current,
      tables: current.tables.filter((table) => table.id !== tableId),
    }));
  }

  function hasReservationsForTable(tableName: string) {
    return reservations.some((reservation) => reservation.table === tableName);
  }

  return (
    <main className="app-shell">
      <section className="top-bar">
        <div className="brand-lockup">
          <div className="logo-mark" aria-hidden="true">
            S
          </div>
          <div>
            <p className="eyebrow">Panel configuracion</p>
            <h1>SETTINGS</h1>
          </div>
        </div>
      </section>

      <section className="settings-stack">
        <article className="settings-card">
          <div className="section-title compact">
            <div>
              <p className="eyebrow">Settings restaurante</p>
              <h2>General</h2>
            </div>
          </div>

          <div className="settings-grid inner">
            <label>
              Capacidad total
              <input type="number" value={settings.totalCapacity} onChange={(event) => updateTotalCapacity(Number(event.target.value))} />
            </label>
          </div>

          <div className="settings-subsection">
            <p className="eyebrow">Horario del restaurante</p>
            <div className="settings-grid inner">
              <label>
                Hora apertura
                <input type="time" value={settings.openingTime} onChange={(event) => updateSchedule({ openingTime: event.target.value })} />
              </label>
              <label>
                Hora cierre
                <input type="time" value={settings.closingTime} onChange={(event) => updateSchedule({ closingTime: event.target.value })} />
              </label>
              <label>
                Intervalo de reservas
                <select
                  value={settings.bookingInterval}
                  onChange={(event) => updateSchedule({ bookingInterval: Number(event.target.value) as ReservationInterval })}
                >
                  <option value={30}>30 minutos</option>
                  <option value={60}>60 minutos</option>
                </select>
              </label>
            </div>
          </div>

          <div className="settings-subsection">
            <p className="eyebrow">Dias de apertura</p>
            <div className="opening-days-grid">
              {WEEKDAYS.map((day) => (
                <label key={day.key} className="day-check">
                  <input
                    type="checkbox"
                    checked={settings.openingDays[day.key]}
                    onChange={(event) => updateOpeningDay(day.key, event.target.checked)}
                  />
                  <span>{day.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="slot-capacity-section">
            <p className="eyebrow">Capacidad por tramo horario</p>
            <div className="slot-capacity-grid">
              {Object.entries(settings.slotCapacity).map(([slot, value]) => (
                <label key={slot} className="slot-input">
                  <span>{slot}</span>
                  <input min="0" type="number" value={value} onChange={(event) => updateSlotCapacity(slot, Number(event.target.value))} />
                </label>
              ))}
            </div>
          </div>
        </article>

        <article className="settings-card">
          <div className="section-title compact">
            <div>
              <p className="eyebrow">Settings restaurante</p>
              <h2>Reservas</h2>
            </div>
          </div>
          <SwitchRow label="Reservas activas" checked={settings.reservasActivas} onChange={(value) => updateSetting('reservasActivas', value)} />
          <SwitchRow label="WhatsApp pre-cena" checked={settings.whatsappPreCena} onChange={(value) => updateSetting('whatsappPreCena', value)} />
          <SwitchRow label="Filtro reseñas" checked={settings.filtroResenas} onChange={(value) => updateSetting('filtroResenas', value)} />
          <SwitchRow label="Mensaje post-cena" checked={settings.mensajePostCena} onChange={(value) => updateSetting('mensajePostCena', value)} />
        </article>

        {userRole === 'admin' && (
          <article className="settings-card admin-card">
            <div className="section-title compact">
              <div>
                <p className="eyebrow">Solo admin</p>
                <h2>Costabots Admin</h2>
              </div>
              <span className="status-pill">ADMIN</span>
            </div>
            <div className="settings-grid inner">
              <label>
                Nombre restaurante
                <input value={settings.restaurantName} onChange={(event) => updateSetting('restaurantName', event.target.value)} />
              </label>
              <label>
                Logo Costabots URL
                <span className="logo-url-row">
                  <input value={costabotsLogoDraft} onChange={(event) => setCostabotsLogoDraft(event.target.value)} placeholder="https://..." />
                  <button type="button" onClick={() => updateSetting('costabotsLogoUrl', costabotsLogoDraft.trim())} aria-label="Guardar logo Costabots">
                    +
                  </button>
                </span>
              </label>
              <label>
                Logo restaurante URL
                <span className="logo-url-row">
                  <input value={restaurantLogoDraft} onChange={(event) => setRestaurantLogoDraft(event.target.value)} placeholder="https://..." />
                  <button type="button" onClick={() => updateSetting('restaurantLogoUrl', restaurantLogoDraft.trim())} aria-label="Guardar logo restaurante">
                    +
                  </button>
                </span>
              </label>
              <label>
                Color principal
                <input value={settings.primaryColor} onChange={(event) => updateSetting('primaryColor', event.target.value)} type="color" />
              </label>
              <label>
                Google Sheet ID
                <input value={settings.googleSheetId} onChange={(event) => updateSetting('googleSheetId', event.target.value)} />
              </label>
              <label>
                Webhook reservas
                <input value={settings.reservationsWebhook} onChange={(event) => updateSetting('reservationsWebhook', event.target.value)} />
              </label>
              <label>
                Webhook walk-in
                <input value={settings.walkInWebhook} onChange={(event) => updateSetting('walkInWebhook', event.target.value)} />
              </label>
              <label>
                Webhook feedbacks
                <input value={settings.feedbacksWebhook} onChange={(event) => updateSetting('feedbacksWebhook', event.target.value)} />
              </label>
              <label>
                Webhook shows
                <input value={settings.showsWebhook} onChange={(event) => updateSetting('showsWebhook', event.target.value)} />
              </label>
            </div>
            <SwitchRow label="Licencia activa" checked={settings.licenseActive} onChange={(value) => updateSetting('licenseActive', value)} />

            <div className="settings-subsection">
              <div className="section-title compact">
                <div>
                  <p className="eyebrow">Costabots Admin</p>
                  <h2>Mesas / Zonas</h2>
                </div>
                <button type="button" onClick={addTable}>
                  Añadir mesa
                </button>
              </div>

              <div className="admin-table-list">
                {settings.tables.map((table) => {
                  const hasReservations = hasReservationsForTable(table.name);

                  return (
                    <div className="admin-table-row" key={table.id}>
                      <span className="table-id">{table.id}</span>
                      <label>
                        Nombre
                        <input value={table.name} onChange={(event) => updateTable(table.id, { name: event.target.value })} />
                      </label>
                      <label>
                        Tipo
                        <select value={table.type} onChange={(event) => updateTable(table.id, { type: event.target.value as RestaurantTableType })}>
                          {TABLE_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className={`compact-toggle ${table.active ? 'is-open' : 'is-closed'}`} type="button" onClick={() => updateTable(table.id, { active: !table.active })}>
                        <span>{table.active ? 'Activa' : 'Inactiva'}</span>
                        <strong>{table.active ? 'ON' : 'OFF'}</strong>
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        disabled={hasReservations}
                        title={hasReservations ? 'No se puede eliminar: tiene reservas asociadas' : 'Eliminar mesa'}
                        onClick={() => deleteTable(table.id)}
                      >
                        Eliminar
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </article>
        )}
      </section>
    </main>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="switch-row">
      <span>{label}</span>
      <button className={`compact-toggle ${checked ? 'is-open' : 'is-closed'}`} type="button" onClick={() => onChange(!checked)}>
        <strong>{checked ? 'ON' : 'OFF'}</strong>
      </button>
    </div>
  );
}
