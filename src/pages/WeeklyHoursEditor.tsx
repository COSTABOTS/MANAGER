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

interface WeeklyHoursEditorProps {
  clientId: string;
  servicesEnabled: BookingService[];
}

const SERVICE_LABELS: Record<ServiceWithHours, string> = {
  DESAYUNO: 'Desayuno',
  ALMUERZO: 'Almuerzo',
  CENA: 'Cena',
};

function storageKey(clientId: string) {
  return `costabots.weekly-hours-draft.v1:${clientId}`;
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

export function WeeklyHoursEditor({ clientId, servicesEnabled }: WeeklyHoursEditorProps) {
  const [state, setState] = useState(() => ({ clientId, draft: loadDraft(clientId) }));
  const [storageError, setStorageError] = useState(false);
  const [remote, setRemote] = useState<{ clientId: string; revision: string; draft: WeeklyHoursDraft } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const localDraftExists = hasStoredDraft(clientId);
    setState({ clientId, draft: loadDraft(clientId) });
    setRemote(null);
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
  }, [clientId]);

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
  const activeRestaurantServices = RESTAURANT_SERVICES.filter((service) => servicesEnabled.includes(service));
  const canEdit = remote?.clientId === clientId && !isSaving;

  function updateDraft(next: WeeklyHoursDraft) {
    setState({ clientId, draft: next });
    setMessage('Cambios pendientes. El calendario semanal sigue sin activar.');
  }

  async function saveDraft() {
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
          <p className="eyebrow">Configuración en desarrollo</p>
          <h2>Horarios semanales por servicio</h2>
        </div>
      </div>
      <p className="weekly-hours-notice">
        Puedes guardar las 21 reglas de forma independiente. Guardarlas no activa el calendario semanal ni modifica las reservas o capacidades.
      </p>
      {activeRestaurantServices.length === 0 && (
        <p className="weekly-hours-notice">No hay servicios de restaurante activados. Balinesa usa su configuración independiente.</p>
      )}
      {RESTAURANT_SERVICES.map((service) => {
        const globallyEnabled = servicesEnabled.includes(service);
        return (
          <section className="weekly-service" key={service} aria-label={`Horario de ${SERVICE_LABELS[service]}`}>
            <div className="weekly-service-heading">
              <h3>{SERVICE_LABELS[service]}</h3>
              <span>{globallyEnabled ? 'Servicio activado' : 'Desactivado en Servicios'}</span>
            </div>
            {!globallyEnabled && <p className="weekly-service-hint">Activa este servicio en «Horarios de servicio» para editarlo. Su borrador se conserva.</p>}
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
      {remote?.clientId === clientId && JSON.stringify(draft) !== JSON.stringify(remote.draft) && (
        <button type="button" className="secondary-button" disabled={isSaving} onClick={() => {
          setState({ clientId, draft: remote.draft });
          setMessage('Versión guardada cargada. El borrador local anterior se ha sustituido.');
        }}>Cargar versión guardada</button>
      )}
      <button type="button" disabled={!remote || remote.clientId !== clientId || isSaving || !isCompleteWeeklyDraft(draft)} onClick={() => { void saveDraft(); }}>
        {isSaving ? 'Guardando…' : 'Guardar horarios semanales'}
      </button>
    </article>
  );
}
