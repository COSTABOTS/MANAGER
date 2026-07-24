import { useEffect, useMemo, useState } from 'react';
import type { BookingService, ClientLicense, ClientLicensePlan, ClientLicenseStatus, ManagerSettings, ReservableResource, RestaurantTable, RestaurantTableType, ServiceWithHours, Weekday } from '../types';
import { generateTimeSlots } from '../utils/capacity';

interface SettingsProps {
  settings: ManagerSettings;
  restaurantTables: RestaurantTable[];
  reservableResources: ReservableResource[];
  tableSyncMessage: string;
  resourcesSyncMessage: string;
  isLoadingTables: boolean;
  isLoadingResources: boolean;
  isLoadingSettings: boolean;
  settingsMessage: string;
  isDemoMode?: boolean;
  isDemoUser?: boolean;
  isSuperAdmin?: boolean;
  clientId?: string;
  clientLicense?: ClientLicense;
  lastUpdatedAt?: string;
  onRefreshTables: () => Promise<void>;
  onCreateTable: (table: Omit<RestaurantTable, 'id' | 'active'>) => Promise<void>;
  onUpdateTable: (table: RestaurantTable) => Promise<void>;
  onDeactivateTable: (table: RestaurantTable) => Promise<void>;
  onDeleteTable: (table: RestaurantTable) => Promise<void>;
  onRefreshResources: () => Promise<void>;
  onCreateResource: (resource: Omit<ReservableResource, 'id' | 'active'>) => Promise<void>;
  onUpdateResource: (resource: ReservableResource) => Promise<void>;
  onDeleteResource: (resource: ReservableResource) => Promise<void>;
  onSettingsSave: (settings: ManagerSettings) => Promise<'success' | 'error' | 'skipped'>;
  onClientLicenseSave?: (license: ClientLicense) => Promise<'success' | 'error'>;
}

type ReservationInterval = 30 | 60;
type SlotCapacity = Record<string, number>;
type SettingsTab = 'general' | 'capacity' | 'tables' | 'resources' | 'advanced';

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
const SERVICE_HOUR_FIELDS: Array<{ key: ServiceWithHours; label: string }> = [
  { key: 'DESAYUNO', label: 'Desayuno' },
  { key: 'ALMUERZO', label: 'Almuerzo' },
  { key: 'CENA', label: 'Cena' },
];
const EMPTY_TABLE_FORM = {
  name: '',
  type: 'interior' as RestaurantTableType,
  capacity: 2,
};
const EMPTY_RESOURCE_FORM = {
  name: '',
  zone: 'PISCINA',
  capacity: 4,
};
const CLIENT_LICENSE_STATUSES: ClientLicenseStatus[] = ['ACTIVE', 'TRIAL', 'SUSPENDED', 'EXPIRED'];
const CLIENT_LICENSE_PLANS: ClientLicensePlan[] = ['DEMO', 'PRO'];
const TIME_VALUE_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_PRE_DINNER_MINUTES = 15;
const MAX_PRE_DINNER_MINUTES = 1440;

function toDateTimeLocal(value: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 16);
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

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
  reservableResources,
  tableSyncMessage,
  resourcesSyncMessage,
  isLoadingTables,
  isLoadingResources,
  isLoadingSettings,
  settingsMessage,
  isDemoMode = false,
  isDemoUser = false,
  isSuperAdmin = false,
  clientId = '',
  clientLicense = { status: 'ACTIVE', plan: 'DEMO', expiresAt: '' },
  lastUpdatedAt = '',
  onRefreshTables,
  onCreateTable,
  onUpdateTable,
  onDeactivateTable,
  onDeleteTable,
  onRefreshResources,
  onCreateResource,
  onUpdateResource,
  onDeleteResource,
  onSettingsSave,
  onClientLicenseSave,
}: SettingsProps) {
  const [draftSettings, setDraftSettings] = useState(settings);
  const [tableForm, setTableForm] = useState(EMPTY_TABLE_FORM);
  const [resourceForm, setResourceForm] = useState(EMPTY_RESOURCE_FORM);
  const [resourceDrafts, setResourceDrafts] = useState<Record<string, { name: string; zone: string; capacity: number; order: number }>>({});
  const [tableDrafts, setTableDrafts] = useState<Record<string, { name: string; type: RestaurantTableType; capacity: number; order: number }>>({});
  const [tableToDelete, setTableToDelete] = useState<RestaurantTable | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [licenseDraft, setLicenseDraft] = useState<ClientLicense>(clientLicense);
  const [licenseSaveState, setLicenseSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [settingsValidationMessage, setSettingsValidationMessage] = useState('');
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('general');
  const configurationLocked = isDemoUser;

  useEffect(() => {
    if (!isSuperAdmin && activeSettingsTab === 'advanced') {
      setActiveSettingsTab('general');
    }
  }, [activeSettingsTab, isSuperAdmin]);

  useEffect(() => {
    setDraftSettings(settings);
    setSaveState('idle');
  }, [settings]);

  useEffect(() => {
    setLicenseDraft(clientLicense);
    setLicenseSaveState('idle');
  }, [clientLicense]);

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

  useEffect(() => {
    setResourceDrafts(
      Object.fromEntries(
        reservableResources.map((resource, index) => [
          resource.id,
          {
            name: resource.name,
            zone: resource.zone,
            capacity: resource.capacity,
            order: resource.order ?? index + 1,
          },
        ]),
      ),
    );
  }, [reservableResources]);

  useEffect(() => {
    if (activeSettingsTab === 'resources') {
      console.log('[RESOURCES][RENDER]', reservableResources);
    }
  }, [activeSettingsTab, reservableResources]);

  const hasUnsavedChanges = useMemo(() => JSON.stringify(draftSettings) !== JSON.stringify(settings), [draftSettings, settings]);

  useEffect(() => {
    if (hasUnsavedChanges && saveState !== 'saving') {
      setSaveState('dirty');
    }
  }, [hasUnsavedChanges, saveState]);

  function updateDraft<T extends keyof ManagerSettings>(key: T, value: ManagerSettings[T]) {
    setSettingsValidationMessage('');
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

  function updateServiceHour(service: ServiceWithHours, field: 'start' | 'end', value: string) {
    setDraftSettings((current) => ({
      ...current,
      serviceHours: {
        ...current.serviceHours,
        [service]: {
          ...current.serviceHours[service],
          [field]: value,
        },
      },
    }));
  }

  function updateServiceEnabled(service: BookingService, enabled: boolean) {
    setDraftSettings((current) => {
      const currentServices: BookingService[] = current.servicesEnabled.length > 0 ? current.servicesEnabled : ['CENA'];
      const nextServices = enabled
        ? [...currentServices, service]
        : currentServices.filter((item) => item !== service);
      const uniqueServices = nextServices.filter((item, index) => nextServices.indexOf(item) === index);

      return {
        ...current,
        servicesEnabled: uniqueServices.length > 0 ? uniqueServices : ['CENA'],
      };
    });
  }

  function addTable() {
    if (configurationLocked) {
      return;
    }

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
    if (configurationLocked) {
      return;
    }

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

  function addResource() {
    if (configurationLocked) {
      return;
    }

    const name = resourceForm.name.trim();
    if (!name) {
      return;
    }

    void onCreateResource({
      name,
      recurso: name,
      zone: resourceForm.zone,
      zona: resourceForm.zone,
      capacity: resourceForm.capacity,
      order: reservableResources.length + 1,
    });
    setResourceForm(EMPTY_RESOURCE_FORM);
  }

  function updateResourceDraft(resourceId: string, nextDraft: Partial<{ name: string; zone: string; capacity: number; order: number }>) {
    setResourceDrafts((current) => ({
      ...current,
      [resourceId]: {
        ...current[resourceId],
        ...nextDraft,
      },
    }));
  }

  function updateResource(resource: ReservableResource, nextResource: Partial<ReservableResource>) {
    if (configurationLocked) {
      return;
    }

    void onUpdateResource({ ...resource, ...nextResource });
  }

  function saveResource(resource: ReservableResource) {
    if (configurationLocked) {
      return;
    }

    const draft = resourceDrafts[resource.id];
    const name = draft?.name.trim();

    if (!draft || !name) {
      return;
    }

    void onUpdateResource({
      ...resource,
      name,
      recurso: name,
      zone: draft.zone,
      zona: draft.zone,
      capacity: draft.capacity,
      order: draft.order,
    });
  }

  function deleteResource(resource: ReservableResource) {
    if (configurationLocked) {
      return;
    }

    void onDeleteResource(resource);
  }

  async function confirmDeleteTable() {
    if (configurationLocked || !tableToDelete) {
      return;
    }

    await onDeleteTable(tableToDelete);
    setTableToDelete(null);
  }

  async function handleSaveClientLicense() {
    if (configurationLocked || !onClientLicenseSave || licenseSaveState === 'saving') {
      return;
    }

    setLicenseSaveState('saving');
    const result = await onClientLicenseSave({
      ...licenseDraft,
      expiresAt: fromDateTimeLocal(licenseDraft.expiresAt),
    });
    setLicenseSaveState(result === 'success' ? 'saved' : 'error');
  }

  async function handleSaveSettings() {
    if (configurationLocked) {
      setSaveState('error');
      return;
    }

    if (!TIME_VALUE_PATTERN.test(draftSettings.mensajePostCenaHora)) {
      setSettingsValidationMessage('La hora del mensaje post-cena debe tener formato HH:mm.');
      setSaveState('error');
      return;
    }

    if (
      !Number.isInteger(draftSettings.whatsappPreCenaMinutes)
      || draftSettings.whatsappPreCenaMinutes < MIN_PRE_DINNER_MINUTES
      || draftSettings.whatsappPreCenaMinutes > MAX_PRE_DINNER_MINUTES
    ) {
      setSettingsValidationMessage('Los minutos del recordatorio pre-cena deben ser un entero entre 15 y 1440.');
      setSaveState('error');
      return;
    }

    setSaveState('saving');
    const result = await onSettingsSave(draftSettings);
    setSettingsValidationMessage('');
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
          <div>
            <p className="eyebrow">Panel configuracion</p>
            <h1>SETTINGS</h1>
          </div>
        </div>
      </section>

      {(isLoadingSettings || settingsMessage) && (
        <p className="sync-message">{isLoadingSettings ? 'Cargando SETTINGS...' : settingsMessage}</p>
      )}

      {configurationLocked && (
        <p className="demo-lock-notice">Modo demo: algunas opciones estan bloqueadas.</p>
      )}

      {isDemoMode && (
        <div className="segmented-control settings-tabs" aria-label="Secciones Settings">
          {[
            { key: 'general' as const, label: 'General' },
            { key: 'capacity' as const, label: 'Capacidad' },
            { key: 'tables' as const, label: 'Mesas' },
            { key: 'resources' as const, label: 'Recursos' },
            { key: 'advanced' as const, label: 'Avanzado' },
          ].filter((tab) => isSuperAdmin || tab.key !== 'advanced').map((tab) => (
            <button
              key={tab.key}
              className={activeSettingsTab === tab.key ? 'is-active' : undefined}
              type="button"
              onClick={() => setActiveSettingsTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <section className="settings-stack">
        {(!isDemoMode || activeSettingsTab === 'general' || activeSettingsTab === 'capacity') && (
        <article className="settings-card">
          <div className="section-title compact">
            <div>
              <p className="eyebrow">Settings restaurante</p>
              <h2>{isDemoMode && activeSettingsTab === 'capacity' ? 'Capacidad' : 'General'}</h2>
            </div>
          </div>

          {(!isDemoMode || activeSettingsTab === 'general') && (
            <>
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
            <p className="eyebrow">Horarios de servicio</p>
            <label className="service-enabled-toggle service-enabled-toggle-inline">
              <input
                type="checkbox"
                checked={draftSettings.servicesEnabled.includes('BALINESA')}
                onChange={(event) => updateServiceEnabled('BALINESA', event.target.checked)}
              />
              <strong>Balinesa</strong>
              <span className="muted-cell">Sin horario operativo todavia</span>
            </label>
            <div className="settings-grid inner">
              {SERVICE_HOUR_FIELDS.map((service) => (
                <div className="service-hours-row" key={service.key}>
                  <label className="service-enabled-toggle">
                    <input
                      type="checkbox"
                      checked={draftSettings.servicesEnabled.includes(service.key)}
                      onChange={(event) => updateServiceEnabled(service.key, event.target.checked)}
                    />
                    <strong>{service.label}</strong>
                  </label>
                  <label>
                    Inicio
                    <input
                      type="time"
                      value={draftSettings.serviceHours[service.key].start}
                      onChange={(event) => updateServiceHour(service.key, 'start', event.target.value)}
                    />
                  </label>
                  <label>
                    Fin
                    <input
                      type="time"
                      value={draftSettings.serviceHours[service.key].end}
                      onChange={(event) => updateServiceHour(service.key, 'end', event.target.value)}
                    />
                  </label>
                </div>
              ))}
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
            </>
          )}

          {(!isDemoMode || activeSettingsTab === 'capacity') && (
          <div className={isDemoMode ? 'slot-capacity-section is-first' : 'slot-capacity-section'}>
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
          )}
        </article>
        )}

        {(!isDemoMode || activeSettingsTab === 'general') && (
        <article className="settings-card">
          <div className="section-title compact">
            <div>
              <p className="eyebrow">Settings restaurante</p>
              <h2>Reservas</h2>
            </div>
          </div>
          <SwitchRow label="Reservas activas" checked={draftSettings.reservasActivas} onChange={(value) => updateDraft('reservasActivas', value)} />
          <SwitchRow label="WhatsApp confirmacion" checked={draftSettings.whatsappConfirmation} onChange={(value) => updateDraft('whatsappConfirmation', value)} />
          <div className="settings-grid inner">
            <label>
              Telefono alertas feedback
              <input value={draftSettings.feedbackAlertPhone} onChange={(event) => updateDraft('feedbackAlertPhone', event.target.value)} />
            </label>
          </div>
          <SwitchRow label="WhatsApp pre-cena" checked={draftSettings.whatsappPreCena} onChange={(value) => updateDraft('whatsappPreCena', value)} />
          <div className="settings-grid inner">
            <label>
              Minutos de antelacion
              <input
                disabled={!draftSettings.whatsappPreCena}
                min={MIN_PRE_DINNER_MINUTES}
                max={MAX_PRE_DINNER_MINUTES}
                step={1}
                type="number"
                value={draftSettings.whatsappPreCenaMinutes}
                onChange={(event) => updateDraft('whatsappPreCenaMinutes', Number(event.target.value))}
              />
              <small>Se enviara un recordatorio antes de la reserva. Las reservas creadas despues de la ventana de envio no recibiran el mensaje.</small>
            </label>
          </div>
          <SwitchRow label="Mensaje post-cena" checked={draftSettings.mensajePostCena} onChange={(value) => updateDraft('mensajePostCena', value)} />
          <div className="settings-grid inner">
            <label>
              Hora de envío del mensaje post-cena
              <input
                disabled={!draftSettings.mensajePostCena}
                type="time"
                value={draftSettings.mensajePostCenaHora}
                onChange={(event) => updateDraft('mensajePostCenaHora', event.target.value)}
              />
              <small>Se enviará al día siguiente a los clientes que hayan asistido y aún no hayan recibido la invitación de feedback.</small>
            </label>
          </div>
        </article>
        )}

        {userRole === 'admin' && (!isDemoMode || activeSettingsTab === 'advanced' || activeSettingsTab === 'tables' || activeSettingsTab === 'resources') && (
          <article className="settings-card admin-card">
            {isSuperAdmin && (!isDemoMode || activeSettingsTab === 'advanced') && (
              <div className="solo-superadmin">
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
                Logo restaurante URL <span className="field-note">URL publica del logo del restaurante</span>
                <input value={draftSettings.restaurantLogoUrl} onChange={(event) => updateDraft('restaurantLogoUrl', event.target.value)} placeholder="https://..." />
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
            <div className="settings-subsection client-license-card">
              <div className="section-title compact">
                <div>
                  <p className="eyebrow">Licencia COSTABOTS</p>
                  <h2>Cliente operativo</h2>
                </div>
                <span className={`status-pill license-${licenseDraft.status.toLowerCase()}`}>{licenseDraft.status}</span>
              </div>
              <div className="settings-grid inner">
                <label>
                  Estado cliente
                  <select
                    value={licenseDraft.status}
                    onChange={(event) =>
                      setLicenseDraft((current) => ({
                        ...current,
                        status: event.target.value as ClientLicenseStatus,
                      }))
                    }
                  >
                    {CLIENT_LICENSE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Plan
                  <select
                    value={licenseDraft.plan}
                    onChange={(event) =>
                      setLicenseDraft((current) => ({
                        ...current,
                        plan: event.target.value as ClientLicensePlan,
                      }))
                    }
                  >
                    {CLIENT_LICENSE_PLANS.map((plan) => (
                      <option key={plan} value={plan}>
                        {plan}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Fecha vencimiento
                  <input
                    type="datetime-local"
                    value={toDateTimeLocal(licenseDraft.expiresAt)}
                    onChange={(event) =>
                      setLicenseDraft((current) => ({
                        ...current,
                        expiresAt: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <div className="settings-actions-row">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={configurationLocked || licenseSaveState === 'saving' || !onClientLicenseSave}
                  onClick={() => void handleSaveClientLicense()}
                >
                  {licenseSaveState === 'saving' ? 'Guardando...' : 'Guardar licencia'}
                </button>
                {licenseSaveState === 'saved' && <span className="sync-message">Licencia guardada</span>}
                {licenseSaveState === 'error' && <span className="sync-message error">No se pudo guardar la licencia</span>}
              </div>
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
              </div>
            )}

            {(!isDemoMode || activeSettingsTab === 'tables') && (
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
                <button type="button" disabled={configurationLocked} onClick={addTable}>
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
                      <button className={`compact-toggle ${table.active ? 'is-open' : 'is-closed'}`} type="button" disabled={configurationLocked} onClick={() => void onUpdateTable({ ...table, active: !table.active })}>
                        <span>{table.active ? 'Activa' : 'Inactiva'}</span>
                      </button>
                      <button className="secondary-button compact-action" type="button" disabled={configurationLocked} onClick={() => saveTable(table)}>
                        Guardar
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        disabled={configurationLocked || !table.mesaId}
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
            )}

            {(!isDemoMode || activeSettingsTab === 'resources') && (
            <div className="settings-subsection">
              <div className="section-title compact">
                <div>
                  <p className="eyebrow">Costabots Admin</p>
                  <h2>Recursos</h2>
                </div>
                <button className="secondary-button" type="button" disabled={isLoadingResources} onClick={() => void onRefreshResources()}>
                  {isLoadingResources ? 'Actualizando...' : 'Actualizar recursos'}
                </button>
              </div>

              <div className="table-manager-form">
                <label>
                  Nombre recurso
                  <input value={resourceForm.name} onChange={(event) => setResourceForm((current) => ({ ...current, name: event.target.value }))} placeholder="BALINESA_1" />
                </label>
                <label>
                  Zona
                  <input value={resourceForm.zone} onChange={(event) => setResourceForm((current) => ({ ...current, zone: event.target.value }))} placeholder="PISCINA" />
                </label>
                <label>
                  Capacidad
                  <input
                    type="number"
                    min={1}
                    value={resourceForm.capacity}
                    onChange={(event) => setResourceForm((current) => ({ ...current, capacity: Number(event.target.value) }))}
                  />
                </label>
                <button type="button" disabled={configurationLocked} onClick={addResource}>
                  Añadir recurso
                </button>
              </div>

              {resourcesSyncMessage && <p className="sync-message">{resourcesSyncMessage}</p>}

              <div className="table-manager-list">
                {reservableResources.length === 0 && <p className="empty-state">No hay recursos configurados.</p>}
                {reservableResources.map((resource) => {
                  const resourceDraft = resourceDrafts[resource.id] ?? {
                    name: resource.name,
                    zone: resource.zone,
                    capacity: resource.capacity,
                    order: resource.order ?? 1,
                  };

                  return (
                    <div className={`table-manager-item resource-manager-item ${resource.active ? '' : 'is-inactive'}`} key={resource.id}>
                      <input value={resourceDraft.name} onChange={(event) => updateResourceDraft(resource.id, { name: event.target.value })} />
                      <input value={resourceDraft.zone} onChange={(event) => updateResourceDraft(resource.id, { zone: event.target.value })} />
                      <input
                        type="number"
                        min={1}
                        value={resourceDraft.capacity}
                        onChange={(event) => updateResourceDraft(resource.id, { capacity: Number(event.target.value) })}
                      />
                      <button className={`compact-toggle ${resource.active ? 'is-open' : 'is-closed'}`} type="button" disabled={configurationLocked} onClick={() => updateResource(resource, { active: !resource.active })}>
                        <span>{resource.active ? 'Activa' : 'Inactiva'}</span>
                      </button>
                      <button className="secondary-button compact-action" type="button" disabled={configurationLocked} onClick={() => saveResource(resource)}>
                        Guardar
                      </button>
                      <button className="danger-button" type="button" disabled={configurationLocked} onClick={() => deleteResource(resource)}>
                        Borrar
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </article>
        )}
      </section>

      <section className="settings-save-bar">
        <span className={`save-indicator is-${saveState}`}>
          {settingsValidationMessage || (saveState === 'dirty' ? '● Cambios pendientes' : saveState === 'saving' ? 'Guardando...' : saveState === 'error' ? 'Guardado local, sin sincronizar' : '✓ Configuración guardada')}
        </span>
        <button type="button" disabled={configurationLocked || saveState === 'saving'} onClick={handleSaveSettings}>
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
