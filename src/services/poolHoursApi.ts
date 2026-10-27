import { invokeManagerApi } from './managerApiClient';
import { createPoolHoursApi } from './poolHoursApiContract';

const poolHoursApi = createPoolHoursApi((body) => invokeManagerApi(body));
export const getPoolHours = poolHoursApi.get;
export const savePoolHours = poolHoursApi.save;
