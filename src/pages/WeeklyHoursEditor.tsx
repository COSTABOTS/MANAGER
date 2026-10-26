import { useEffect, useState } from 'react';
import type { BookingService, ServiceWithHours } from '../types';
import {
  copyWeeklyRuleToOtherDays,
  createWeeklyHoursDraft,
  isCompleteWeeklyDraft,
  isValidWeeklyRule,
  parseWeeklyHoursDraft,
  RESTAURANT_SERVICES,
  updateWeeklyRule,
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

export function WeeklyHoursEditor({ clientId, servicesEnabled }: WeeklyHoursEditorProps) {
  const [state, setState] = useState(() => ({ clientId, draft: loadDraft(clientId) }));
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    setState({ clientId, draft: loadDraft(clientId) });
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

  function updateDraft(next: WeeklyHoursDraft) {
    setState({ clientId, draft: next });
  }

  return (
    <article className="settings-card weekly-hours-editor" aria-label="Borrador de horarios semanales">
      <div className="section-title compact">
        <div>
          <p className="eyebrow">Configuración en desarrollo</p>
          <h2>Horarios semanales por servicio</h2>
        </div>
      </div>
      <p className="weekly-hours-notice">
        Borrador local de este navegador. No se aplica a las reservas ni se envía al servidor.
        Los horarios anteriores siguen vigentes.
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
                        disabled={!globallyEnabled}
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
                        disabled={!globallyEnabled || !rule.enabled}
                        aria-invalid={invalid}
                        onChange={(event) => updateDraft(updateWeeklyRule(draft, service, weekday, { start: event.target.value }))}
                      />
                    </label>
                    <label>
                      Fin (exclusivo)
                      <input
                        type="time"
                        value={rule.end}
                        disabled={!globallyEnabled || !rule.enabled}
                        aria-invalid={invalid}
                        onChange={(event) => updateDraft(updateWeeklyRule(draft, service, weekday, { end: event.target.value }))}
                      />
                    </label>
                    <button
                      className="secondary-button weekly-copy-button"
                      type="button"
                      disabled={!globallyEnabled || invalid}
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
        {storageError
          ? 'No se pudo guardar el borrador en este navegador.'
          : isCompleteWeeklyDraft(draft)
            ? '21 reglas en el borrador local. Sin activar.'
            : 'Completa las horas de los días abiertos. El borrador local permanece sin activar.'}
      </p>
    </article>
  );
}
