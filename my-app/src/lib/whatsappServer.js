import EventEmitter from "events";
import fs from "fs";
import path from "path";
import process from "process";
import qrcode from "qrcode";
import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import { Buffer } from "buffer";

// Use process.cwd() to avoid import.meta.url/Windows issues
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

class WhatsAppServer {
  constructor() {
    if (globalThis.__whatsappServer) return globalThis.__whatsappServer;
    this.emitter = new EventEmitter();
    this.client = null;
    this.isReady = false;
    this.qr = "";
    // directory where LocalAuth/session data will be stored
    this.sessionPath = path.join(process.cwd(), "whatsapp-session");
    this._initClient();
    globalThis.__whatsappServer = this;
    return this;
  }

  _initClient() {
    (async () => {
      try {
        // Default puppeteer options (safe local defaults)
        let puppeteerOptions = {
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
          ],
        };

        // Try to detect chrome-aws-lambda (used on Vercel/AWS Lambda)
        try {
          const chromeAws = require("chrome-aws-lambda");
          const exePath = await chromeAws.executablePath;
          if (exePath) {
            puppeteerOptions = {
              args: chromeAws.args.concat(["--disable-dev-shm-usage"]),
              executablePath: exePath,
              headless: chromeAws.headless,
            };
            console.log("Using chrome-aws-lambda executable:", exePath);
          }
        } catch (e) {
          // chrome-aws-lambda not available — fallback below
        }

        // If user supplied a CHROME_PATH (custom), prefer that
        if (process.env.CHROME_PATH) {
          puppeteerOptions.executablePath = process.env.CHROME_PATH;
          console.log("Using CHROME_PATH from env:", process.env.CHROME_PATH);
        }

        this.client = new Client({
          authStrategy: new LocalAuth({
            dataPath: this.sessionPath,
            clientId: "default",
          }),
          puppeteer: puppeteerOptions,
        });

        this.client.on("qr", async (qr) => {
          this.qr = qr;
          try {
            const dataUrl = await qrcode.toDataURL(qr);
            this.emitter.emit("qr-code", dataUrl);
          } catch (err) {
            console.error("QR generation error", err);
          }
        });

        this.client.on("ready", () => {
          this.isReady = true;
          this.emitter.emit("client-ready");
        });

        this.client.on("authenticated", () => {
          this.emitter.emit("authenticated");
        });

        this.client.on("auth_failure", (msg) => {
          this.emitter.emit("auth-failure", msg);
        });

        this.client.on("disconnected", (reason) => {
          this.isReady = false;
          this.qr = "";
          this.emitter.emit("disconnected", reason);
          // reinitialize to allow new connection
          setTimeout(() => this._reinit(), 1000);
        });

        // Await initialize so we can catch errors (e.g. missing browser)
        await this.client.initialize();
      } catch (err) {
        console.error("Failed to initialize WhatsApp client:", err);
        // schedule a retry
        setTimeout(() => {
          try {
            this._reinit();
          } catch (e) {
            console.error("Retry failed:", e);
          }
        }, 5000);
      }
    })();
  }

  // Clear saved LocalAuth/session data and reinitialize client (forces QR)
  async clearSession() {
    // destroy current client if exists
    if (this.client && typeof this.client.destroy === "function") {
      await this.client.destroy();
    }
    this.client = null;
    this.isReady = false;
    this.qr = "";

    // remove session directory to force new auth (LocalAuth)
    try {
      await fs.promises.rm(this.sessionPath, {
        recursive: true,
        force: true,
      });
    } catch {
      // fallback for older Node versions
      try {
        await fs.promises.rmdir(this.sessionPath, { recursive: true });
      } catch {
        // ignore
      }
    }

    this.emitter.emit("session-cleared");
    // reinitialize to get a fresh QR
    this._initClient();
    return { success: true };
  }

  async _reinit() {
    try {
      if (this.client && typeof this.client.destroy === "function") {
        await this.client.destroy();
      }
    } catch (e) {
      console.warn("Error destroying client during reinit:", e);
    }
    this._initClient();
  }

  getStatus() {
    return { isReady: this.isReady, hasQR: !!this.qr };
  }

  async _formatNumber(number) {
    let n = String(number || "").replace(/\D/g, "");
    if (!n.startsWith("91")) n = "91" + n;
    return n + "@c.us";
  }

  async sendMessage(number, message) {
    if (!this.isReady) throw new Error("WhatsApp client not ready");
    const formatted = await this._formatNumber(number);
    const sent = await this.client.sendMessage(formatted, message);
    return { success: true, messageId: sent.id.id, to: number };
  }

  async sendImage(number, caption, buffer, originalname) {
    if (!this.isReady) throw new Error("WhatsApp client not ready");
    const filename = `${Date.now()}-${originalname}`;
    const filepath = path.join(UPLOADS_DIR, filename);
    await fs.promises.writeFile(filepath, Buffer.from(buffer));
    const media = MessageMedia.fromFilePath(filepath);
    const formatted = await this._formatNumber(number);
    const sent = await this.client.sendMessage(formatted, media, { caption });
    return {
      success: true,
      messageId: sent.id.id,
      to: number,
      imageName: originalname,
    };
  }

  async sendBulk(
    contacts,
    message,
    imageBuffer = null,
    imageName = null,
    settings = null
  ) {
    if (!this.isReady) throw new Error("WhatsApp client not ready");
    const results = [];
    const total = contacts.length;
    const randomDelay = (minS, maxS) => {
      const min = Math.max(0, minS || 0) * 1000;
      const max =
        Math.max(min, (typeof maxS === "number" ? maxS : minS) || min) * 1000;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    };

    let imageFilePath = null;
    if (imageBuffer && imageName) {
      imageFilePath = path.join(UPLOADS_DIR, `${Date.now()}-${imageName}`);
      await fs.promises.writeFile(imageFilePath, Buffer.from(imageBuffer));
    }

    const sendOne = async (contact, idx) => {
      try {
        const formatted = await this._formatNumber(contact.mobileNumber);
        let sent;
        if (imageFilePath) {
          const media = MessageMedia.fromFilePath(imageFilePath);
          sent = await this.client.sendMessage(formatted, media, {
            caption: message,
          });
        } else {
          sent = await this.client.sendMessage(formatted, message);
        }
        results.push({ success: true, contact, messageId: sent.id.id });
      } catch (err) {
        results.push({
          success: false,
          contact,
          error: err.message || String(err),
        });
      } finally {
        this.emitter.emit("bulk-progress", {
          current: idx + 1,
          total,
          contact: contact.displayName,
        });
      }
    };

    if (settings?.enableBatching) {
      const batchSize = settings.batchSize || 50;
      for (
        let start = 0, batchIndex = 0;
        start < contacts.length;
        start += batchSize, batchIndex++
      ) {
        const batch = contacts.slice(start, start + batchSize);
        for (let i = 0; i < batch.length; i++) {
          await sendOne(batch[i], start + i);
          if (settings.randomDelay?.enabled && i < batch.length - 1) {
            const delay = randomDelay(
              settings.randomDelay.min,
              settings.randomDelay.max
            );
            await new Promise((r) => setTimeout(r, delay));
          } else if (!settings.randomDelay?.enabled && i < batch.length - 1) {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        if (start + batchSize < contacts.length) {
          const minutes = settings.delayBetweenBatches || 60;
          this.emitter.emit("batch-delay", {
            currentBatch: batchIndex + 1,
            totalBatches: Math.ceil(contacts.length / batchSize),
            delayMinutes: minutes,
          });
          await new Promise((r) => setTimeout(r, minutes * 60 * 1000));
        }
      }
    } else {
      for (let i = 0; i < contacts.length; i++) {
        await sendOne(contacts[i], i);
        if (settings?.randomDelay?.enabled && i < contacts.length - 1) {
          const delay = randomDelay(
            settings.randomDelay.min,
            settings.randomDelay.max
          );
          await new Promise((r) => setTimeout(r, delay));
        } else if (!settings?.randomDelay?.enabled && i < contacts.length - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    return results;
  }

  async logout() {
    if (!this.client) throw new Error("No client to logout");
    await this.client.logout();
    if (typeof this.client.destroy === "function") await this.client.destroy();
    this.isReady = false;
    this.qr = "";
    this.emitter.emit("logged-out");
    // reinit
    this._initClient();
    return { success: true };
  }
}

const instance = new WhatsAppServer();
export default instance;
