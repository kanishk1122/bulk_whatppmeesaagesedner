
export class WhatsAppService {
  constructor() {
    this.baseURL = "/api"; // Updated to Next.js API
    this.socket = null;
    this.isConnected = false;
    this.targetNumber = "9314539152"; // Fixed number for sending messages
  }

  // Initialize socket connection
  initializeSocket(onQRCode, onReady, onProgress, onLoggedOut) {
    // Use Server-Sent Events (EventSource) to receive server events
    try {
      const es = new EventSource(`${this.baseURL}/events`);

      es.addEventListener("qr-code", (e) => {
        if (onQRCode) onQRCode(e.data); // data is QR dataURL
      });

      es.addEventListener("client-ready", () => {
        this.isConnected = true;
        if (onReady) onReady();
      });

      es.addEventListener("authenticated", () => {
        console.log("WhatsApp authenticated");
      });

      es.addEventListener("disconnected", () => {
        this.isConnected = false;
      });

      es.addEventListener("bulk-progress", (e) => {
        try {
          const progress = JSON.parse(e.data);
          if (onProgress)
            onProgress(progress.current, progress.total, progress.contact);
        } catch (err) {
          console.error("Invalid bulk-progress data", err);
        }
      });

      es.addEventListener("logged-out", () => {
        this.isConnected = false;
        if (onLoggedOut) onLoggedOut();
      });

      this.socket = es;
      return es;
    } catch (err) {
      console.error("Failed to open EventSource:", err);
      return null;
    }
  }

  // Check connection status
  async getStatus() {
    try {
      const response = await fetch(`${this.baseURL}/status`);
      const data = await response.json();
      this.isConnected = data.isReady;
      return data;
    } catch (error) {
      console.error("Error checking status:", error);
      return { isReady: false, hasQR: false };
    }
  }

  // Send text message to target number
  async sendTextMessage(contact, message) {
    if (!this.isConnected) {
      throw new Error("WhatsApp not connected");
    }

    try {
      const response = await fetch(`${this.baseURL}/send-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          number: this.targetNumber,
          message: `Hello ${contact.displayName},\n\n${message}`,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to send message");
      }

      return { success: true, contact, message, ...result };
    } catch (error) {
      throw new Error(
        `Failed to send message to ${contact.displayName}: ${error.message}`
      );
    }
  }

  // Send image message to target number
  async sendImageMessage(contact, imageFile, caption = "") {
    if (!this.isConnected) {
      throw new Error("WhatsApp not connected");
    }

    try {
      const formData = new FormData();
      formData.append("number", this.targetNumber);
      formData.append("caption", `Hello ${contact.displayName},\n\n${caption}`);
      formData.append("image", imageFile);

      const response = await fetch(`${this.baseURL}/send-image`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to send image");
      }

      return {
        success: true,
        contact,
        image: imageFile.name,
        caption,
        ...result,
      };
    } catch (error) {
      throw new Error(
        `Failed to send image to ${contact.displayName}: ${error.message}`
      );
    }
  }

  // Send bulk messages (updated for Next.js API route)
  async sendBulkMessages(
    contacts,
    message,
    imageFile = null,
    batchSettings = null
  ) {
    // Remove connection check for Next.js API route
    try {
      const formData = new FormData();
      formData.append("contacts", JSON.stringify(contacts));
      formData.append("message", message);

      if (imageFile) {
        formData.append("image", imageFile);
      }

      if (batchSettings) {
        formData.append("batchSettings", JSON.stringify(batchSettings));
      }

      // Use relative API route for Next.js
      const response = await fetch("/api/send-bulk", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to send bulk messages");
      }

      return result.results;
    } catch (error) {
      throw new Error(`Failed to send bulk messages: ${error.message}`);
    }
  }

  // Logout from WhatsApp
  async logout() {
    try {
      const response = await fetch(`${this.baseURL}/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to logout");
      }

      this.isConnected = false;
      return result;
    } catch (error) {
      throw new Error(`Failed to logout: ${error.message}`);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}
