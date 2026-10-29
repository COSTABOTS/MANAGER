import { readWeeklyHours, saveWeeklyHours, weeklyHoursHttpStatus, type WeeklyHoursAccess } from './weeklyHoursActions.ts';

export type WeeklyHoursAuthContext = { clientId: string; role: string; serviceRoleAvailable: boolean };
export type WeeklyHoursResponseWriters = {
  success(request: Request, payload: Record<string, unknown>): Response;
  failure(request: Request, code: string, status: number): Response;
};

/** Production passes its resolved JWT/profile context; tests inject an isolated resolver. */
export async function handleWeeklyHoursHttp(
  request: Request,
  body: Record<string, unknown>,
  action: 'weeklyHours.get' | 'weeklyHours.save',
  authorize: (request: Request) => Promise<WeeklyHoursAuthContext | Response | null>,
  createAccess: () => WeeklyHoursAccess,
  respond: WeeklyHoursResponseWriters,
  canWrite: (resolvedClientId: string) => boolean,
): Promise<Response> {
  if (request.method !== 'POST') return respond.failure(request, 'METHOD_NOT_ALLOWED', 405);
  const context = await authorize(request);
  if (context instanceof Response) return context;
  if (!context?.clientId) return respond.failure(request, 'UNAUTHENTICATED', 401);
  if (!context.serviceRoleAvailable) return respond.failure(request, 'WEEKLY_HOURS_UNAVAILABLE', 503);
  if (action === 'weeklyHours.save' && context.role !== 'ADMIN' && context.role !== 'ADMIN-CLIENTE' && context.role !== 'ADMIN_CLIENTE' && context.role !== 'SUPER_ADMIN') {
    return respond.failure(request, 'FORBIDDEN', 403);
  }
  if (action === 'weeklyHours.save' && !canWrite(context.clientId)) {
    return respond.failure(request, 'WEEKLY_HOURS_WRITE_DISABLED', 403);
  }
  const result = action === 'weeklyHours.get'
    ? await readWeeklyHours(createAccess(), context.clientId)
    : await saveWeeklyHours(createAccess(), context.clientId, body.rules, body.expected_revision);
  if (!result.ok) return respond.failure(request, result.code, weeklyHoursHttpStatus(result.code));
  return respond.success(request, {
    ok: true, action, client_id: context.clientId, rules: result.rules, revision: result.revision,
  });
}
