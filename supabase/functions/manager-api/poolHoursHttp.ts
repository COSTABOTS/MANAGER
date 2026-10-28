import { executePoolHoursAction, poolHoursHttpStatus, type PoolHoursAccess } from './poolHoursActions.ts';

export type PoolHoursAuthContext = { clientId: string; role: string; serviceRoleAvailable: boolean };
export type PoolHoursResponseWriters = {
  success(request: Request, payload: Record<string, unknown>): Response;
  failure(request: Request, code: string, status: number): Response;
};

/** HTTP action boundary. Production supplies an already resolved JWT/profile context; tests inject a fake resolver. */
export async function handlePoolHoursHttp(
  request: Request,
  body: Record<string, unknown>,
  action: 'poolHours.get' | 'poolHours.save',
  authorize: (request: Request) => Promise<PoolHoursAuthContext | Response | null>,
  createAccess: () => PoolHoursAccess,
  respond: PoolHoursResponseWriters,
  canWrite: (resolvedClientId: string) => boolean,
): Promise<Response> {
  if (request.method !== 'POST') return respond.failure(request, 'METHOD_NOT_ALLOWED', 405);
  const context = await authorize(request);
  if (context instanceof Response) return context;
  if (!context?.clientId) return respond.failure(request, 'UNAUTHENTICATED', 401);
  if (!context.serviceRoleAvailable) return respond.failure(request, 'POOL_HOURS_UNAVAILABLE', 503);
  if (action === 'poolHours.save' && context.role !== 'ADMIN' && context.role !== 'ADMIN-CLIENTE' && context.role !== 'SUPER_ADMIN') {
    return respond.failure(request, 'FORBIDDEN', 403);
  }
  if (action === 'poolHours.save' && !canWrite(context.clientId)) {
    return respond.failure(request, 'POOL_HOURS_WRITE_DISABLED', 403);
  }
  const result = await executePoolHoursAction(createAccess(), action, context.clientId, body);
  if (!result.ok) return respond.failure(request, result.code, poolHoursHttpStatus(result.code));
  return respond.success(request, { ok: true, action, client_id: context.clientId, ...result.snapshot });
}
