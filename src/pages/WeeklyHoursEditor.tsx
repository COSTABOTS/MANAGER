import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { BookingService, ServiceWithHours } from '../types';
import { draftFromWeeklyRows, getWeeklyHours, saveWeeklyHours } from '../services/weeklyHoursApi';
import {
  copyWeeklyRuleToOtherDays,
  createWeeklyHoursDraft,
  isCompleteWeeklyDraft,
  isValidWeeklyRule,
  parseWeeklyHoursDraft,
  RESTAURANT_SERVICES,
  updateWeeklyRule,
  toWeeklyHoursRows,
  WEEKLY_DAYS,
  type WeeklyHoursDraft,
} from '../utils/weeklyHoursDraft';
import { initialPreviewServices, parsePreviewServices, summarizeWeeklyDraft, type PreviewServices } from '../utils/weeklyHoursPreviewDraft';

interface WeeklyHoursEditorProps {
  clientId: string;
  servicesEnabled: BookingService[];
  localOnly?: boolean;
  settingsVerified?: boolean;
  weeklyHoursEnabled?: boolean;
  onServiceActivationChange?: (service: BookingService, enabled: boolean) => Promise<void>;
  canActivateServices?: boolean;
  activationService?: BookingService | null;
  activationMessage?: string;
  unifiedSave?: boolean;
  onPendingChange?: (pending: boolean) => void;
}

export type WeeklyHoursEditorHandle = { savePending: () => Promise<'saved' | 'error' | 'skipped'> };

const SERVICE_LABELS: Record<ServiceWithHours, string> = {
  DESAYUNO: 'Desayuno',
  ALMUERZO: 'Almuerzo',
  CENA: 'Cena',
};

function storageKey(clientId: string) {
  return `costabots.weekly-hours-draft.v1:${clientId}`;
}

function servicesStorageKey(clientId: string) {
  return `costabots.weekly-hours-services-draft.v1:${clientId}`;
}

function loadPreviewServices(clientId: string, servicesEnabled: BookingService[], settingsVerified: boolean): PreviewServices {
  try {
    const saved = clientId && window.localStorage.getItem(servicesStorageKey(clientId));
    if (saved) return parsePreviewServices(JSON.parse(saved)) ?? initialPreviewServices([]);
  } catch { /* Local storage can be unavailable; the draft remains editable in memory. */ }
  return initialPreviewServices(settingsVerified ? servicesEnabled : []);
}

function loadStoredDraft(clientId: string): WeeklyHoursDraft | null {
  if (!clientId) return null;
  try {
    const saved = window.localStorage.getItem(storageKey(clientId));
    return saved ? parseWeeklyHoursDraft(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

function loadDraft(clientId: string): WeeklyHoursDraft {
  return loadStoredDraft(clientId) ?? createWeeklyHoursDraft();
}

export const WeeklyHoursEditor = forwardRef<WeeklyHoursEditorHandle, WeeklyHoursEditorProps>(function WeeklyHoursEditor({
  clientId, servicesEnabled, localOnly = false, settingsVerified = false, weeklyHoursEnabled = false,
  onServiceActivationChange, canActivateServices = false, activationService = null, activationMessage = '',
  unifiedSave = false, onPendingChange,
}: WeeklyHoursEditorProps, ref) {
  const activeClientId = useRef(clientId);
  activeClientId.current = clientId;
  const [state, setState] = useState(() => ({ clientId, draft: localOnly ? loadDraft(clientId) : createWeeklyHoursDraft() }));
  const [previewServices, setPreviewServices] = useState(() => ({ clientId, enabled: loadPreviewServices(clientId, servicesEnabled, settingsVerified) }));
  const [storageError, setStorageError] = useState(false);
  const [remote, setRemote] = useState<{ clientId: string; revision: string; draft: WeeklyHoursDraft; configured: boolean } | null>(null);
  const [storedDraft, setStoredDraft] = useState<WeeklyHoursDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [writeBlocked, setWriteBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const localDraft = loadStoredDraft(clientId);
    setState({ clientId, draft: localOnly ? localDraft ?? createWeeklyHoursDraft() : createWeeklyHoursDraft() });
    setPreviewServices({ clientId, enabled: loadPreviewServices(clientId, servicesEnabled, settingsVerified) });
    setRemote(null);
    setWriteBlocked(false);
    setStoredDraft(localOnly ? null : localDraft);
    setIsSaving(false);
    if (localOnly) {
      setMessage('Borrador local cargado. No afecta a las reservas.');
      return () => { cancelled = true; };
    }
    if (!clientId || !settingsVerified) {
      setMessage('Esperando la configuración del restaurante. No se puede guardar todavía.');
      return () => { cancelled = true; };
    }
    setMessage('Cargando horarios guardados…');
    if (clientId) {
      void getWeeklyHours(clientId).then((response) => {
        if (cancelled) return;
        const serverDraft = draftFromWeeklyRows(response.rules);
        if (!serverDraft) throw new Error('WEEKLY_HOURS_INVALID');
        setRemote({ clientId, revision: response.revision, draft: serverDraft, configured: response.rules.length === 21 });
        setState({ clientId, draft: serverDraft });
        setMessage(localDraft && JSON.stringify(localDraft) !== JSON.stringify(serverDraft)
          ? 'Existe un borrador local distinto. Se muestra la versión del servidor; puedes cargar el borrador expresamente para revisarlo.'
          : weeklyHoursEnabled ? 'Horarios cargados.' : 'Horarios cargados. Aún no se aplican a las reservas.');
      }).catch((error: unknown) => {
        if (!cancelled) setMessage(`No se pudieron leer los horarios: ${error instanceof Error ? error.message : String(error)}. No se puede guardar.`);
      });
    }
    return () => { cancelled = true; };
  }, [clientId, localOnly, settingsVerified, weeklyHoursEnabled]);

  useEffect(() => {
    if (!localOnly || !clientId || state.clientId !== clientId) return;
    try {
      window.localStorage.setItem(storageKey(clientId), JSON.stringify(state.draft));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [clientId, localOnly, state]);

  const draft = state.clientId === clientId ? state.draft : localOnly ? loadDraft(clientId) : createWeeklyHoursDraft();
  const localServices = previewServices.clientId === clientId
    ? previewServices.enabled
    : loadPreviewServices(clientId, servicesEnabled, settingsVerified);
  const activeRestaurantServices = RESTAURANT_SERVICES.filter((service) => servicesEnabled.includes(service));
  const canEdit = localOnly ? Boolean(clientId) : settingsVerified && remote?.clientId === clientId && !isSaving;
  const hasRemoteChanges = writeBlocked || (remote?.clientId === clientId && JSON.stringify(draft) !== JSON.stringify(remote.draft));
  useEffect(() => {
    onPendingChange?.(Boolean(!localOnly && hasRemoteChanges));
  }, [hasRemoteChanges, localOnly, onPendingChange]);
  const summaryVerified = settingsVerified && (localOnly || remote?.clientId === clientId);
  const summaryConfigured = localOnly || remote?.configured === true;
  const summary = summaryVerified && summaryConfigured
    ? summarizeWeeklyDraft(draft, localOnly ? localServices : initialPreviewServices(servicesEnabled)) : null;

  function updateDraft(next: WeeklyHoursDraft) {
    setState({ clientId, draft: next });
    setMessage(localOnly ? 'Borrador local actualizado. No afecta a las reservas.' : 'Cambios pendientes en los horarios.');
  }

  function updateLocalService(service: ServiceWithHours, enabled: boolean) {
    const next = { ...localServices, [service]: enabled };
    setPreviewServices({ clientId, enabled: next });
    try {
      window.localStorage.setItem(servicesStorageKey(clientId), JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
    setMessage('Borrador local actualizado. No afecta a las reservas.');
  }

  async function saveDraft(): Promise<'saved' | 'error' | 'skipped'> {
    if (localOnly) {
      try {
        window.localStorage.setItem(storageKey(clientId), JSON.stringify(draft));
        window.localStorage.setItem(servicesStorageKey(clientId), JSON.stringify(localServices));
        setStorageError(false);
        setMessage('Borrador guardado solo en este navegador. No afecta a las reservas.');
        return 'saved';
      } catch {
        setStorageError(true);
        setMessage('No se pudo guardar el borrador en este navegador.');
        return 'error';
      }
    }
    if (!hasRemoteChanges) return 'skipped';
    if (!settingsVerified || !remote || remote.clientId !== clientId || isSaving || writeBlocked || !isCompleteWeeklyDraft(draft)) return 'error';
    setIsSaving(true);
    setMessage('Guardando horarios…');
    try {
      const response = await saveWeeklyHours(clientId, toWeeklyHoursRows(draft), remote.revision);
      if (activeClientId.current !== clientId) return 'error';
      const savedDraft = draftFromWeeklyRows(response.rules);
      if (!savedDraft) throw new Error('WEEKLY_HOURS_INVALID');
      setRemote({ clientId, revision: response.revision, draft: savedDraft, configured: true });
      setState({ clientId, draft: savedDraft });
      setMessage(weeklyHoursEnabled ? 'Horarios guardados.'
        : 'Horarios guardados. Aún no se aplican a las reservas.');
      return 'saved';
    } catch (error) {
      if (activeClientId.current !== clientId) return 'error';
      const code = error instanceof Error ? error.message : String(error);
      if (code.includes('WEEKLY_HOURS_CONFLICT')) {
        setRemote(null);
        setWriteBlocked(true);
        setMessage('Otro cambio actualizó los horarios. Tu borrador permanece en pantalla; cópialo antes de recargar si lo necesitas.');
      } else {
        setMessage(`No se guardaron los horarios: ${code}`);
      }
      return 'error';
    } finally {
      if (activeClientId.current === clientId) setIsSaving(false);
    }
  }

  useImperativeHandle(ref, () => ({ savePending: saveDraft }));

  return (
    <article className="settings-card weekly-hours-editor" aria-label="Horarios semanales">
      <div className="section-title compact">
        <div>
          <p className="eyebrow">{localOnly ? 'Borrador local' : 'Horarios'}</p>
          <h2>Horarios semanales por servicio</h2>
        </div>
      </div>
      {localOnly && <p className="weekly-hours-notice">El borrador se guarda solo en este navegador. No afecta a las reservas.</p>}
      <div className="weekly-summary" aria-label="Resumen semanal derivado">
        <p className="eyebrow">Resumen de horarios · {localOnly || hasRemoteChanges ? 'borrador' : 'guardado'}</p>
        {!summaryVerified ? <p>No se han verificado los horarios y Settings del restaurante. El resumen no se muestra hasta que carguen correctamente.</p>
          : !summaryConfigured ? <p>Este restaurante aún no tiene un calendario semanal guardado.</p>
          : summary === null ? <p>Completa las horas de los días abiertos para ver un resumen fiable.</p>
          : summary.map((group) => <p key={group.days.join('-')}><strong>{group.days.join(', ')}</strong>: {group.turns.length ? group.turns.join(' · ') : 'Cerrado'}</p>)}
      </div>
      {!localOnly && activeRestaurantServices.length === 0 && (
        <p className="weekly-hours-notice">No hay servicios de restaurante activados. Balinesa usa su configuración independiente.</p>
      )}
      {RESTAURANT_SERVICES.map((service) => {
        const globallyEnabled = localOnly ? localServices[service] : servicesEnabled.includes(service);
        return (
          <section className="weekly-service" key={service} aria-label={`Horario de ${SERVICE_LABELS[service]}`}>
            <div className="weekly-service-heading">
              <h3>{SERVICE_LABELS[service]}</h3>
              {localOnly ? <label className="weekly-service-switch">
                <input type="checkbox" checked={globallyEnabled} disabled={!canEdit} onChange={(event) => updateLocalService(service, event.target.checked)} />
                <span>{globallyEnabled ? 'Activo en borrador' : 'Inactivo en borrador'}</span>
              </label> : <div className="weekly-service-controls">
                <label className="weekly-service-switch">
                  <input
                    type="checkbox"
                    checked={globallyEnabled}
                    disabled={!canActivateServices || !onServiceActivationChange}
                    onChange={(event) => { void onServiceActivationChange?.(service, event.target.checked); }}
                  />
                  <span>{globallyEnabled ? 'Servicio activo' : 'Servicio inactivo'}</span>
                </label>
              </div>}
            </div>
            {!globallyEnabled && <p className="weekly-service-hint">{localOnly ? 'Activa el servicio en este borrador para editar sus siete días. Los horarios anteriores se conservan.' : 'El servicio está desactivado. Sus horarios guardados se conservan y volverán a mostrarse al activarlo.'}</p>}
            {activationService === service && activationMessage && <p className="weekly-hours-status" role="status">{activationMessage}</p>}
            {globallyEnabled && <div className="weekly-days">
              {WEEKLY_DAYS.map(({ weekday, label }) => {
                const rule = draft[service][weekday];
                const invalid = !isValidWeeklyRule(rule);
                return (
                  <div className={`weekly-day${invalid ? ' is-invalid' : ''}`} key={weekday}>
                    <label className="weekly-day-toggle">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={!globallyEnabled || !canEdit}
                        onChange={(event) => updateDraft(updateWeeklyRule(draft, service, weekday, { enabled: event.target.checked }))}
                      />
                      <strong>{label}</strong>
                      <span>{rule.enabled ? 'Abierto' : 'Cerrado'}</span>
                    </label>
                    <label>
                      Inicio
                      <input
                        type="time"
                        value={rule.start}
                        disabled={!globallyEnabled || !rule.enabled || !canEdit}
                        aria-invalid={invalid}
                        onChange={(event) => updateDraft(updateWeeklyRule(draft, service, weekday, { start: event.target.value }))}
                      />
                    </label>
                    <label>
                      Hora de cierre
                      <input
                        type="time"
                        value={rule.end}
                        disabled={!globallyEnabled || !rule.enabled || !canEdit}
                        aria-invalid={invalid}
                        onChange={(event) => updateDraft(updateWeeklyRule(draft, service, weekday, { end: event.target.value }))}
                      />
                    </label>
                    <button
                      className="secondary-button weekly-copy-button"
                      type="button"
                      disabled={!globallyEnabled || invalid || !canEdit}
                      onClick={() => updateDraft(copyWeeklyRuleToOtherDays(draft, service, weekday))}
                      aria-label={`Copiar horario de ${label} al resto de días de ${SERVICE_LABELS[service]}`}
                    >
                      Copiar a la semana
                    </button>
                    {invalid && <p className="weekly-rule-error">Introduce inicio y fin válidos; el fin debe ser posterior al inicio.</p>}
                  </div>
                );
              })}
            </div>}
          </section>
        );
      })}
      <p className="weekly-hours-status" role="status">
        {message || (isCompleteWeeklyDraft(draft) ? 'Horarios completos.' : 'Completa las horas de los días abiertos.')}
      </p>
      {storageError && <p className="weekly-rule-error">No se pudo conservar el borrador en este navegador.</p>}
      {!localOnly && storedDraft && remote?.clientId === clientId && JSON.stringify(storedDraft) !== JSON.stringify(remote.draft) && (
        <button type="button" className="secondary-button" disabled={isSaving} onClick={() => {
          setState({ clientId, draft: storedDraft });
          setMessage('Borrador local cargado para revisión. Los cambios aún no se han guardado.');
        }}>Cargar borrador local para revisar</button>
      )}
      {!localOnly && remote?.clientId === clientId && JSON.stringify(draft) !== JSON.stringify(remote.draft) && (
        <button type="button" className="secondary-button" disabled={isSaving} onClick={() => {
          setState({ clientId, draft: remote.draft });
          setMessage('Versión guardada cargada. El borrador local anterior se ha sustituido.');
        }}>Cargar versión guardada</button>
      )}
      {!unifiedSave && <button type="button" disabled={localOnly ? !clientId : !canEdit || !hasRemoteChanges || !isCompleteWeeklyDraft(draft)} onClick={() => { void saveDraft(); }}>
        {localOnly ? 'Guardar borrador en este navegador' : isSaving ? 'Guardando…' : 'Guardar horarios semanales'}
      </button>}
    </article>
  );
});
