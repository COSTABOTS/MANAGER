import { getActiveManagerClientId, invokeManagerApi } from './managerApiClient';
import { createServiceActivationClient } from './serviceActivationContract';

export const saveServiceActivation = createServiceActivationClient(
  (body) => invokeManagerApi(body),
  getActiveManagerClientId,
);
