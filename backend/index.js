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

    const { contacts, message } = req.body;
    const imageFile = req.file;

    if (!contacts || !message) {
      return res
        .status(400)
        .json({ error: "Contacts and message are required" });
    }

    const contactsList = JSON.parse(contacts);
    const results = [];

    for (let i = 0; i < contactsList.length; i++) {
      const contact = contactsList[i];

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
          current: i + 1,
          total: contactsList.length,
          contact: contact.displayName,
        });

        // Delay between messages to avoid rate limiting
        if (i < contactsList.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
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

