import assert from "node:assert/strict";
import test from "node:test";

const CALENDAR_PATH = "/api/calendar";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

function executionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

async function send(worker, path = "/", init = undefined) {
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    executionContext(),
  );
}

test("server-renders the Howbout companion shell and product metadata", async () => {
  const worker = await loadWorker();
  const response = await send(worker, "/", {
    headers: { accept: "text/html" },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Howbout Desktop Companion<\/title>/i);
  assert.match(html, /read-only home for your Howbout plans/i);
  assert.match(html, /<main class="boot-screen" aria-label="Loading Howbout companion">/i);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/i);
});

test("calendar endpoint rejects cross-origin requests before fetching", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected outbound request");
  };

  try {
    const response = await send(worker, CALENDAR_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://untrusted.example",
      },
      body: JSON.stringify({
        url: "https://calendar.google.com/calendar/ical/example/basic.ics",
      }),
    });

    assert.equal(response.status, 403);
    assert.equal(fetchCount, 0);
    assert.deepEqual(await response.json(), {
      error: "This request must come from the companion app.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("calendar endpoint blocks non-HTTPS and lookalike calendar hosts", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected outbound request");
  };

  try {
    const cases = [
      {
        url: "http://calendar.google.com/calendar/ical/example/basic.ics",
        error: "Only secure calendar links are supported.",
      },
      {
        url: "https://calendar.google.com.untrusted.example/calendar/ical/example/basic.ics",
        error: "Use a public Apple, Google, or Outlook calendar link.",
      },
      {
        url: "https://127.0.0.1/calendar/ical/example/basic.ics",
        error: "Use a public Apple, Google, or Outlook calendar link.",
      },
    ];

    for (const example of cases) {
      const response = await send(worker, CALENDAR_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: example.url }),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: example.error });
    }
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("calendar endpoint refuses an HTTPS-to-HTTP redirect downgrade", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const calendarUrl = "https://calendar.google.com/calendar/ical/example/basic.ics";
  let fetchCount = 0;

  globalThis.fetch = async (input) => {
    fetchCount += 1;
    assert.equal(String(input), calendarUrl);
    return new Response(null, {
      status: 302,
      headers: {
        location: "http://calendar.google.com/calendar/ical/example/basic.ics",
      },
    });
  };

  try {
    const response = await send(worker, CALENDAR_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify({ url: calendarUrl }),
    });

    assert.equal(response.status, 400);
    assert.equal(fetchCount, 1);
    assert.deepEqual(await response.json(), {
      error: "Use a public Apple, Google, or Outlook calendar link.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("calendar endpoint returns a controlled allowlisted iCalendar feed", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const calendarUrl = "https://calendar.google.com/calendar/ical/example/basic.ics";
  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Howbout Companion Test//EN",
    "END:VCALENDAR",
  ].join("\r\n");
  let fetchCount = 0;

  globalThis.fetch = async (input, init) => {
    fetchCount += 1;
    assert.equal(String(input), calendarUrl);
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.headers?.accept, "text/calendar, text/plain;q=0.9");
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(calendar, {
      status: 200,
      headers: {
        "content-length": String(Buffer.byteLength(calendar)),
        "content-type": "text/calendar",
      },
    });
  };

  try {
    const response = await send(worker, CALENDAR_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify({ url: calendarUrl }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(fetchCount, 1);
    assert.deepEqual(await response.json(), { calendar });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
