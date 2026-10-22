import {
  CALENDAR,
  CALENDAR_PROVIDER_IDS,
  type CalendarProviderId,
} from "../../../shared/constants";
import { googleCalendarProvider } from "./google";
import {
  CalendarProviderError,
  type CalendarProvider,
} from "./types";

/**
 * Provider registry.
 *
 * The single place that knows which calendar providers exist. Adding Microsoft
 * Outlook means writing `providers/microsoft.ts` against the same interface
 * and adding one line here — the connection service, the sync service, the
 * schema (which stores `provider` as a plain string) and the UI all follow
 * without changes.
 */
const PROVIDERS: Record<CalendarProviderId, CalendarProvider> = {
  google: googleCalendarProvider,
};

export function calendarProvider(id: string): CalendarProvider {
  if (!isSupportedProvider(id)) {
    throw new CalendarProviderError(
      "permanent",
      `No calendar provider registered for "${id}".`,
    );
  }
  return PROVIDERS[id];
}

export function isSupportedProvider(id: string): id is CalendarProviderId {
  return (CALENDAR_PROVIDER_IDS as readonly string[]).includes(id);
}

/** Product-facing name, falling back to the raw id for unknown providers. */
export function providerLabel(id: string): string {
  return CALENDAR.providerLabel[id] ?? id;
}
