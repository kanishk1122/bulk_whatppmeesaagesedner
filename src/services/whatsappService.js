import { io } from "socket.io-client";

export class WhatsAppService {
  constructor() {
    this.baseURL = "http://localhost:3001/api";
    this.socket = null;
    this.isConnected = false;
    this.targetNumber = "9314539152"; // Fixed number for sending messages
  }

  // Initialize socket connection
  initializeSocket(onQRCode, onReady, onProgress, onLoggedOut) {
    this.socket = io("http://localhost:3001");

    this.socket.on("qr-code", (qrCodeDataURL) => {
      if (onQRCode) onQRCode(qrCodeDataURL);
    });

    this.socket.on("client-ready", () => {
      this.isConnected = true;
      if (onReady) onReady();
    });

    this.socket.on("authenticated", () => {
      console.log("WhatsApp authenticated");
    });

    this.socket.on("disconnected", () => {
      this.isConnected = false;
    });

    this.socket.on("bulk-progress", (progress) => {
      if (onProgress)
        onProgress(progress.current, progress.total, progress.contact);
    });

    this.socket.on("logged-out", () => {
      this.isConnected = false;
      if (onLoggedOut) onLoggedOut();
    });

    return this.socket;
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

  // Send bulk messages
  async sendBulkMessages(
    contacts,
    message,
    imageFile = null,
    onProgress = null
  ) {
    if (!this.isConnected) {
      throw new Error("WhatsApp not connected");
    }

    try {
      const formData = new FormData();
      formData.append("contacts", JSON.stringify(contacts));
      formData.append("message", message);

      if (imageFile) {
        formData.append("image", imageFile);
      }

      const response = await fetch(`${this.baseURL}/send-bulk`, {
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
