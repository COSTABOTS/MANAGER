export type WeeklyHoursRow = {
  weekday: number;
  service: 'DESAYUNO' | 'ALMUERZO' | 'CENA';
  enabled: boolean;
  start_time: string | null;
  end_time: string | null;
};

export type WeeklyHoursResponse = {
  ok: true;
  action: 'weeklyHours.get' | 'weeklyHours.save';
  client_id: string;
  rules: WeeklyHoursRow[];
  revision: string;
};

export type WeeklyHoursInvoker = (body: Record<string, unknown>) => Promise<unknown>;

export function parseWeeklyHoursResponse(
  value: unknown,
  action: WeeklyHoursResponse['action'],
  expectedClientId: string,
): WeeklyHoursResponse {
  if (!value || typeof value !== 'object') throw new Error('WEEKLY_HOURS_RESPONSE_INVALID');
  const response = value as Record<string, unknown>;
  if (response.ok !== true || response.action !== action || response.client_id !== expectedClientId
      || !Array.isArray(response.rules) || typeof response.revision !== 'string'
      || !/^[a-f0-9]{64}$/.test(response.revision)) {
    throw new Error(typeof response.code === 'string' ? response.code : 'WEEKLY_HOURS_RESPONSE_INVALID');
  }
  return response as WeeklyHoursResponse;
}

export function createWeeklyHoursApi(call: WeeklyHoursInvoker, activeClientId: () => string) {
  function assertClient(expectedClientId: string) {
    if (!expectedClientId || activeClientId() !== expectedClientId) throw new Error('WEEKLY_HOURS_TENANT_CHANGED');
  }
  return {
    async get(expectedClientId: string): Promise<WeeklyHoursResponse> {
      assertClient(expectedClientId);
      return parseWeeklyHoursResponse(await call({ action: 'weeklyHours.get' }), 'weeklyHours.get', expectedClientId);
    },
    async save(expectedClientId: string, rules: WeeklyHoursRow[], expectedRevision: string): Promise<WeeklyHoursResponse> {
      assertClient(expectedClientId);
      return parseWeeklyHoursResponse(await call({
        action: 'weeklyHours.save', rules, expected_revision: expectedRevision,
      }), 'weeklyHours.save', expectedClientId);
    },
  };
}
