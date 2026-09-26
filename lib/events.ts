import type { QuoteEvent } from "../protocol";

export type Emit = (e: QuoteEvent) => void;

export function ndjsonStream(run: (emit: Emit) => Promise<void>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit: Emit = (e) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {}
      };
      try {
        await run(emit);
      } catch (e) {
        console.error(e);
        emit({ t: "error", message: (e as Error).message });
      }
      emit({ t: "done" });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
