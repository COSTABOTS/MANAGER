import { useEffect, useMemo, useState } from 'react';
import { mockSettings } from '../mock';
import type { ManagerSettings, Reservation, RestaurantTable, RestaurantTableType, Weekday } from '../types';

interface SettingsProps {
  settings: ManagerSettings;
  reservations: Reservation[];
  onSettingsSave: (settings: ManagerSettings) => Promise<'success' | 'error' | 'skipped'>;
}

type ReservationInterval = 30 | 60;
type SlotCapacity = Record<string, number>;

const userRole: 'admin' | 'manager' = 'admin';
const DEFAULT_SLOT_CAPACITY = 40;
const TABLE_TYPES: Array<{ value: RestaurantTableType; label: string }> = [
  { value: 'interior', label: 'Interior' },
  { value: 'terraza', label: 'Terraza' },
  { value: 'barra', label: 'Barra' },
  { value: 'vip', label: 'VIP' },
  { value: 'privado', label: 'Privado' },
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

const EMPTY_TABLE_FORM = {
  name: '',
  type: 'interior' as RestaurantTableType,
};

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

export function Settings({ settings, reservations, onSettingsSave }: SettingsProps) {
  const [draftSettings, setDraftSettings] = useState(settings);
  const [tableForm, setTableForm] = useState(EMPTY_TABLE_FORM);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setDraftSettings(settings);
    setSaveState('idle');
  }, [settings]);

  const hasUnsavedChanges = useMemo(() => JSON.stringify(draftSettings) !== JSON.stringify(settings), [draftSettings, settings]);

  useEffect(() => {
    if (hasUnsavedChanges && saveState !== 'saving') {
      setSaveState('dirty');
    }
  }, [hasUnsavedChanges, saveState]);

  function updateDraft<T extends keyof ManagerSettings>(key: T, value: ManagerSettings[T]) {
    setDraftSettings((current) => ({ ...current, [key]: value }));
  }

  function updateTotalCapacity(totalCapacity: number) {
    setDraftSettings((current) => ({
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
    setDraftSettings((current) => {
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
    setDraftSettings((current) => ({
      ...current,
      slotCapacity: {
        ...current.slotCapacity,
        [slot]: value,
      },
    }));
  }

  function updateOpeningDay(day: Weekday, value: boolean) {
    setDraftSettings((current) => ({
      ...current,
      openingDays: {
        ...current.openingDays,
        [day]: value,
      },
    }));
  }

  function addTable() {
    const name = tableForm.name.trim();
    if (!name) {
      return;
    }

    setDraftSettings((current) => ({
      ...current,
      tables: [
        ...current.tables,
        {
          id: `table-${Date.now()}`,
          name,
          type: tableForm.type,
          active: true,
        },
      ],
    }));
    setTableForm(EMPTY_TABLE_FORM);
  }

  function toggleTable(tableId: string) {
    setDraftSettings((current) => ({
      ...current,
      tables: current.tables.map((table) => (table.id === tableId ? { ...table, active: !table.active } : table)),
    }));
  }

  function deleteTable(tableId: string) {
    setDraftSettings((current) => ({
      ...current,
      tables: current.tables.filter((table) => table.id !== tableId),
    }));
  }

  function restoreDefaultTables() {
    setDraftSettings((current) => ({
      ...current,
      tables: mockSettings.tables,
    }));
  }

  function hasReservationsForTable(tableName: string) {
    return reservations.some((reservation) => reservation.table === tableName);
  }

  async function handleSaveSettings() {
    setSaveState('saving');
    const result = await onSettingsSave(draftSettings);
    setSaveState(result === 'error' ? 'error' : 'saved');
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
              <input type="number" value={draftSettings.totalCapacity} onChange={(event) => updateTotalCapacity(Number(event.target.value))} />
            </label>
          </div>

          <div className="settings-subsection">
            <p className="eyebrow">Horario del restaurante</p>
            <div className="settings-grid inner">
              <label>
                Hora apertura
                <input type="time" value={draftSettings.openingTime} onChange={(event) => updateSchedule({ openingTime: event.target.value })} />
              </label>
              <label>
                Hora cierre
                <input type="time" value={draftSettings.closingTime} onChange={(event) => updateSchedule({ closingTime: event.target.value })} />
              </label>
              <label>
                Intervalo de reservas
                <select
                  value={draftSettings.bookingInterval}
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
                    checked={draftSettings.openingDays[day.key]}
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
              {Object.entries(draftSettings.slotCapacity).map(([slot, value]) => (
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
          <SwitchRow label="Reservas activas" checked={draftSettings.reservasActivas} onChange={(value) => updateDraft('reservasActivas', value)} />
          <SwitchRow label="WhatsApp pre-cena" checked={draftSettings.whatsappPreCena} onChange={(value) => updateDraft('whatsappPreCena', value)} />
          <SwitchRow label="Filtro reseñas" checked={draftSettings.filtroResenas} onChange={(value) => updateDraft('filtroResenas', value)} />
          <SwitchRow label="Mensaje post-cena" checked={draftSettings.mensajePostCena} onChange={(value) => updateDraft('mensajePostCena', value)} />
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
                <input value={draftSettings.restaurantName} onChange={(event) => updateDraft('restaurantName', event.target.value)} />
              </label>
              <label>
                Logo Costabots URL <span className="field-note">Futuro</span>
                <input value={draftSettings.costabotsLogoUrl} onChange={(event) => updateDraft('costabotsLogoUrl', event.target.value)} placeholder="https://..." />
              </label>
              <label>
                Logo restaurante URL <span className="field-note">Proximamente</span>
                <input value={draftSettings.restaurantLogoUrl} onChange={(event) => updateDraft('restaurantLogoUrl', event.target.value)} placeholder="https://..." disabled />
              </label>
              <label>
                Color principal
                <input value={draftSettings.primaryColor} onChange={(event) => updateDraft('primaryColor', event.target.value)} type="color" />
              </label>
              <label>
                Google Sheet ID
                <input value={draftSettings.googleSheetId} onChange={(event) => updateDraft('googleSheetId', event.target.value)} />
              </label>
              <label>
                Webhook reservas
                <input value={draftSettings.webhookReservas} onChange={(event) => updateDraft('webhookReservas', event.target.value)} />
              </label>
              <label>
                Webhook walk-in
                <input value={draftSettings.webhookWalkin} onChange={(event) => updateDraft('webhookWalkin', event.target.value)} />
              </label>
              <label>
                Webhook llegada
                <input value={draftSettings.webhookLlegada} onChange={(event) => updateDraft('webhookLlegada', event.target.value)} />
              </label>
              <label>
                Webhook mesa
                <input value={draftSettings.webhookMesa} onChange={(event) => updateDraft('webhookMesa', event.target.value)} />
              </label>
              <label>
                Webhook fully booked
                <input value={draftSettings.webhookFullyBooked} onChange={(event) => updateDraft('webhookFullyBooked', event.target.value)} />
              </label>
              <label>
                Webhook shows
                <input value={draftSettings.webhookShows} onChange={(event) => updateDraft('webhookShows', event.target.value)} />
              </label>
              <label>
                Webhook feedbacks
                <input value={draftSettings.webhookFeedbacks} onChange={(event) => updateDraft('webhookFeedbacks', event.target.value)} />
              </label>
              <label>
                Webhook settings
                <input value={draftSettings.webhookSettings} onChange={(event) => updateDraft('webhookSettings', event.target.value)} />
              </label>
            </div>
            <SwitchRow label="Licencia activa" checked={draftSettings.licenseActive} onChange={(value) => updateDraft('licenseActive', value)} />

            <div className="settings-subsection">
              <div className="section-title compact">
                <div>
                  <p className="eyebrow">Costabots Admin</p>
                  <h2>Mesas / Zonas</h2>
                </div>
                <button className="secondary-button" type="button" onClick={restoreDefaultTables}>
                  Restaurar mesas por defecto
                </button>
              </div>

              <div className="table-manager-form">
                <label>
                  Nombre mesa
                  <input value={tableForm.name} onChange={(event) => setTableForm((current) => ({ ...current, name: event.target.value }))} placeholder="Mesa 11" />
                </label>
                <label>
                  Tipo
                  <select value={tableForm.type} onChange={(event) => setTableForm((current) => ({ ...current, type: event.target.value as RestaurantTableType }))}>
                    {TABLE_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={addTable}>
                  Añadir mesa
                </button>
              </div>

              <div className="table-manager-list">
                {draftSettings.tables.map((table) => {
                  const hasReservations = hasReservationsForTable(table.name);

                  return (
                    <div className="table-manager-item" key={table.id}>
                      <strong>{table.name}</strong>
                      <span>{TABLE_TYPES.find((type) => type.value === table.type)?.label ?? table.type}</span>
                      <button className={`compact-toggle ${table.active ? 'is-open' : 'is-closed'}`} type="button" onClick={() => toggleTable(table.id)}>
                        <span>{table.active ? 'Activa' : 'Inactiva'}</span>
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

      <section className="settings-save-bar">
        <span className={`save-indicator is-${saveState}`}>
          {saveState === 'dirty' ? '● Cambios pendientes' : saveState === 'saving' ? 'Guardando...' : saveState === 'error' ? 'Guardado local, sin sincronizar' : '✓ Configuración guardada'}
        </span>
        <button type="button" disabled={saveState === 'saving'} onClick={handleSaveSettings}>
          Guardar configuración
        </button>
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
