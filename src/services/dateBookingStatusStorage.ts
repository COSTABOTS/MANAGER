import type { DateBookingStatus, DateBookingStatusValue } from '../types';

const DATE_BOOKING_STATUS_STORAGE_KEY = 'manager_date_booking_status';
const VALID_STATUSES: DateBookingStatusValue[] = ['open', 'fully_booked'];

export function loadDateBookingStatusFromStorage(): DateBookingStatus {
  try {
    const stored = window.localStorage.getItem(DATE_BOOKING_STATUS_STORAGE_KEY);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return Object.entries(parsed).reduce<DateBookingStatus>((statuses, [date, status]) => {
      if (VALID_STATUSES.includes(status as DateBookingStatusValue)) {
        statuses[date] = status as DateBookingStatusValue;
      }
      return statuses;
    }, {});
  } catch {
    return {};
  }
}

export function saveDateBookingStatusToStorage(statuses: DateBookingStatus) {
  try {
    window.localStorage.setItem(DATE_BOOKING_STATUS_STORAGE_KEY, JSON.stringify(statuses));
  } catch {
    // Local storage can be unavailable in private browsing or restricted contexts.
  }
}

export function clearDateBookingStatusStorage() {
  try {
    window.localStorage.removeItem(DATE_BOOKING_STATUS_STORAGE_KEY);
  } catch {
    // Local storage can be unavailable in private browsing or restricted contexts.
  }
}
