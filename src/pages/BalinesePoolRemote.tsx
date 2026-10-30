import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getPoolHours, savePoolHours } from '../services/poolHoursApi';
import type { PoolHoursSnapshot } from '../services/poolHoursApiContract';
import {
  canSavePoolHours,
  initialPoolHoursRemoteState,
  loadedPoolHoursRemoteState,
  poolHoursConflictState,
  poolHoursErrorState,
} from '../utils/poolHoursRemoteState';

export type BalinesePoolRemoteHandle = { savePending: () => Promise<'saved' | 'error' | 'skipped'> };

export const BalinesePoolRemote = forwardRef<BalinesePoolRemoteHandle, {
  clientId: string; enabled: boolean; onServiceActivationChange: (service: 'BALINESA', enabled: boolean) => Promise<void>;
  canActivateService: boolean; activationMessage: string; unifiedSave?: boolean; onPendingChange?: (pending: boolean) => void;
}>(function BalinesePoolRemote({ clientId, enabled, onServiceActivationChange, canActivateService, activationMessage,
  unifiedSave = false, onPendingChange }, ref) {
  const activeClientId = useRef(clientId);
  activeClientId.current = clientId;
  const [state, setState] = useState(() => initialPoolHoursRemoteState(clientId));
  const [message, setMessage] = useState('');
  const [baseline, setBaseline] = useState<{ clientId: string; snapshot: PoolHoursSnapshot } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState(initialPoolHoursRemoteState(clientId));
    setBaseline(null);
    setMessage('Cargando el horario de piscina guardado…');
    if (!clientId) {
      setState(poolHoursErrorState(initialPoolHoursRemoteState(clientId)));
      setMessage('No hay un restaurante autenticado. No se puede guardar.');
      return () => { cancelled = true; };
    }
    void getPoolHours(clientId).then((snapshot) => {
      if (cancelled) return;
      setState(loadedPoolHoursRemoteState(clientId, snapshot));
      setBaseline({ clientId, snapshot });
      setMessage(snapshot.configured
        ? 'Horario de piscina cargado.'
        : 'Este restaurante aún no tiene un horario de piscina configurado.');
    }).catch(() => {
      if (cancelled) return;
      setState(poolHoursErrorState(initialPoolHoursRemoteState(clientId)));
      setMessage('No se pudo leer el horario del restaurante. El guardado está bloqueado.');
    });
    return () => { cancelled = true; };
  }, [clientId]);

  const current = state.clientId === clientId ? state : initialPoolHoursRemoteState(clientId);
  const editable = current.status === 'ready' || current.status === 'unconfigured';
  const activationError = activationMessage.startsWith('No se') || activationMessage.startsWith('Los servicios');
  const pending = baseline?.clientId === clientId
    && (current.openingTime !== (baseline.snapshot.opening_time ?? '')
      || current.closingTime !== (baseline.snapshot.closing_time ?? ''));
  useEffect(() => {
    onPendingChange?.(Boolean(pending));
  }, [onPendingChange, pending]);

  function changeHours(patch: { openingTime?: string; closingTime?: string }) {
    if (!editable) return;
    setState((previous) => previous.clientId === clientId ? { ...previous, ...patch } : previous);
    setMessage('Cambios pendientes.');
  }

  async function saveDraft(): Promise<'saved' | 'error' | 'skipped'> {
    if (!pending) return 'skipped';
    if (!canSavePoolHours(current) || !clientId) return 'error';
    const submitted = current;
    setState((previous) => previous.clientId === clientId ? { ...previous, status: 'saving' } : previous);
    setMessage('Guardando el horario…');
    try {
      const saved = await savePoolHours(clientId, submitted.openingTime, submitted.closingTime, submitted.revision);
      if (activeClientId.current !== clientId) return 'error';
      setState((previous) => previous.clientId === clientId ? loadedPoolHoursRemoteState(clientId, saved) : previous);
      setBaseline({ clientId, snapshot: saved });
      setMessage('Horario de piscina guardado.');
      return 'saved';
    } catch (error) {
      if (activeClientId.current !== clientId) return 'error';
      const code = error instanceof Error ? error.message : String(error);
      setState((previous) => previous.clientId !== clientId ? previous
        : code.includes('POOL_HOURS_CONFLICT') ? poolHoursConflictState(previous) : poolHoursErrorState(previous));
      setMessage(code.includes('POOL_HOURS_CONFLICT')
        ? 'Otro cambio actualizó el horario. Tu borrador sigue visible; compara con la versión actual antes de volver a guardar.'
        : 'No se pudo confirmar el guardado. Tu borrador sigue visible; vuelve a leer el horario antes de intentar otra vez.');
      return 'error';
    }
  }

  useImperativeHandle(ref, () => ({ savePending: saveDraft }));

  return (
    <article className="settings-card balinese-pool-preview" aria-label="Horario de piscina de Balinesa">
      <div className="section-title compact">
        <div><p className="eyebrow">Balinesa</p><h2>Horario de piscina</h2></div>
        <label className="weekly-service-switch">
          <input type="checkbox" checked={enabled} disabled={!canActivateService} onChange={(event) => { void onServiceActivationChange('BALINESA', event.target.checked); }} />
          <span>{enabled ? 'Servicio activo' : 'Servicio inactivo'}</span>
        </label>
      </div>
      {enabled
        ? <p className="weekly-hours-notice">Balinesa se reserva por fecha, sin elegir hora. Su horario de piscina se conserva aunque desactives el servicio.</p>
        : <p className="weekly-service-hint">Balinesas desactivadas. La configuración guardada se conservará hasta que vuelvas a activar el servicio</p>}
      {(enabled || current.status === 'error' || current.status === 'conflict') && <p role="status">{message}</p>}
      {activationMessage && (enabled || activationError) && <p className="weekly-hours-status" role="status">{activationMessage}</p>}
      {enabled && (
        <>
          <div className="balinese-pool-hours">
            <label>Hora de apertura de piscina
              <input type="time" value={current.openingTime} disabled={!editable} onChange={(event) => changeHours({ openingTime: event.target.value })} />
            </label>
            <label>Hora de cierre de piscina
              <input type="time" value={current.closingTime} disabled={!editable} onChange={(event) => changeHours({ closingTime: event.target.value })} />
            </label>
          </div>
          {!unifiedSave && <button type="button" disabled={!canSavePoolHours(current)} onClick={() => void saveDraft()}>Guardar horario de piscina</button>}
          {current.status === 'conflict' && <p className="weekly-rule-error">El guardado está bloqueado para evitar sobrescribir cambios ajenos. Copia tu borrador si lo necesitas y recarga la página.</p>}
          {current.status === 'error' && <p className="weekly-rule-error">El guardado está bloqueado hasta verificar de nuevo la configuración del servidor.</p>}
        </>
      )}
    </article>
  );
});
