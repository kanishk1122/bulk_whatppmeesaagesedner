const express = require("express");
const cors = require("cors");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");
const path = require("path");
const process = require("process");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// WhatsApp client initialization
let client;
let isClientReady = false;
let qrCodeString = "";
let initializing = false; // Prevent multiple initializations

// Safe destroy helper to avoid calling methods on null/closed contexts
const safeDestroyClient = async (reason = "") => {
  if (!client) return;
  console.log(`[WhatsAppBackend] Safe destroying client: ${reason}`);
  try {
    try {
      if (client.info) {
        // attempt graceful logout if possible
        await client.logout().catch((e) => {
          console.warn(
            `[WhatsAppBackend] Logout error (ignored):`,
            e?.message || e
          );
        });
      }
    } catch (e) {
      console.warn(
        `[WhatsAppBackend] Error during logout step:`,
        e?.message || e
      );
    }

    try {
      await client.destroy().catch((e) => {
        console.warn(
          `[WhatsAppBackend] Destroy error (ignored):`,
          e?.message || e
        );
      });
    } catch (e) {
      console.warn(
        `[WhatsAppBackend] Error during destroy step:`,
        e?.message || e
      );
    }
  } catch (e) {
    console.warn(
      `[WhatsAppBackend] Unexpected error in safeDestroyClient:`,
      e?.message || e
    );
  } finally {
    client = null;
    isClientReady = false;
    qrCodeString = "";
    initializing = false;
  }
};

const CHROME_EXECUTABLE_PATH =
  "C:\\Users\\kansihk soni\\chrome\\win64-140.0.7339.185\\chrome-win64\\chrome.exe";

const initializeWhatsApp = () => {
  if (client || initializing) {
    console.log(
      `[WhatsAppBackend] Skipping initialization: client=${!!client}, initializing=${!!initializing}`
    );
    return;
  }
  initializing = true;
  console.log(`[WhatsAppBackend] Initializing WhatsApp client...`);
  try {
    client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        executablePath: CHROME_EXECUTABLE_PATH,
      },
    });

    client.on("qr", async (qr) => {
      console.log(`[WhatsAppBackend] QR Code received`);
      qrCodeString = qr;
      try {
        const qrCodeDataURL = await qrcode.toDataURL(qr);
        io.emit("qr-code", qrCodeDataURL);
        io.emit("status-update", {
          isReady: isClientReady,
          hasQR: !!qrCodeString,
          reason: !isClientReady
            ? "QR generated, waiting for scan."
            : undefined,
        });
      } catch (err) {
        console.error(`[WhatsAppBackend] Error generating QR code:`, err);
        io.emit("status-update", {
          isReady: isClientReady,
          hasQR: !!qrCodeString,
          error: "QR code generation failed: " + err.message,
        });
      }
    });

    client.on("ready", () => {
      console.log(`[WhatsAppBackend] WhatsApp client is ready!`);
      isClientReady = true;
      initializing = false;
      io.emit("client-ready");
      io.emit("status-update", {
        isReady: isClientReady,
        hasQR: !!qrCodeString,
        reason: "WhatsApp client is fully ready.",
      });
      // Log client info when ready
      if (client && client.info) {
        console.log(`[WhatsAppBackend] Client info on ready:`, client.info);
      }
    });

    client.on("authenticated", () => {
      console.log(`[WhatsAppBackend] WhatsApp client authenticated`);
      io.emit("authenticated");
      io.emit("status-update", {
        isReady: isClientReady,
        hasQR: !!qrCodeString,
        reason: !isClientReady
          ? "Authenticated, but not ready. Waiting for WhatsApp client to emit 'ready'."
          : "Authenticated and ready.",
      });
      if (client && client.info) {
        console.log(
          `[WhatsAppBackend] Client info after authentication:`,
          client.info
        );
      }
      if (!isClientReady) {
        console.warn(
          `[WhatsAppBackend] WARNING: Authenticated but not ready. Waiting for WhatsApp client to emit 'ready'.`
        );
        // Print possible causes for not being ready
        console.warn(`[WhatsAppBackend] Possible causes:`);
        console.warn(
          `[WhatsAppBackend] - QR was scanned, but WhatsApp Web session did not fully load.`
        );
        console.warn(
          `[WhatsAppBackend] - Network issues or WhatsApp Web is blocked.`
        );
        console.warn(
          `[WhatsAppBackend] - Browser/puppeteer crashed or missing dependencies.`
        );
        console.warn(
          `[WhatsAppBackend] - WhatsApp account is not allowed to use Web (rare).`
        );
        console.warn(
          `[WhatsAppBackend] - Try scanning QR again, restarting backend, or checking for errors above.`
        );
      }
    });

    client.on("auth_failure", (msg) => {
      console.error(`[WhatsAppBackend] Authentication failed:`, msg);
      initializing = false;
      io.emit("auth-failure", msg);
      io.emit("status-update", {
        isReady: isClientReady,
        hasQR: !!qrCodeString,
        error: "Authentication failure: " + msg,
        reason: "Authentication failed. Please scan QR again or reset session.",
      });
    });

    client.on("disconnected", async (reason) => {
      console.log(`[WhatsAppBackend] WhatsApp client disconnected:`, reason);
      await safeDestroyClient("disconnected");
      io.emit("disconnected", reason);
      io.emit("status-update", {
        isReady: isClientReady,
        hasQR: !!qrCodeString,
        error: "Disconnected: " + reason,
        reason: "WhatsApp client disconnected. Will attempt reinitialization.",
      });
      setTimeout(() => {
        if (!client && !initializing) initializeWhatsApp();
      }, 3000);
    });

    client.on("change_state", (state) => {
      console.log(`[WhatsAppBackend] WhatsApp client state changed:`, state);
      io.emit("status-update", {
        isReady: isClientReady,
        hasQR: !!qrCodeString,
        state,
        reason: `Client state changed to: ${state}`,
      });
      // Log state transitions for debugging
      if (client && client.info) {
        console.log(
          `[WhatsAppBackend] Client info on state change:`,
          client.info
        );
      }
    });

    client.on("error", (err) => {
      console.error(`[WhatsAppBackend] WhatsApp client error:`, err);
      io.emit("status-update", {
        isReady: isClientReady,
        hasQR: !!qrCodeString,
        error: "Client error: " + err.message,
        reason: "WhatsApp client error: " + err.message,
      });
      if (
        err.message &&
        err.message.includes("Failed to launch the browser process")
      ) {
        console.error(
          `[WhatsAppBackend] Puppeteer/Chromium is missing or not installed. Please install all required dependencies for whatsapp-web.js.`
        );
        io.emit("status-update", {
          isReady: false,
          hasQR: false,
          error: "Puppeteer/Chromium missing. See backend logs.",
          reason: "Puppeteer/Chromium is missing or not installed.",
        });
      }
    });

    client.initialize().catch(async (err) => {
      console.error(
        `[WhatsAppBackend] Error initializing WhatsApp client:`,
        err
      );
      io.emit("status-update", {
        isReady: false,
        hasQR: false,
        error: "Initialization error: " + err.message,
        reason: "WhatsApp client failed to initialize. See backend logs.",
      });
      if (
        err.message &&
        err.message.includes("Failed to launch the browser process")
      ) {
        console.error(
          `[WhatsAppBackend] Puppeteer/Chromium is missing or not installed. Please install all required dependencies for whatsapp-web.js.`
        );
        io.emit("status-update", {
          isReady: false,
          hasQR: false,
          error: "Puppeteer/Chromium missing. See backend logs.",
          reason: "Puppeteer/Chromium is missing or not installed.",
        });
      }
      await safeDestroyClient("init-error");
    });
  } catch (err) {
    console.error(
      `[WhatsAppBackend] Fatal error initializing WhatsApp client:`,
      err
    );
    io.emit("status-update", {
      isReady: false,
      hasQR: false,
      error: "Fatal error: " + err.message,
      reason: "Fatal error during WhatsApp client initialization.",
    });
    if (
      err.message &&
      err.message.includes("Failed to launch the browser process")
    ) {
      console.error(
        `[WhatsAppBackend] Puppeteer/Chromium is missing or not installed. Please install all required dependencies for whatsapp-web.js.`
      );
      io.emit("status-update", {
        isReady: false,
        hasQR: false,
        error: "Puppeteer/Chromium missing. See backend logs.",
        reason: "Puppeteer/Chromium is missing or not installed.",
      });
    }
    initializing = false;
  }
};

// Routes
app.get("/api/status", (req, res) => {
  let errorMsg = undefined;
  let reasonMsg = undefined;
  if (!isClientReady) {
    if (isAuthenticated()) {
      errorMsg =
        "WhatsApp client is authenticated but not ready. Please wait for the 'ready' event or check backend logs for issues.";
      reasonMsg =
        "Authenticated, but not ready. Possible reasons: WhatsApp Web session not fully loaded, browser/puppeteer issues, or network problems.";
      // Print more details to backend log
      console.warn(
        `[WhatsAppBackend] /api/status: Authenticated but not ready.`
      );
      console.warn(
        `[WhatsAppBackend] /api/status: error="${errorMsg}" reason="${reasonMsg}"`
      );
      if (client && client.info) {
        console.warn(
          `[WhatsAppBackend] /api/status: client.info=`,
          client.info
        );
      }
    } else {
      errorMsg = "WhatsApp client not ready. Check backend logs for details.";
      reasonMsg =
        "Client not ready. Possible reasons: QR not scanned, authentication failed, or initialization error.";
      console.warn(
        `[WhatsAppBackend] /api/status: Not ready. error="${errorMsg}" reason="${reasonMsg}"`
      );
    }
  }
  res.json({
    isReady: isClientReady,
    hasQR: !!qrCodeString,
    error: errorMsg,
    reason: reasonMsg,
  });
});

app.post("/api/send-message", async (req, res) => {
  try {
    if (!isClientReady) {
      console.error(`[WhatsAppBackend] API Error: WhatsApp client not ready`);
      return res.status(400).json({ error: "WhatsApp client not ready" });
    }

    const { number, message } = req.body;

    if (!number || !message) {
      return res.status(400).json({ error: "Number and message are required" });
    }

    // Format number (add country code if not present)
    let formattedNumber = number.replace(/\D/g, "");
    if (!formattedNumber.startsWith("91")) {
      formattedNumber = "91" + formattedNumber;
    }
    formattedNumber += "@c.us";

    const sentMessage = await client.sendMessage(formattedNumber, message);

    res.json({
      success: true,
      messageId: sentMessage.id.id,
      to: number,
    });
  } catch (error) {
    console.error(`[WhatsAppBackend] Error sending message:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/send-image", upload.single("image"), async (req, res) => {
  try {
    if (!isClientReady) {
      console.error(`[WhatsAppBackend] API Error: WhatsApp client not ready`);
      return res.status(400).json({ error: "WhatsApp client not ready" });
    }

    const { number, caption } = req.body;
    const imageFile = req.file;

    if (!number || !imageFile) {
      return res.status(400).json({ error: "Number and image are required" });
    }

    // Format number
    let formattedNumber = number.replace(/\D/g, "");
    if (!formattedNumber.startsWith("91")) {
      formattedNumber = "91" + formattedNumber;
    }
    formattedNumber += "@c.us";

    const media = MessageMedia.fromFilePath(imageFile.path);
    const sentMessage = await client.sendMessage(formattedNumber, media, {
      caption,
    });

    res.json({
      success: true,
      messageId: sentMessage.id.id,
      to: number,
      imageName: imageFile.originalname,
    });
  } catch (error) {
    console.error(`[WhatsAppBackend] Error sending image:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/send-bulk", upload.single("image"), async (req, res) => {
  try {
    if (!isClientReady) {
      console.error(`[WhatsAppBackend] API Error: WhatsApp client not ready`);
      return res.status(400).json({ error: "WhatsApp client not ready" });
    }

    const { contacts, message, batchSettings } = req.body;
    const imageFile = req.file;

    if (!contacts || !message) {
      return res
        .status(400)
        .json({ error: "Contacts and message are required" });
    }

    const contactsList = JSON.parse(contacts);
    const settings = batchSettings ? JSON.parse(batchSettings) : null;
    const results = [];

    // Helper function to get random delay
    const getRandomDelay = () => {
      if (!settings?.randomDelay?.enabled) return 2000; // Default 2 seconds

      const min = (settings.randomDelay.min || 0) * 1000;
      const max = (settings.randomDelay.max || 5) * 1000;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    };

    // Helper function to process a batch
    const processBatch = async (batch, batchIndex) => {
      console.log(
        `Processing batch ${batchIndex + 1} with ${batch.length} contacts`
      );

      for (let i = 0; i < batch.length; i++) {
        const contact = batch[i];
        const globalIndex =
          batchIndex * (settings?.batchSize || contactsList.length) + i;

        try {
          // Format number
          let formattedNumber = contact.mobileNumber.replace(/\D/g, "");
          if (!formattedNumber.startsWith("91")) {
            formattedNumber = "91" + formattedNumber;
          }
          formattedNumber += "@c.us";

          let sentMessage;

          if (imageFile) {
            const media = MessageMedia.fromFilePath(imageFile.path);
            sentMessage = await client.sendMessage(formattedNumber, media, {
              caption: message,
            });
          } else {
            sentMessage = await client.sendMessage(formattedNumber, message);
          }

          results.push({
            success: true,
            contact,
            messageId: sentMessage.id.id,
          });

          // Emit progress
          io.emit("bulk-progress", {
            current: globalIndex + 1,
            total: contactsList.length,
            contact: contact.displayName,
            batch: batchIndex + 1,
            totalBatches: settings?.enableBatching
              ? Math.ceil(contactsList.length / settings.batchSize)
              : 1,
          });

          // Apply random delay between messages (except for last message in batch)
          if (i < batch.length - 1) {
            const delay = getRandomDelay();
            console.log(`Waiting ${delay}ms before next message...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } catch (error) {
          console.error(`Error sending to ${contact.displayName}:`, error);
          results.push({
            success: false,
            contact,
            error: error.message,
          });
        }
      }
    };

    if (settings?.enableBatching) {
      // Process in batches
      const batchSize = settings.batchSize || 50;
      const batches = [];

      for (let i = 0; i < contactsList.length; i += batchSize) {
        batches.push(contactsList.slice(i, i + batchSize));
      }

      console.log(
        `Sending ${contactsList.length} messages in ${batches.length} batches of ${batchSize}`
      );

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        await processBatch(batches[batchIndex], batchIndex);

        // Wait between batches (except for last batch)
        if (batchIndex < batches.length - 1) {
          const batchDelay = (settings.delayBetweenBatches || 60) * 60 * 1000; // Convert minutes to milliseconds
          console.log(
            `Waiting ${settings.delayBetweenBatches} minutes before next batch...`
          );

          // Emit batch delay progress
          io.emit("batch-delay", {
            currentBatch: batchIndex + 1,
            totalBatches: batches.length,
            delayMinutes: settings.delayBetweenBatches,
          });

          await new Promise((resolve) => setTimeout(resolve, batchDelay));
        }
      }
    } else {
      // Process all contacts as one batch
      await processBatch(contactsList, 0);
    }

    res.json({ results });
  } catch (error) {
    console.error(`[WhatsAppBackend] Error in bulk send:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/logout", async (req, res) => {
  try {
    if (client) {
      // Use safe destroy to avoid calling methods on null contexts
      await safeDestroyClient("logout");
      io.emit("logged-out");
      io.emit("status-update", {
        isReady: isClientReady,
        hasQR: !!qrCodeString,
      });

      // Reinitialize after delay to allow puppeteer cleanup
      setTimeout(() => {
        if (!client && !initializing) initializeWhatsApp();
      }, 3000);
    }

    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error(`[WhatsAppBackend] Error during logout:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Create uploads directory if it doesn't exist
const fs = require("fs");
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log("Client connected");

  // Send current status to new client
  socket.emit("status-update", {
    isReady: isClientReady,
    hasQR: !!qrCodeString,
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Global error handlers to keep server running and log issues
process.on("unhandledRejection", (reason) => {
  console.error(`[WhatsAppBackend] Unhandled Rejection:`, reason);
});
process.on("uncaughtException", (err) => {
  console.error(`[WhatsAppBackend] Uncaught Exception:`, err);
});

// Initialize WhatsApp client
initializeWhatsApp();

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
console.log(`Server running on port ${PORT}`);

function isAuthenticated() {
  return client && client.info && client.info.wid;
}

// Add API to check Puppeteer/Chromium health
app.get("/api/puppeteer-health", async (req, res) => {
  try {
    const puppeteerOk = (() => {
      try {
        require.resolve("puppeteer");
        return true;
      } catch {
        return false;
      }
    })();

    let chromeVersion = null;
    let errorMsg = null;
    let chromeFound = false;

    if (puppeteerOk) {
      try {
        const puppeteer = require("puppeteer");
        // Try to launch and get version (most reliable)
        const browser = await puppeteer.launch({ headless: true });
        try {
          chromeVersion = await browser.version();
          chromeFound = true;
        } catch (verErr) {
          errorMsg = "Puppeteer launched but could not get browser version: " + verErr.message;
        }
        await browser.close();
      } catch (err) {
        errorMsg = "Unable to launch Chrome/Chromium via Puppeteer: " + err.message;
      }
    } else {
      errorMsg = "Puppeteer npm package not installed.";
    }

    // Print health check result to backend log
    console.log(
      `[WhatsAppBackend] Puppeteer Health Check: puppeteerInstalled=${puppeteerOk}, chromeFound=${chromeFound}, chromeVersion=${chromeVersion ? chromeVersion : "N/A"}, error=${errorMsg || "none"}`
    );
    res.json({
      puppeteerInstalled: puppeteerOk,
      chromeVersion: chromeVersion,
      error: errorMsg,
    });
  } catch (err) {
    console.error(`[WhatsAppBackend] Puppeteer Health Check API error:`, err);
    res.status(500).json({
      error: "Failed to check Puppeteer/Chromium health: " + err.message,
    });
  }
});

// Add a test API to verify Puppeteer can launch Chrome using default detection (no executablePath)
app.get("/api/test-puppeteer-launch", async (req, res) => {
  try {
    const puppeteer = require("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      // No executablePath: let Puppeteer auto-detect Chrome/Chromium
    });
    const page = await browser.newPage();
    // Add navigation timeout and error handling
    try {
      await page.goto("https://example.com", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
    } catch (navErr) {
      await browser.close();
      console.error(`[WhatsAppBackend] Puppeteer navigation failed:`, navErr);
      return res.status(500).json({
        success: false,
        error: "Puppeteer launched but failed to navigate: " + navErr.message,
      });
    }
    const title = await page.title();
    await browser.close();
    res.json({
      success: true,
      message: "Puppeteer launched Chrome/Chromium and navigated successfully.",
      pageTitle: title,
    });
  } catch (err) {
    console.error(`[WhatsAppBackend] Puppeteer launch test failed:`, err);
    res.status(500).json({
      success: false,
      error: "Failed to launch Puppeteer/Chrome: " + err.message,
    });
  }
});
