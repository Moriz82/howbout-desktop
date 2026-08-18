const MAX_CALENDAR_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function normalizeCalendarUrl(value: string) {
  const normalized = value.trim().replace(/^webcal:/i, "https:");
  const url = new URL(normalized);
  if (url.protocol !== "https:") throw new Error("Only secure calendar links are supported.");
  return url;
}

function isAllowedCalendarUrl(url: URL) {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const isApple = /^p\d+-caldav\.icloud\.com$/.test(host) && url.pathname.startsWith("/published/");
  const isGoogle = host === "calendar.google.com" && url.pathname.startsWith("/calendar/ical/");
  const isOutlook = ["outlook.live.com", "outlook.office365.com"].includes(host) && url.pathname.startsWith("/owa/calendar/");
  return isApple || isGoogle || isOutlook;
}

async function downloadCalendar(initialUrl: URL) {
  let url = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!isAllowedCalendarUrl(url)) throw new Error("Use a public Apple, Google, or Outlook calendar link.");
    const response = await fetch(url, {
      headers: { accept: "text/calendar, text/plain;q=0.9" },
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The calendar redirected without a destination.");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error("The calendar host rejected that link.");

    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_CALENDAR_BYTES) throw new Error("That calendar is too large to import.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_CALENDAR_BYTES) throw new Error("That calendar is too large to import.");
    const calendar = new TextDecoder().decode(bytes);
    if (!calendar.includes("BEGIN:VCALENDAR")) throw new Error("That link did not return an iCalendar feed.");
    return calendar;
  }
  throw new Error("The calendar redirected too many times.");
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "This request must come from the companion app." }, { status: 403 });
  }

  try {
    const body = await request.json() as { url?: unknown };
    if (typeof body.url !== "string" || body.url.length > 4096) {
      return Response.json({ error: "Paste a valid public calendar link." }, { status: 400 });
    }
    const url = normalizeCalendarUrl(body.url);
    const calendar = await downloadCalendar(url);
    return Response.json(
      { calendar },
      { headers: { "cache-control": "no-store, private", "x-content-type-options": "nosniff" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "We couldn't read that calendar.";
    return Response.json({ error: message }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
