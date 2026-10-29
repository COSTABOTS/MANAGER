import { isWeeklyHoursSettingsSurface, type PreviewContext } from './weeklyHoursPreview';

// The remote editor is limited to the verified Preview origin, environment and branch.
export const REMOTE_HOURS_PREVIEW_ENABLED = true;

export function canUseRemoteHoursPreview(
  context: PreviewContext,
  clientId: string,
  settingsVerified: boolean,
  isProtectedDemo: boolean,
  enabled = REMOTE_HOURS_PREVIEW_ENABLED,
): boolean {
  return enabled && Boolean(clientId.trim()) && settingsVerified && !isProtectedDemo && isWeeklyHoursSettingsSurface(context);
}
