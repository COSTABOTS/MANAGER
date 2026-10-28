import type { PoolHoursSnapshot } from '../services/poolHoursApiContract';
import { isValidPoolHours } from './balinesePoolPreview';

export type PoolHoursRemoteState = {
  clientId: string;
  status: 'loading' | 'ready' | 'unconfigured' | 'saving' | 'conflict' | 'error';
  openingTime: string;
  closingTime: string;
  revision: string | null;
};

export function initialPoolHoursRemoteState(clientId: string): PoolHoursRemoteState {
  return { clientId, status: 'loading', openingTime: '', closingTime: '', revision: null };
}

export function loadedPoolHoursRemoteState(clientId: string, snapshot: PoolHoursSnapshot): PoolHoursRemoteState {
  return {
    clientId,
    status: snapshot.configured ? 'ready' : 'unconfigured',
    openingTime: snapshot.opening_time ?? '',
    closingTime: snapshot.closing_time ?? '',
    revision: snapshot.revision,
  };
}

export function canSavePoolHours(state: PoolHoursRemoteState): boolean {
  return (state.status === 'ready' || state.status === 'unconfigured')
    && isValidPoolHours(state.openingTime, state.closingTime);
}

export function poolHoursConflictState(state: PoolHoursRemoteState): PoolHoursRemoteState {
  return { ...state, status: 'conflict' };
}

export function poolHoursErrorState(state: PoolHoursRemoteState): PoolHoursRemoteState {
  return { ...state, status: 'error' };
}
