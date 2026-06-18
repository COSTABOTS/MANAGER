import { useEffect, useMemo, useState } from 'react';
import type { ManagerSettings, RestaurantTable, RestaurantTableType, Weekday } from '../types';
import { generateTimeSlots } from '../utils/capacity';

interface SettingsProps {
  settings: ManagerSettings;
  restaurantTables: RestaurantTable[];
  tableSyncMessage: string;
  isLoadingTables: boolean;
  isLoadingSettings: boolean;
  settingsMessage: string;
  isDemoMode?: boolean;
  clientId?: string;
  lastUpdatedAt?: string;
  onRefreshTables: () => Promise<void>;
  onCreateTable: (table: Omit<RestaurantTable, 'id' | 'active'>) => Promise<void>;
  onUpdateTable: (table: RestaurantTable) => Promise<void>;
  onDeactivateTable: (table: RestaurantTable) => Promise<void>;
  onDeleteTable: (table: RestaurantTable) => Promise<void>;
  onSettingsSave: (settings: ManagerSettings) => Promise<'success' | 'error' | 'skipped'>;
}

type ReservationInterval = 30 | 60;
type SlotCapacity = Record<string, number>;

const userRole: 'admin' | 'manager' = 'admin';
const DEFAULT_SLOT_CAPACITY = 40;
const CAPACITY_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const TABLE_TYPES: Array<{ value: RestaurantTableType; label: string }> = [
  { value: 'general', label: 'General' },
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
  capacity: 2,
};

function rebuildSlotCapacity(
  openingTime: string,
  closingTime: string,
  interval: ReservationInterval,
  currentCapacity: SlotCapacity,
  fallbackCapacity: number,
) {
  return generateTimeSlots(openingTime, closingTime, interval).reduce<SlotCapacity>((slots, slot) => {
    slots[slot] = currentCapacity[slot] ?? (fallbackCapacity || DEFAULT_SLOT_CAPACITY);
    return slots;
  }, {});
}

export function Settings({
  settings,
  restaurantTables,
  tableSyncMessage,
  isLoadingTables,
  isLoadingSettings,
  settingsMessage,
  isDemoMode = false,
  clientId = '',
  lastUpdatedAt = '',
  onRefreshTables,
  onCreateTable,
  onUpdateTable,
  onDeactivateTable,
  onDeleteTable,
  onSettingsSave,
}: SettingsProps) {
  const [draftSettings, setDraftSettings] = useState(settings);
  const [tableForm, setTableForm] = useState(EMPTY_TABLE_FORM);
  const [tableDrafts, setTableDrafts] = useState<Record<string, { name: string; type: RestaurantTableType; capacity: number; order: number }>>({});
  const [tableToDelete, setTableToDelete] = useState<RestaurantTable | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setDraftSettings(settings);
    setSaveState('idle');
  }, [settings]);

  useEffect(() => {
    setTableDrafts(
      Object.fromEntries(
        restaurantTables.map((table, index) => [
          table.id,
          {
            name: table.name,
            type: table.type,
            capacity: table.capacity ?? 2,
            order: table.order ?? index + 1,
          },
        ]),
      ),
    );
  }, [restaurantTables]);

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

    void onCreateTable({
      name,
      type: tableForm.type,
      capacity: tableForm.capacity,
      order: restaurantTables.length + 1,
    });
    setTableForm(EMPTY_TABLE_FORM);
  }

  function updateTableDraft(tableId: string, nextDraft: Partial<{ name: string; type: RestaurantTableType; capacity: number; order: number }>) {
    setTableDrafts((current) => ({
      ...current,
      [tableId]: {
        ...current[tableId],
        ...nextDraft,
      },
    }));
  }

  function saveTable(table: RestaurantTable) {
    const draft = tableDrafts[table.id];
    const name = draft?.name.trim();

    if (!draft || !name) {
      return;
    }

    void onUpdateTable({
      ...table,
      name,
      type: draft.type,
      capacity: draft.capacity,
      order: draft.order,
    });
  }

  async function confirmDeleteTable() {
    if (!tableToDelete) {
      return;
    }

    await onDeleteTable(tableToDelete);
    setTableToDelete(null);
  }

  async function handleSaveSettings() {
    setSaveState('saving');
    const result = await onSettingsSave(draftSettings);
    setSaveState(result === 'error' ? 'error' : 'saved');
  }

  const webhookFields = (
    <div className="settings-grid inner">
      <label>
        Webhook reservas
        <input value={draftSettings.webhookReservas} onChange={(event) => updateDraft('webhookReservas', event.target.value)} />
      </label>
      <label>
        Webhook leer reservas
        <input value={draftSettings.webhookLeerReservas} onChange={(event) => updateDraft('webhookLeerReservas', event.target.value)} />
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
        Webhook cancelar reserva
        <input value={draftSettings.webhookCancelReservationUrl} onChange={(event) => updateDraft('webhookCancelReservationUrl', event.target.value)} />
      </label>
      <label>
        Webhook leer mesas
        <input value={draftSettings.webhookGetMesas} onChange={(event) => updateDraft('webhookGetMesas', event.target.value)} />
      </label>
      <label>
        Webhook guardar mesa
        <input value={draftSettings.webhookSaveMesa} onChange={(event) => updateDraft('webhookSaveMesa', event.target.value)} />
      </label>
      <label>
        Webhook leer capacidad
        <input value={draftSettings.webhookGetCapacidad} onChange={(event) => updateDraft('webhookGetCapacidad', event.target.value)} />
      </label>
      <label>
        Webhook guardar capacidad
        <input value={draftSettings.webhookSettingsCapacityUrl} onChange={(event) => updateDraft('webhookSettingsCapacityUrl', event.target.value)} />
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
  );

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

      {(isLoadingSettings || settingsMessage) && (
        <p className="sync-message">{isLoadingSettings ? 'Cargando SETTINGS...' : settingsMessage}</p>
      )}

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
            <label>
              Max pax por reserva
              <input type="number" value={draftSettings.maxPaxPerBooking} onChange={(event) => updateDraft('maxPaxPerBooking', Number(event.target.value))} />
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
                  <select value={value} onChange={(event) => updateSlotCapacity(slot, Number(event.target.value))}>
                    {CAPACITY_OPTIONS.map((capacity) => (
                      <option key={capacity} value={capacity}>
                        {capacity === 0 ? '0 - cerrado' : capacity}
                      </option>
                    ))}
                  </select>
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
          <SwitchRow label="WhatsApp confirmacion" checked={draftSettings.whatsappConfirmation} onChange={(value) => updateDraft('whatsappConfirmation', value)} />
          <SwitchRow label="Briefing diario" checked={draftSettings.dailyBriefingEnabled} onChange={(value) => updateDraft('dailyBriefingEnabled', value)} />
          <div className="settings-grid inner">
            <label>
              Hora briefing diario
              <input type="time" value={draftSettings.dailyBriefingTime} onChange={(event) => updateDraft('dailyBriefingTime', event.target.value)} />
            </label>
            <label>
              Telefono alertas feedback
              <input value={draftSettings.feedbackAlertPhone} onChange={(event) => updateDraft('feedbackAlertPhone', event.target.value)} />
            </label>
          </div>
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
            </div>
            {isDemoMode ? (
              <>
                <div className="settings-subsection api-integration-card">
                  <div className="section-title compact">
                    <div>
                      <p className="eyebrow">Integracion COSTABOTS API</p>
                      <h2>manager-api</h2>
                    </div>
                    <span className="status-pill">ACTIVO</span>
                  </div>
                  <div className="api-integration-grid">
                    <div>
                      <span>Modo</span>
                      <strong>manager-api</strong>
                    </div>
                    <div>
                      <span>Estado</span>
                      <strong>Activo</strong>
                    </div>
                    <div>
                      <span>Google Sheet ID</span>
                      <strong>{draftSettings.googleSheetId || 'No configurado'}</strong>
                    </div>
                    <div>
                      <span>Client ID</span>
                      <strong>{clientId || 'No disponible'}</strong>
                    </div>
                    {lastUpdatedAt && (
                      <div>
                        <span>Ultima sincronizacion</span>
                        <strong>{lastUpdatedAt}</strong>
                      </div>
                    )}
                  </div>
                </div>
                <details className="settings-subsection legacy-webhooks-panel">
                  <summary>Avanzado / Legacy Make</summary>
                  <p className="field-note">Fallback conservado para compatibilidad. En demo, las acciones principales usan manager-api.</p>
                  {webhookFields}
                </details>
              </>
            ) : (
              webhookFields
            )}
            <SwitchRow label="Licencia activa" checked={draftSettings.licenseActive} onChange={(value) => updateDraft('licenseActive', value)} />

            <div className="settings-subsection">
              <div className="section-title compact">
                <div>
                  <p className="eyebrow">Costabots Admin</p>
                  <h2>Mesas / Zonas</h2>
                </div>
                <button className="secondary-button" type="button" disabled={isLoadingTables} onClick={() => void onRefreshTables()}>
                  {isLoadingTables ? 'Actualizando...' : 'Actualizar mesas'}
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
                <label>
                  Capacidad
                  <input
                    type="number"
                    min={1}
                    value={tableForm.capacity}
                    onChange={(event) => setTableForm((current) => ({ ...current, capacity: Number(event.target.value) }))}
                  />
                </label>
                <button type="button" onClick={addTable}>
                  Añadir mesa
                </button>
              </div>

              {tableSyncMessage && <p className="sync-message">{tableSyncMessage}</p>}

              <div className="table-manager-list">
                {restaurantTables.length === 0 && <p className="empty-state">No hay mesas configuradas para este restaurante.</p>}
                {restaurantTables.map((table) => {
                  const tableDraft = tableDrafts[table.id] ?? {
                    name: table.name,
                    type: table.type,
                    capacity: table.capacity ?? 2,
                    order: table.order ?? 1,
                  };

                  return (
                    <div className={`table-manager-item ${table.active ? '' : 'is-inactive'}`} key={table.id}>
                      <input value={tableDraft.name} onChange={(event) => updateTableDraft(table.id, { name: event.target.value })} />
                      <select value={tableDraft.type} onChange={(event) => updateTableDraft(table.id, { type: event.target.value as RestaurantTableType })}>
                        {TABLE_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        value={tableDraft.capacity}
                        onChange={(event) => updateTableDraft(table.id, { capacity: Number(event.target.value) })}
                      />
                      <button className={`compact-toggle ${table.active ? 'is-open' : 'is-closed'}`} type="button" onClick={() => void onUpdateTable({ ...table, active: !table.active })}>
                        <span>{table.active ? 'Activa' : 'Inactiva'}</span>
                      </button>
                      <button className="secondary-button compact-action" type="button" onClick={() => saveTable(table)}>
                        Guardar
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        disabled={!table.mesaId}
                        title={table.mesaId ? 'Borrar mesa definitivamente' : 'No se puede borrar: falta ID_MESA'}
                        onClick={() => setTableToDelete(table)}
                      >
                        Borrar
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

      {tableToDelete && (
        <div className="modal-backdrop" role="presentation" onPointerDown={() => setTableToDelete(null)}>
          <div className="show-modal cancel-modal" role="dialog" aria-modal="true" onPointerDown={(event) => event.stopPropagation()}>
            <div className="section-title compact">
              <div>
                <p className="eyebrow">Borrar mesa</p>
                <h2>¿Seguro que quieres borrar esta mesa definitivamente?</h2>
              </div>
            </div>
            <div className="cancel-summary">
              <strong>{tableToDelete.name}</strong>
              <span>Esta acción no se puede deshacer.</span>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setTableToDelete(null)}>
                Cancelar
              </button>
              <button className="danger-button" type="button" onClick={() => void confirmDeleteTable()}>
                Borrar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
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
