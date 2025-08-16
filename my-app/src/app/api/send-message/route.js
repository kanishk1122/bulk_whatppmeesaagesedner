import whatsappServer from "../../../lib/whatsappServer";

export async function POST(request) {
  try {
    const body = await request.json();
    const { number, message } = body;
    if (!number || !message) {
      return new Response(
        JSON.stringify({ error: "Number and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const result = await whatsappServer.sendMessage(number, message);
    return new Response(JSON.stringify(result), {
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
