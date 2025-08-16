const express = require("express");
const cors = require("cors");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");
const path = require("path");

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

const initializeWhatsApp = () => {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  client.on("qr", async (qr) => {
    console.log("QR Code received");
    qrCodeString = qr;

    // Generate QR code as data URL
    try {
      const qrCodeDataURL = await qrcode.toDataURL(qr);
      io.emit("qr-code", qrCodeDataURL);
    } catch (err) {
      console.error("Error generating QR code:", err);
    }
  });

  client.on("ready", () => {
    console.log("WhatsApp client is ready!");
    isClientReady = true;
    io.emit("client-ready");
  });

  client.on("authenticated", () => {
    console.log("WhatsApp client authenticated");
    io.emit("authenticated");
  });

  client.on("auth_failure", (msg) => {
    console.error("Authentication failed:", msg);
    io.emit("auth-failure", msg);
  });

  client.on("disconnected", (reason) => {
    console.log("WhatsApp client disconnected:", reason);
    isClientReady = false;
    io.emit("disconnected", reason);
  });

  client.initialize();
};

// Routes
app.get("/api/status", (req, res) => {
  res.json({
    isReady: isClientReady,
    hasQR: !!qrCodeString,
  });
});

app.post("/api/send-message", async (req, res) => {
  try {
    if (!isClientReady) {
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
    console.error("Error sending message:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/send-image", upload.single("image"), async (req, res) => {
  try {
    if (!isClientReady) {
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
    console.error("Error sending image:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/send-bulk", upload.single("image"), async (req, res) => {
  try {
    if (!isClientReady) {
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
    console.error("Error in bulk send:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/logout", async (req, res) => {
  try {
    if (client) {
      await client.logout();
      await client.destroy();
      isClientReady = false;
      qrCodeString = "";
      io.emit("logged-out");

      // Reinitialize client for next connection immediately
      initializeWhatsApp();
    }

    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Error during logout:", error);
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

// Initialize WhatsApp client
initializeWhatsApp();

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
console.log(`Server running on port ${PORT}`);
