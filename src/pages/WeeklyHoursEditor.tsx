import { useEffect, useState } from 'react';
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
}

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

function loadDraft(clientId: string): WeeklyHoursDraft {
  if (!clientId) return createWeeklyHoursDraft();
  try {
    const saved = window.localStorage.getItem(storageKey(clientId));
    return saved ? parseWeeklyHoursDraft(JSON.parse(saved)) ?? createWeeklyHoursDraft() : createWeeklyHoursDraft();
  } catch {
    return createWeeklyHoursDraft();
  }
}

function hasStoredDraft(clientId: string) {
  try { return Boolean(clientId && window.localStorage.getItem(storageKey(clientId))); }
  catch { return false; }
}

export function WeeklyHoursEditor({ clientId, servicesEnabled, localOnly = false, settingsVerified = false }: WeeklyHoursEditorProps) {
  const [state, setState] = useState(() => ({ clientId, draft: loadDraft(clientId) }));
  const [previewServices, setPreviewServices] = useState(() => ({ clientId, enabled: loadPreviewServices(clientId, servicesEnabled, settingsVerified) }));
  const [storageError, setStorageError] = useState(false);
  const [remote, setRemote] = useState<{ clientId: string; revision: string; draft: WeeklyHoursDraft } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const localDraftExists = hasStoredDraft(clientId);
    setState({ clientId, draft: loadDraft(clientId) });
    setPreviewServices({ clientId, enabled: loadPreviewServices(clientId, servicesEnabled, settingsVerified) });
    setRemote(null);
    if (localOnly) {
      setMessage('Borrador local cargado. No afecta a las reservas.');
      return () => { cancelled = true; };
    }
    setMessage('Cargando horarios guardados…');
    if (clientId) {
      void getWeeklyHours().then((response) => {
        if (cancelled) return;
        const serverDraft = draftFromWeeklyRows(response.rules);
        if (!serverDraft) throw new Error('WEEKLY_HOURS_INVALID');
        setRemote({ clientId, revision: response.revision, draft: serverDraft });
        if (!localDraftExists) setState({ clientId, draft: serverDraft });
        setMessage(localDraftExists && JSON.stringify(loadDraft(clientId)) !== JSON.stringify(serverDraft)
          ? 'Existe un borrador local distinto de los horarios guardados. Revisa antes de guardar o carga la versión del servidor.'
          : 'Horarios cargados. El calendario semanal sigue sin activar.');
      }).catch((error: unknown) => {
        if (!cancelled) setMessage(`No se pudieron leer los horarios: ${error instanceof Error ? error.message : String(error)}. No se puede guardar.`);
      });
    }
    return () => { cancelled = true; };
  }, [clientId, localOnly, settingsVerified]);

  useEffect(() => {
    if (!clientId || state.clientId !== clientId) return;
    try {
      window.localStorage.setItem(storageKey(clientId), JSON.stringify(state.draft));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [clientId, state]);

  const draft = state.clientId === clientId ? state.draft : loadDraft(clientId);
  const localServices = previewServices.clientId === clientId
    ? previewServices.enabled
    : loadPreviewServices(clientId, servicesEnabled, settingsVerified);
  const activeRestaurantServices = RESTAURANT_SERVICES.filter((service) => servicesEnabled.includes(service));
  const canEdit = localOnly ? Boolean(clientId) : remote?.clientId === clientId && !isSaving;
  const summary = localOnly && settingsVerified ? summarizeWeeklyDraft(draft, localServices) : null;

  function updateDraft(next: WeeklyHoursDraft) {
    setState({ clientId, draft: next });
    setMessage(localOnly ? 'Borrador local actualizado. No afecta a las reservas.' : 'Cambios pendientes. El calendario semanal sigue sin activar.');
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
    setMessage('Borrador local actualizado. No afecta a SERVICES_ENABLED ni a las reservas.');
  }

  async function saveDraft() {
    if (localOnly) {
      try {
        window.localStorage.setItem(storageKey(clientId), JSON.stringify(draft));
        window.localStorage.setItem(servicesStorageKey(clientId), JSON.stringify(localServices));
        setStorageError(false);
        setMessage('Borrador guardado solo en este navegador. No afecta a las reservas.');
      } catch {
        setStorageError(true);
        setMessage('No se pudo guardar el borrador en este navegador.');
      }
      return;
    }
    if (!remote || remote.clientId !== clientId || isSaving || !isCompleteWeeklyDraft(draft)) return;
    setIsSaving(true);
    setMessage('Guardando 21 reglas…');
    try {
      const response = await saveWeeklyHours(toWeeklyHoursRows(draft), remote.revision);
      const savedDraft = draftFromWeeklyRows(response.rules);
      if (!savedDraft) throw new Error('WEEKLY_HOURS_INVALID');
      setRemote({ clientId, revision: response.revision, draft: savedDraft });
      setState({ clientId, draft: savedDraft });
      setMessage('21 reglas guardadas. El calendario semanal sigue sin activar.');
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code.includes('WEEKLY_HOURS_CONFLICT')) {
        setRemote(null);
        setMessage('Otro cambio actualizó los horarios. Conservamos tu borrador local. Recarga la página y compara antes de guardar.');
      } else {
        setMessage(`No se guardaron los horarios: ${code}`);
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="settings-card weekly-hours-editor" aria-label="Horarios semanales">
      <div className="section-title compact">
        <div>
          <p className="eyebrow">{localOnly ? 'Vista de prueba' : 'Configuración en desarrollo'}</p>
          <h2>Horarios semanales por servicio</h2>
        </div>
      </div>
      <p className="weekly-hours-notice">
        {localOnly
          ? 'Vista de prueba: los horarios se guardan solo en este navegador. No afectan a las reservas.'
          : 'Puedes guardar las 21 reglas de forma independiente. Guardarlas no activa el calendario semanal ni modifica las reservas o capacidades.'}
      </p>
      {localOnly && <div className="weekly-summary" aria-label="Resumen del borrador semanal">
        <p className="eyebrow">Resumen automático · borrador local</p>
        {!settingsVerified ? <p>No se han verificado los Settings del restaurante. El resumen no se muestra hasta que carguen correctamente.</p>
          : summary === null ? <p>Completa las horas de los días abiertos para ver un resumen fiable.</p>
          : summary.map((group) => <p key={group.days.join('-')}><strong>{group.days.join(', ')}</strong>: {group.turns.length ? group.turns.join(' · ') : 'Cerrado'}</p>)}
      </div>}
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
              </label> : <span>{globallyEnabled ? 'Servicio activado' : 'Desactivado en Servicios'}</span>}
            </div>
            {!globallyEnabled && <p className="weekly-service-hint">{localOnly ? 'Activa el servicio en este borrador para editar sus siete días. Los horarios anteriores se conservan.' : 'Activa este servicio en «Horarios de servicio» para editarlo. Su borrador se conserva.'}</p>}
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
                      Fin (exclusivo)
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
        {message || (isCompleteWeeklyDraft(draft) ? '21 reglas en el borrador local. Sin activar.' : 'Completa las horas de los días abiertos.')}
      </p>
      {storageError && <p className="weekly-rule-error">No se pudo conservar el borrador en este navegador.</p>}
      {!localOnly && remote?.clientId === clientId && JSON.stringify(draft) !== JSON.stringify(remote.draft) && (
        <button type="button" className="secondary-button" disabled={isSaving} onClick={() => {
          setState({ clientId, draft: remote.draft });
          setMessage('Versión guardada cargada. El borrador local anterior se ha sustituido.');
        }}>Cargar versión guardada</button>
      )}
      <button type="button" disabled={localOnly ? !clientId : !remote || remote.clientId !== clientId || isSaving || !isCompleteWeeklyDraft(draft)} onClick={() => { void saveDraft(); }}>
        {localOnly ? 'Guardar borrador en este navegador' : isSaving ? 'Guardando…' : 'Guardar horarios semanales'}
      </button>
    </article>
  );
}
