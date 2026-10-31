export function parseSharedCapacityResponse(value: unknown, expectedClientId: string): Record<string, number> {
  if (!value || typeof value !== 'object') throw new Error('CAPACITY_READ_UNVERIFIED');
  const response = value as Record<string, unknown>;
  if (response.ok !== true || response.client_id !== expectedClientId || !Array.isArray(response.shared)) {
    throw new Error('CAPACITY_READ_UNVERIFIED');
  }
  const slots: Record<string, number> = {};
  for (const value of response.shared) {
    if (!value || typeof value !== 'object') throw new Error('CAPACITY_READ_UNVERIFIED');
    const row = value as Record<string, unknown>;
    const time = String(row.hora ?? '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || typeof row.limite !== 'number'
      || !Number.isInteger(row.limite) || row.limite < 0
      || typeof row.activo !== 'boolean') throw new Error('CAPACITY_READ_UNVERIFIED');
    slots[time] = row.activo ? Number(row.limite) : 0;
  }
  return slots;
}
