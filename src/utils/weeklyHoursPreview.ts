type PreviewContext = {
  origin: string;
  environment?: string;
  branch?: string;
  deploymentUrl?: string;
  branchUrl?: string;
};

export function isWeeklyHoursPreview(context: PreviewContext): boolean {
  if (context.environment !== 'preview' || context.branch !== 'feature/weekly-hours-availability') return false;
  if (context.origin === 'https://manager-preview.costabots.com') return true;
  const allowedHosts = [context.deploymentUrl, context.branchUrl].filter((host) =>
    Boolean(host?.startsWith('manager-') && host.endsWith('-costabots-projects.vercel.app')),
  );
  return allowedHosts.some((host) => context.origin === `https://${host}`);
}
