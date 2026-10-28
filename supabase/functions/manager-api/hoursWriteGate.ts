/** Closed by default. Only an explicit server flag and exact resolved tenant ID enable writes. */
export function canWriteRemoteHours(
  resolvedClientId: string,
  enabled: string | undefined,
  allowedClientIds: string | undefined,
): boolean {
  if (enabled !== 'true' || !resolvedClientId || !allowedClientIds) return false;
  return allowedClientIds.split(',').some((value) => value.trim() === resolvedClientId);
}

/** Keep existing Manager auth responses unchanged; new hours actions return HTTP 401. */
export function hoursAuthFailureStatus(action: unknown): number {
  return action === 'weeklyHours.get' || action === 'weeklyHours.save'
    || action === 'poolHours.get' || action === 'poolHours.save' ? 401 : 200;
}
