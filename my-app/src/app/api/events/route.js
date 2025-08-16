import whatsappServer from "../../../lib/whatsappServer";

export async function GET() {
  const emitter = whatsappServer.emitter;

  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (name, data) => {
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        controller.enqueue(new TextEncoder().encode(`event: ${name}\n`));
        controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
      };

      const qrListener = (data) => sendEvent("qr-code", data);
      const readyListener = () => sendEvent("client-ready", "");
      const authListener = () => sendEvent("authenticated", "");
      const disconnectedListener = (d) => sendEvent("disconnected", d || "");
      const bulkProgressListener = (d) => sendEvent("bulk-progress", d);
      const batchDelayListener = (d) => sendEvent("batch-delay", d);
      const loggedOutListener = () => sendEvent("logged-out", "");

      emitter.on("qr-code", qrListener);
      emitter.on("client-ready", readyListener);
      emitter.on("authenticated", authListener);
      emitter.on("disconnected", disconnectedListener);
      emitter.on("bulk-progress", bulkProgressListener);
      emitter.on("batch-delay", batchDelayListener);
      emitter.on("logged-out", loggedOutListener);

      controller.enqueue(new TextEncoder().encode(": connected\n\n"));

      // set cleanup to remove listeners when stream is cancelled
      cleanup = () => {
        emitter.removeListener("qr-code", qrListener);
        emitter.removeListener("client-ready", readyListener);
        emitter.removeListener("authenticated", authListener);
        emitter.removeListener("disconnected", disconnectedListener);
        emitter.removeListener("bulk-progress", bulkProgressListener);
        emitter.removeListener("batch-delay", batchDelayListener);
        emitter.removeListener("logged-out", loggedOutListener);
      };
    },
    cancel() {
      // called when client disconnects EventSource
      try {
        cleanup();
      } catch (e) {
        console.error("Error during SSE cleanup:", e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
