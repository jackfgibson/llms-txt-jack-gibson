import { inngest } from "./client";
import { helloEvent } from "./events";

// Trivial P0 function — proves the Inngest wiring fires end-to-end (event →
// durable step → result). Real crawl pipeline functions replace this in P1.
export const helloWorld = inngest.createFunction(
  { id: "hello-world", triggers: [{ event: helloEvent }] },
  async ({ event, step }) => {
    const greeting = await step.run("build-greeting", () => {
      return `Hello, ${event.data.name ?? "world"}!`;
    });
    return { greeting };
  },
);

// Every function registered with the serve handler.
export const functions = [helloWorld];
