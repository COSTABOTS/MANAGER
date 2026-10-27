import { useEffect, useRef, useState } from 'react';
import { getPoolHours, savePoolHours } from '../services/poolHoursApi';
import {
  canSavePoolHours,
  initialPoolHoursRemoteState,
  loadedPoolHoursRemoteState,
  poolHoursConflictState,
  poolHoursErrorState,
} from '../utils/poolHoursRemoteState';

export function BalinesePoolRemote({ clientId }: { clientId: string }) {
  const activeClientId = useRef(clientId);
  activeClientId.current = clientId;
  const [state, setState] = useState(() => initialPoolHoursRemoteState(clientId));
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState(initialPoolHoursRemoteState(clientId));
    setMessage('Cargando el horario de piscina guardado…');
    if (!clientId) {
      setState(poolHoursErrorState(initialPoolHoursRemoteState(clientId)));
      setMessage('No hay un restaurante autenticado. No se puede guardar.');
      return () => { cancelled = true; };
    }
    void getPoolHours().then((snapshot) => {
      if (cancelled) return;
      setState(loadedPoolHoursRemoteState(clientId, snapshot));
      setMessage(snapshot.configured
        ? 'Horario de piscina cargado desde Supabase. Guardarlo no activa reservas ni modifica capacidades.'
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

  function changeHours(patch: { openingTime?: string; closingTime?: string }) {
    if (!editable) return;
    setState((previous) => previous.clientId === clientId ? { ...previous, ...patch } : previous);
    setMessage('Cambios pendientes. No afectan a las reservas hasta que se guarden.');
  }

  async function saveDraft() {
    if (!canSavePoolHours(current) || !clientId) return;
    const submitted = current;
    setState((previous) => previous.clientId === clientId ? { ...previous, status: 'saving' } : previous);
    setMessage('Guardando el horario…');
    try {
      const saved = await savePoolHours(submitted.openingTime, submitted.closingTime, submitted.revision);
      if (activeClientId.current !== clientId) return;
      setState((previous) => previous.clientId === clientId ? loadedPoolHoursRemoteState(clientId, saved) : previous);
      setMessage('Horario guardado. El corte de reservas sigue sin activar.');
    } catch (error) {
      if (activeClientId.current !== clientId) return;
      const code = error instanceof Error ? error.message : String(error);
      setState((previous) => previous.clientId !== clientId ? previous
        : code.includes('POOL_HOURS_CONFLICT') ? poolHoursConflictState(previous) : poolHoursErrorState(previous));
      setMessage(code.includes('POOL_HOURS_CONFLICT')
        ? 'Otro cambio actualizó el horario. Tu borrador sigue visible; compara con la versión actual antes de volver a guardar.'
        : 'No se pudo confirmar el guardado. Tu borrador sigue visible; vuelve a leer el horario antes de intentar otra vez.');
    }
  }

  return (
    <article className="settings-card balinese-pool-preview" aria-label="Horario de piscina de Balinesa">
      <div className="section-title compact"><div><p className="eyebrow">Configuración remota</p><h2>Balinesa · horario de piscina</h2></div></div>
      <p className="weekly-hours-notice">El horario es informativo y sirve como corte de reservas del mismo día cuando esa regla se active. Balinesa se reserva por fecha, sin elegir hora. Este editor no modifica SERVICES_ENABLED, capacidades ni reservas.</p>
      <p role="status">{message}</p>
      <div className="balinese-pool-hours">
        <label>Hora de apertura de piscina
          <input type="time" value={current.openingTime} disabled={!editable} onChange={(event) => changeHours({ openingTime: event.target.value })} />
        </label>
        <label>Hora de cierre de piscina
          <input type="time" value={current.closingTime} disabled={!editable} onChange={(event) => changeHours({ closingTime: event.target.value })} />
        </label>
      </div>
      <button type="button" disabled={!canSavePoolHours(current)} onClick={() => void saveDraft()}>Guardar horario de piscina</button>
      {current.status === 'conflict' && <p className="weekly-rule-error">El guardado está bloqueado para evitar sobrescribir cambios ajenos. Copia tu borrador si lo necesitas y recarga la página.</p>}
      {current.status === 'error' && <p className="weekly-rule-error">El guardado está bloqueado hasta verificar de nuevo la configuración del servidor.</p>}
    </article>
  );
}
