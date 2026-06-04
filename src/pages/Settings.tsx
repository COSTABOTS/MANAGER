import type { Dispatch, SetStateAction } from 'react';
import type { ManagerSettings, Weekday } from '../types';

interface SettingsProps {
  settings: ManagerSettings;
  onSettingsChange: Dispatch<SetStateAction<ManagerSettings>>;
}

type ReservationInterval = 30 | 60;
type SlotCapacity = Record<string, number>;

const userRole: 'admin' | 'manager' = 'admin';
const DEFAULT_SLOT_CAPACITY = 40;
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

export function Settings({ settings, onSettingsChange }: SettingsProps) {
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
                Logo URL
                <input value={settings.logoUrl} onChange={(event) => updateSetting('logoUrl', event.target.value)} placeholder="https://..." />
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
