import ICAL from "ical.js";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  color: string;
};

export const MAX_CALENDAR_BYTES = 5 * 1024 * 1024;
export const CALENDAR_COLORS = ["#dfff79", "#ffbca2", "#c8b8ff", "#8ee7dd", "#ffd56a", "#9ac8ff"];

const MAX_CALENDAR_EVENTS = 10_000;
const SAFE_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function startOfWeek(value: Date) {
  const day = value.getDay() || 7;
  return addDays(startOfDay(value), 1 - day);
}

function eventUid(component: ICAL.Component) {
  const uid = component.getFirstPropertyValue("uid");
  return typeof uid === "string" ? uid : "";
}

function isCancelled(event: ICAL.Event) {
  const status = event.component.getFirstPropertyValue("status");
  return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}

function eventColor(event: ICAL.Event) {
  const colorSeed = [...(event.uid || event.summary || "event")]
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const candidate = event.color?.trim();
  return candidate && SAFE_COLOR.test(candidate)
    ? candidate
    : CALENDAR_COLORS[colorSeed % CALENDAR_COLORS.length];
}

function toCalendarEvent(event: ICAL.Event, start: Date, end: Date, suffix = ""): CalendarEvent {
  return {
    id: `${event.uid || event.summary || "event"}${suffix}`,
    title: event.summary?.trim() || "Untitled plan",
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: event.startDate.isDate,
    description: event.description?.trim() || undefined,
    location: event.location?.trim() || undefined,
    color: eventColor(event),
  };
}

function assertCalendarSize(raw: string) {
  if (new TextEncoder().encode(raw).byteLength > MAX_CALENDAR_BYTES) {
    throw new Error("That calendar is too large to import.");
  }
}

function pushEvent(output: CalendarEvent[], event: CalendarEvent) {
  if (output.length >= MAX_CALENDAR_EVENTS) {
    throw new Error("That calendar contains too many events to import.");
  }
  output.push(event);
}

export function parseCalendar(raw: string, now = new Date()): CalendarEvent[] {
  assertCalendarSize(raw);
  const root = new ICAL.Component(ICAL.parse(raw));
  const components = root.getAllSubcomponents("vevent");
  if (components.length > MAX_CALENDAR_EVENTS) {
    throw new Error("That calendar contains too many events to import.");
  }

  ICAL.TimezoneService.reset();
  try {
    for (const timezone of root.getAllSubcomponents("vtimezone")) {
      ICAL.TimezoneService.register(timezone);
    }

    const exceptionsByUid = new Map<string, ICAL.Component[]>();
    for (const component of components) {
      if (!component.hasProperty("recurrence-id")) continue;
      const uid = eventUid(component);
      if (!uid) continue;
      const exceptions = exceptionsByUid.get(uid) ?? [];
      exceptions.push(component);
      exceptionsByUid.set(uid, exceptions);
    }

    const rangeStart = addDays(startOfWeek(now), -370);
    const rangeEnd = addDays(rangeStart, 740);
    const output: CalendarEvent[] = [];
    let expansionSteps = 0;

    for (const component of components) {
      if (component.hasProperty("recurrence-id")) continue;
      const uid = eventUid(component);
      const event = new ICAL.Event(component, {
        exceptions: uid ? exceptionsByUid.get(uid) ?? [] : [],
        strictExceptions: true,
      });
      if (isCancelled(event)) continue;

      if (!event.isRecurring()) {
        pushEvent(output, toCalendarEvent(event, event.startDate.toJSDate(), event.endDate.toJSDate()));
        continue;
      }

      const iterator = event.iterator();
      while (true) {
        const occurrence = iterator.next();
        if (!occurrence) break;
        expansionSteps += 1;
        if (expansionSteps > MAX_CALENDAR_EVENTS) {
          throw new Error("That calendar contains too many recurring events to import.");
        }

        const details = event.getOccurrenceDetails(occurrence);
        const occurrenceStart = occurrence.toJSDate();
        if (occurrenceStart > rangeEnd) break;
        if (isCancelled(details.item)) continue;

        const start = details.startDate.toJSDate();
        const end = details.endDate.toJSDate();
        if (end >= rangeStart) {
          pushEvent(output, toCalendarEvent(details.item, start, end, `-${occurrence.toString()}`));
        }
      }
    }

    return output
      .filter((event) => Number.isFinite(new Date(event.start).getTime()))
      .sort((left, right) => left.start.localeCompare(right.start));
  } finally {
    ICAL.TimezoneService.reset();
  }
}
