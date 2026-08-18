"use client";

import { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { CALENDAR_COLORS as COLORS, MAX_CALENDAR_BYTES, parseCalendar, type CalendarEvent } from "./calendar";

type SavedCalendar = {
  events: CalendarEvent[];
  source: string;
  syncedAt: string;
};

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
      };
    };
  }
}

const CACHE_KEY = "howbout-companion-calendar-v1";
const URL_KEY = "howbout-companion-url-v1";
const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const START_HOUR = 7;
const END_HOUR = 23;

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

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatWeek(start: Date) {
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.toLocaleDateString(undefined, { month: "long" })} ${start.getDate()}–${end.getDate()}`;
  }
  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function formatTime(value: Date) {
  return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatEventDate(event: CalendarEvent) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const day = start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  if (event.allDay) return `${day} · All day`;
  return `${day} · ${formatTime(start)}–${formatTime(end)}`;
}

function demoEvents(anchor: Date): CalendarEvent[] {
  const monday = startOfWeek(anchor);
  const at = (day: number, hour: number, minute = 0) => {
    const result = addDays(monday, day);
    result.setHours(hour, minute, 0, 0);
    return result;
  };
  return [
    { id: "demo-1", title: "Coffee + catch up", start: at(1, 10).toISOString(), end: at(1, 11, 15).toISOString(), allDay: false, location: "Juniper Coffee", color: COLORS[0] },
    { id: "demo-2", title: "Study sprint", start: at(2, 14).toISOString(), end: at(2, 16).toISOString(), allDay: false, description: "Bring the practice questions.", color: COLORS[3] },
    { id: "demo-3", title: "Dinner at Alba", start: at(3, 19, 30).toISOString(), end: at(3, 21).toISOString(), allDay: false, location: "Alba, downtown", color: COLORS[1] },
    { id: "demo-4", title: "Beach weekend", start: at(5, 9).toISOString(), end: at(6, 18).toISOString(), allDay: true, description: "Sunscreen. Snacks. No laptops.", color: COLORS[2] },
    { id: "demo-5", title: "Sunday reset", start: at(6, 17).toISOString(), end: at(6, 18).toISOString(), allDay: false, color: COLORS[4] },
  ];
}

function saveCalendar(calendar: SavedCalendar) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(calendar));
}

async function clearSavedCalendarUrl() {
  try {
    const clearedNatively = await invokeDesktop<boolean>("clear_calendar_url");
    if (clearedNatively === false) throw new Error("Credential deletion was rejected.");
  } catch {
    throw new Error("The remembered calendar link could not be removed from your system keyring. Unlock it and try again.");
  }
  localStorage.removeItem(URL_KEY);
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return null;
  return invoke<T>(command, args);
}

async function fetchCalendar(url: string) {
  const nativeResult = await invokeDesktop<string>("fetch_calendar", { url });
  if (nativeResult !== null) return nativeResult;

  const response = await fetch("/api/calendar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const payload = await response.json() as { calendar?: string; error?: string };
  if (!response.ok || !payload.calendar) throw new Error(payload.error || "We couldn't read that calendar link.");
  return payload.calendar;
}

function openOfficialLink(event: ReactMouseEvent<HTMLAnchorElement>) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return;
  event.preventDefault();
  void invoke<boolean>("open_external", { url: event.currentTarget.href }).catch(() => undefined);
}

function eventFallsOnDay(event: CalendarEvent, day: Date) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  return start < dayEnd && end > dayStart;
}

function CalendarMark({ event, day, onOpen }: { event: CalendarEvent; day: Date; onOpen: (event: CalendarEvent) => void }) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const startsToday = isSameDay(start, day);
  const shownStart = startsToday ? start : new Date(day.getFullYear(), day.getMonth(), day.getDate(), START_HOUR);
  const shownEnd = isSameDay(end, day) ? end : new Date(day.getFullYear(), day.getMonth(), day.getDate(), END_HOUR);
  const startMinutes = Math.max(0, (shownStart.getHours() - START_HOUR) * 60 + shownStart.getMinutes());
  const durationMinutes = Math.max(35, (shownEnd.getTime() - shownStart.getTime()) / 60_000);
  const totalMinutes = (END_HOUR - START_HOUR) * 60;
  const top = (startMinutes / totalMinutes) * 100;
  const height = Math.max(4.4, Math.min(100 - top, (durationMinutes / totalMinutes) * 100));

  return (
    <button
      className="event-mark"
      onClick={() => onOpen(event)}
      style={{ top: `${top}%`, height: `${height}%`, background: event.color }}
      type="button"
    >
      <span>{event.allDay ? "ALL DAY" : formatTime(start)}</span>
      <strong>{event.title}</strong>
    </button>
  );
}

export function HowboutApp() {
  const now = useMemo(() => new Date(), []);
  const [mounted, setMounted] = useState(false);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(now));
  const [events, setEvents] = useState<CalendarEvent[]>(() => demoEvents(now));
  const [source, setSource] = useState("Preview calendar");
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "plans">("calendar");
  const [setupOpen, setSetupOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [calendarUrl, setCalendarUrl] = useState("");
  const [rememberUrl, setRememberUrl] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return events;
    return events.filter((event) => [event.title, event.description, event.location].some((value) => value?.toLowerCase().includes(query)));
  }, [events, search]);
  const upcoming = useMemo(() => filteredEvents.filter((event) => new Date(event.end) >= startOfDay(now)).slice(0, 20), [filteredEvents, now]);

  useEffect(() => {
    const restoreCalendar = window.setTimeout(() => {
      setMounted(true);
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as SavedCalendar;
          if (Array.isArray(saved.events)) {
            setEvents(saved.events);
            setSource(saved.source);
            setSyncedAt(saved.syncedAt);
            setSetupOpen(false);
          }
        }
      } catch {
        localStorage.removeItem(CACHE_KEY);
      }
    }, 0);

    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
    return () => {
      window.clearTimeout(restoreCalendar);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);

  function commitCalendar(nextEvents: CalendarEvent[], nextSource: string) {
    const synced = new Date().toISOString();
    const saved = { events: nextEvents, source: nextSource, syncedAt: synced };
    setEvents(nextEvents);
    setSource(nextSource);
    setSyncedAt(synced);
    setSetupOpen(false);
    setSettingsOpen(false);
    saveCalendar(saved);
  }

  async function loadDemo() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await clearSavedCalendarUrl();
      commitCalendar(demoEvents(new Date()), "Demo calendar");
      setNotice("Demo loaded. Import your calendar whenever you're ready.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The remembered calendar link could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  async function connectUrl(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const normalized = calendarUrl.trim().replace(/^webcal:/i, "https:");
      if (!normalized) throw new Error("Paste the public calendar link from Apple Calendar.");
      const raw = await fetchCalendar(normalized);
      const parsed = parseCalendar(raw);
      if (!parsed.length) throw new Error("That calendar opened, but it didn't contain any plans.");

      if (rememberUrl) {
        const savedNatively = await invokeDesktop<boolean>("save_calendar_url", { url: normalized });
        if (savedNatively === null) localStorage.setItem(URL_KEY, normalized);
      } else {
        await clearSavedCalendarUrl();
      }
      commitCalendar(parsed, "Howbout via Apple Calendar");
      setNotice(`${parsed.length} plans connected.`);
      setCalendarUrl("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't connect that calendar.");
    } finally {
      setBusy(false);
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if (file.size > MAX_CALENDAR_BYTES) throw new Error("That calendar is too large to import.");
      const parsed = parseCalendar(await file.text());
      if (!parsed.length) throw new Error("That file didn't contain any calendar events.");
      await clearSavedCalendarUrl();
      commitCalendar(parsed, file.name.replace(/\.ics$/i, "") || "Imported calendar");
      setNotice(`${parsed.length} plans imported from ${file.name}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't import that file.");
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  async function syncCalendar() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const nativeUrl = await invokeDesktop<string>("load_calendar_url");
      const savedUrl = nativeUrl || localStorage.getItem(URL_KEY);
      if (!savedUrl) {
        setSettingsOpen(false);
        setSetupOpen(true);
        return;
      }
      const parsed = parseCalendar(await fetchCalendar(savedUrl));
      if (!parsed.length) throw new Error("Your calendar synced, but no plans were returned.");
      commitCalendar(parsed, source);
      setNotice("Calendar is up to date.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sync failed. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function resetApp() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await clearSavedCalendarUrl();
      localStorage.removeItem(CACHE_KEY);
      setEvents(demoEvents(new Date()));
      setSource("Preview calendar");
      setSyncedAt(null);
      setSettingsOpen(false);
      setSetupOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Local data could not be fully erased.");
    } finally {
      setBusy(false);
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  if (!mounted) {
    return (
      <main className="boot-screen" aria-label="Loading Howbout companion">
        <span>howbout<span>.</span></span>
      </main>
    );
  }
  const isDesktop = Boolean(window.__TAURI__?.core?.invoke);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("calendar")} type="button" aria-label="Howbout companion home">
          howbout<span className="brand-dot">.</span>
        </button>
        <nav className="nav-list" aria-label="Main navigation">
          <button className={view === "calendar" ? "nav-item active" : "nav-item"} onClick={() => setView("calendar")} type="button"><span>▦</span> Calendar</button>
          <button className={view === "plans" ? "nav-item active" : "nav-item"} onClick={() => setView("plans")} type="button"><span>✦</span> Plans</button>
        </nav>

        <div className="source-card">
          <span className="source-dot" />
          <div><strong>{source}</strong><span>{syncedAt ? `Updated ${new Date(syncedAt).toLocaleDateString()}` : "Ready to connect"}</span></div>
          <button onClick={() => setSettingsOpen(true)} type="button" aria-label="Calendar settings">•••</button>
        </div>

        <div className="connect-card">
          <span className="eyebrow">PHONE → DESKTOP</span>
          <h2>Your social calendar, with room to breathe.</h2>
          <p>Import plans without sharing a password.</p>
          <button onClick={() => setSetupOpen(true)} type="button">Connect calendar <span>→</span></button>
        </div>
        <p className="sidebar-note">Independent companion · calendar cached on this device</p>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{view === "calendar" ? "YOUR WEEK" : "COMING UP"}</p>
            <h1>{view === "calendar" ? formatWeek(weekStart) : "Plans worth leaving the house for"}</h1>
          </div>
          <div className="top-actions">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Search plans</span>
              <input onChange={(event) => setSearch(event.target.value)} placeholder="Search plans" type="search" value={search} />
            </label>
            {installPrompt && <button className="quiet-button install-button" onClick={installApp} type="button">Install</button>}
            <a className="primary-button" href="https://get.howbout.app" onClick={openOfficialLink} rel="noreferrer" target="_blank">Open Howbout <span>↗</span></a>
            <button className="avatar" onClick={() => setSettingsOpen(true)} type="button" aria-label="Open settings">H</button>
          </div>
        </header>

        {notice && <div className="notice success" role="status"><span>✓</span>{notice}<button onClick={() => setNotice(null)} aria-label="Dismiss" type="button">×</button></div>}
        {error && !setupOpen && <div className="notice error" role="alert"><span>!</span>{error}<button onClick={() => setError(null)} aria-label="Dismiss" type="button">×</button></div>}

        {view === "calendar" ? (
          <>
            <div className="calendar-toolbar">
              <div className="date-controls">
                <button onClick={() => setWeekStart(addDays(weekStart, -7))} type="button" aria-label="Previous week">←</button>
                <button onClick={() => setWeekStart(startOfWeek(new Date()))} type="button">Today</button>
                <button onClick={() => setWeekStart(addDays(weekStart, 7))} type="button" aria-label="Next week">→</button>
              </div>
              <span>{filteredEvents.filter((event) => days.some((day) => eventFallsOnDay(event, day))).length} plans this week</span>
            </div>

            <div className="calendar-card">
              <div className="calendar-head">
                <div className="time-spacer" />
                {days.map((day, index) => (
                  <div className={isSameDay(day, now) ? "day-label today" : "day-label"} key={day.toISOString()}>
                    <span>{DAY_NAMES[index]}</span><strong>{day.getDate()}</strong>
                  </div>
                ))}
              </div>
              <div className="calendar-scroll">
                <div className="time-labels" aria-hidden="true">
                  {[8, 11, 14, 17, 20].map((hour) => <span key={hour} style={{ top: `${((hour - START_HOUR) / (END_HOUR - START_HOUR)) * 100}%` }}>{new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" })}</span>)}
                </div>
                <div className="calendar-body">
                  {days.map((day) => (
                    <div className={isSameDay(day, now) ? "day-column current" : "day-column"} key={day.toISOString()}>
                      {filteredEvents.filter((event) => !event.allDay && eventFallsOnDay(event, day)).map((event) => (
                        <CalendarMark day={day} event={event} key={`${event.id}-${day.toISOString()}`} onOpen={setSelectedEvent} />
                      ))}
                    </div>
                  ))}
                  {isSameDay(startOfWeek(now), weekStart) && (
                    <div className="now-line" style={{ top: `${Math.max(0, Math.min(100, (((now.getHours() - START_HOUR) * 60 + now.getMinutes()) / ((END_HOUR - START_HOUR) * 60)) * 100))}%` }}><span>NOW</span></div>
                  )}
                </div>
              </div>
              <div className="all-day-row">
                <span>ALL DAY</span>
                {days.map((day) => (
                  <div key={day.toISOString()}>
                    {filteredEvents.filter((event) => event.allDay && eventFallsOnDay(event, day)).slice(0, 2).map((event) => (
                      <button key={event.id} onClick={() => setSelectedEvent(event)} style={{ background: event.color }} type="button">{event.title}</button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="plans-layout">
            <section className="plan-list" aria-label="Upcoming plans">
              {upcoming.length ? upcoming.map((event, index) => {
                const start = new Date(event.start);
                const previous = index > 0 ? new Date(upcoming[index - 1].start) : null;
                const newDay = !previous || !isSameDay(start, previous);
                return (
                  <div className="agenda-group" key={event.id}>
                    {newDay && <div className="agenda-date"><strong>{start.toLocaleDateString(undefined, { weekday: "long" })}</strong><span>{start.toLocaleDateString(undefined, { month: "long", day: "numeric" })}</span></div>}
                    <button className="agenda-event" onClick={() => setSelectedEvent(event)} type="button">
                      <span className="agenda-color" style={{ background: event.color }} />
                      <span className="agenda-time">{event.allDay ? "All day" : formatTime(start)}</span>
                      <span><strong>{event.title}</strong><small>{event.location || event.description || "Howbout plan"}</small></span>
                      <span aria-hidden="true">→</span>
                    </button>
                  </div>
                );
              }) : <div className="empty-state"><span>☀</span><h2>Wide open.</h2><p>No plans match that search yet.</p></div>}
            </section>
            <aside className="weekend-card">
              <span className="eyebrow">WEEKEND ENERGY</span>
              <strong>{upcoming.filter((event) => [0, 6].includes(new Date(event.start).getDay())).length}</strong>
              <p>weekend plans coming up</p>
              <a href="https://get.howbout.app" onClick={openOfficialLink} rel="noreferrer" target="_blank">Make another in Howbout ↗</a>
            </aside>
          </div>
        )}
      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")} type="button"><span>▦</span>Calendar</button>
        <button className={view === "plans" ? "active" : ""} onClick={() => setView("plans")} type="button"><span>✦</span>Plans</button>
        <button onClick={() => setSetupOpen(true)} type="button"><span>＋</span>Connect</button>
      </nav>

      {setupOpen && (
        <div className="modal-backdrop setup-backdrop" role="presentation">
          <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title">
            <button className="modal-close" onClick={() => source !== "Preview calendar" ? setSetupOpen(false) : loadDemo()} type="button" aria-label="Close setup">×</button>
            <div className="setup-copy">
              <span className="eyebrow">HOWBOUT ON YOUR COMPUTER</span>
              <h2 id="setup-title">Big-screen plans.<br />Tiny setup.</h2>
              <p>Use Howbout’s calendar export—no password, session token, or phone mirroring required.</p>
              <ol>
                <li><span>1</span><div><strong>Turn on export</strong><small>Howbout → Calendar → Settings → Export to phone</small></div></li>
                <li><span>2</span><div><strong>Copy the link</strong><small>Apple Calendar → Howbout → Public Calendar → Share Link</small></div></li>
                <li><span>3</span><div><strong>Paste it here</strong><small>Your plans are cached locally after import.</small></div></li>
              </ol>
              <a href="https://howbout.app/get-help/export-calendar/" onClick={openOfficialLink} rel="noreferrer" target="_blank">See Howbout’s official export guide ↗</a>
            </div>
            <div className="setup-form-card">
              <div className="setup-badge"><span>✓</span> Read-only connection</div>
              <form onSubmit={connectUrl}>
                <label htmlFor="calendar-link">Public calendar link</label>
                <div className="url-field"><span>↗</span><input id="calendar-link" onChange={(event) => setCalendarUrl(event.target.value)} placeholder="webcal://p••-caldav.icloud.com/..." spellCheck="false" value={calendarUrl} /></div>
                <label aria-label="Remember calendar link on this device" className="check-row" htmlFor="remember-calendar-link"><input checked={rememberUrl} id="remember-calendar-link" onChange={(event) => setRememberUrl(event.target.checked)} type="checkbox" /><span><strong>Remember on this device</strong><small>{isDesktop ? "Stored in macOS Keychain or Linux Secret Service." : "Stored in this browser until you disconnect."}</small></span></label>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="connect-submit" disabled={busy} type="submit">{busy ? "Connecting…" : "Connect my calendar"}<span>→</span></button>
              </form>
              <div className="divider"><span>or</span></div>
              <button className="import-button" disabled={busy} onClick={() => fileInput.current?.click()} type="button"><span>⇧</span><div><strong>Import an .ics file</strong><small>Works on web, macOS, and Linux</small></div></button>
              <input accept=".ics,text/calendar" className="hidden-input" onChange={importFile} ref={fileInput} type="file" />
              <button className="demo-button" disabled={busy} onClick={loadDemo} type="button">Just let me explore the demo</button>
              <p className="privacy-note">Treat the public calendar URL like a password: anyone with it can read the exported plans. {isDesktop ? "Desktop fetches it directly and stores a remembered link in your system keyring." : "The web version sends it through the companion proxy only to fetch the calendar; the app marks the response no-store and does not retain either server-side."} This companion cannot access friends, chats, or private Howbout features.</p>
            </div>
          </section>
        </div>
      )}

      {selectedEvent && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedEvent(null)} role="presentation">
          <section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-title">
            <button className="modal-close" onClick={() => setSelectedEvent(null)} type="button" aria-label="Close plan">×</button>
            <span className="event-color" style={{ background: selectedEvent.color }} />
            <p className="eyebrow">PLAN DETAILS</p>
            <h2 id="event-title">{selectedEvent.title}</h2>
            <dl>
              <div><dt>When</dt><dd>{formatEventDate(selectedEvent)}</dd></div>
              {selectedEvent.location && <div><dt>Where</dt><dd>{selectedEvent.location}</dd></div>}
              {selectedEvent.description && <div><dt>Notes</dt><dd>{selectedEvent.description}</dd></div>}
            </dl>
            <a className="primary-button full" href="https://get.howbout.app" onClick={openOfficialLink} rel="noreferrer" target="_blank">Open Howbout on your phone <span>↗</span></a>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)} role="presentation">
          <aside className="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button className="modal-close" onClick={() => setSettingsOpen(false)} type="button" aria-label="Close settings">×</button>
            <p className="eyebrow">THIS DEVICE</p>
            <h2 id="settings-title">Calendar settings</h2>
            <div className="settings-source"><span className="source-dot" /><div><strong>{source}</strong><small>{events.length} plans saved locally</small></div></div>
            <button className="settings-action primary" disabled={busy} onClick={syncCalendar} type="button"><span>↻</span><div><strong>{busy ? "Syncing…" : "Sync now"}</strong><small>Pull the latest calendar export</small></div></button>
            <button className="settings-action" onClick={() => { setSettingsOpen(false); setSetupOpen(true); }} type="button"><span>＋</span><div><strong>Import another calendar</strong><small>Replace the current calendar</small></div></button>
            {installPrompt && <button className="settings-action" onClick={installApp} type="button"><span>↓</span><div><strong>Install this app</strong><small>Keep it in your dock or app menu</small></div></button>}
            <div className="settings-info"><strong>Privacy by default</strong><p>Calendar data is cached only on this device. {isDesktop ? "Desktop connects to the calendar host directly and keeps a remembered URL in your system keyring." : "Web sync sends the URL and calendar through the no-store companion proxy, which does not save them."}</p></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="danger-button" disabled={busy} onClick={resetApp} type="button">{busy ? "Erasing…" : "Disconnect and erase local data"}</button>
          </aside>
        </div>
      )}
    </main>
  );
}
