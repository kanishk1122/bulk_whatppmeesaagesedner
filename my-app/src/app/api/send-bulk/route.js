import { NextResponse } from "next/server";
import whatsappServer from "../../../lib/whatsappServer";
import { Buffer } from "buffer";

export async function POST(request) {
  try {
    const form = await request.formData();
    const contactsRaw = form.get("contacts");
    const message = form.get("message");
    const batchSettingsRaw = form.get("batchSettings");
    const image = form.get("image"); // may be null

    if (!contactsRaw || !message) {
      return new Response(
        JSON.stringify({ error: "Contacts and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const contacts = JSON.parse(contactsRaw);
    const settings = batchSettingsRaw ? JSON.parse(batchSettingsRaw) : null;
    let imageBuffer = null;
    let imageName = null;
    if (image) {
      const ab = await image.arrayBuffer();
      imageBuffer = Buffer.from(ab);
      imageName = image.name || "upload.jpg";
    }

    const results = await whatsappServer.sendBulk(
      contacts,
      message,
      imageBuffer,
      imageName,
      settings
    );
    return new Response(JSON.stringify({ results }), {
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
