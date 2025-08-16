import whatsappServer from "../../../lib/whatsappServer";
import { Buffer } from "buffer";

export async function POST(request) {
  try {
    const form = await request.formData();
    const number = form.get("number");
    const caption = form.get("caption") || "";
    const file = form.get("image"); // Blob
    if (!number || !file) {
      return new Response(JSON.stringify({ error: "Number and image required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const result = await whatsappServer.sendImage(number, caption, buffer, file.name || "upload.jpg");
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
