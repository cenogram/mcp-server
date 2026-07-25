import * as Sentry from "@sentry/node";
import { scrubHeaders, scrubString } from "./sentry-scrub.js";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  release: process.env.GIT_SHA || "unknown",
  enabled: process.env.NODE_ENV === "production" && !!process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  profilesSampleRate: 0,
  initialScope: {
    tags: { service: "mcp" },
  },
  beforeSend(event) {
    if (event.request?.headers) {
      event.request.headers = scrubHeaders(event.request.headers);
    }
    if (event.request?.url) {
      event.request.url = scrubString(event.request.url);
    }
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value) ex.value = scrubString(ex.value);
      }
    }
    return event;
  },
});

export { Sentry };
