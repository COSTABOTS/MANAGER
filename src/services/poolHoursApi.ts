import { getActiveManagerClientId, invokeManagerApi } from './managerApiClient';
import { createPoolHoursApi } from './poolHoursApiContract';

const poolHoursApi = createPoolHoursApi((body) => invokeManagerApi(body), getActiveManagerClientId);
export const getPoolHours = poolHoursApi.get;
export const savePoolHours = poolHoursApi.save;
