import { isWeeklyHoursPreview, type PreviewContext } from './weeklyHoursPreview';

// A later reviewed code change must explicitly open this gate after manager-api is deployed.
export const REMOTE_HOURS_PREVIEW_ENABLED = false;

export function canUseRemoteHoursPreview(
  context: PreviewContext,
  clientId: string,
  settingsVerified: boolean,
  isDemoMode: boolean,
  enabled = REMOTE_HOURS_PREVIEW_ENABLED,
): boolean {
  return enabled && Boolean(clientId.trim()) && settingsVerified && !isDemoMode && isWeeklyHoursPreview(context);
}
