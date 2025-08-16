import whatsappServer from "../../../lib/whatsappServer";

export async function GET() {
  try {
    const status = whatsappServer.getStatus();
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
