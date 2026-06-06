import { eventType, staticSchema } from "inngest";

// Typed event registry (Inngest v4). `eventType` defines a reusable, typed
// trigger; `staticSchema<T>()` gives compile-time typing with no runtime
// validation dependency (swap to a Zod schema where runtime validation is
// wanted). Add real pipeline events (e.g. "site/crawl.requested") here.
export const helloEvent = eventType("demo/hello", {
  schema: staticSchema<{ name?: string }>(),
});
