import { useEffect, useState } from 'react';
import {
  emptyBalinesePoolDraft,
  isValidPoolHours,
  loadBalinesePoolDraft,
  saveBalinesePoolDraft,
  type BalinesePoolDraft,
} from '../utils/balinesePoolPreview';

function loadDraft(clientId: string): BalinesePoolDraft {
  try { return loadBalinesePoolDraft(clientId, window.localStorage); }
  catch { return emptyBalinesePoolDraft(); }
}

export function BalinesePoolPreview({ clientId }: { clientId: string }) {
  const [state, setState] = useState(() => ({ clientId, draft: loadDraft(clientId) }));
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    setState({ clientId, draft: loadDraft(clientId) });
    setStorageError(false);
  }, [clientId]);

  const draft = state.clientId === clientId ? state.draft : loadDraft(clientId);

  function updateDraft(patch: Partial<BalinesePoolDraft>) {
    const next = { ...draft, ...patch };
    setState({ clientId, draft: next });
    try {
      saveBalinesePoolDraft(clientId, next, window.localStorage);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }

  const invalidHours = draft.openingTime !== '' && draft.closingTime !== ''
    && !isValidPoolHours(draft.openingTime, draft.closingTime);

  return (
    <article className="settings-card balinese-pool-preview" aria-label="Borrador de horario de piscina para Balinesa">
      <div className="section-title compact"><div><p className="eyebrow">Borrador local</p><h2>Balinesa · horario de piscina</h2></div></div>
      <p className="weekly-hours-notice">Esta configuración se guarda solo en este navegador. No afecta a las reservas.</p>
      <label className="service-enabled-toggle service-enabled-toggle-inline">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft({ enabled: event.target.checked })} />
        <strong>Balinesa activa en el borrador</strong>
      </label>
      {draft.enabled && <div className="balinese-pool-hours">
        <label>Hora de apertura de piscina
          <input type="time" value={draft.openingTime} aria-invalid={invalidHours} onChange={(event) => updateDraft({ openingTime: event.target.value })} />
        </label>
        <label>Hora de cierre de piscina
          <input type="time" value={draft.closingTime} aria-invalid={invalidHours} onChange={(event) => updateDraft({ closingTime: event.target.value })} />
        </label>
      </div>}
      {draft.enabled && (!draft.openingTime || !draft.closingTime) && <p className="weekly-service-hint">Introduce ambas horas; este borrador no tiene horarios reales por defecto.</p>}
      {draft.enabled && invalidHours && <p className="weekly-rule-error">La apertura debe ser anterior al cierre y ambas horas deben tener formato HH:mm.</p>}
      {!draft.enabled && <p className="weekly-service-hint">El servicio está inactivo solo en este borrador. Sus horas anteriores se conservan.</p>}
      {storageError && <p className="weekly-rule-error">No se pudo conservar el borrador en este navegador.</p>}
    </article>
  );
}
