import { useState, useRef, useEffect } from "react";
import { parseCSV } from "./services/csvParser";
import { WhatsAppService } from "./services/whatsappService";
import "./App.css";

function App() {
  const [contacts, setContacts] = useState([]);
  const [message, setMessage] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [qrCode, setQrCode] = useState("");
  const [currentContact, setCurrentContact] = useState("");
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [backendLog, setBackendLog] = useState([]);
  const [backendStatus, setBackendStatus] = useState({
    isReady: false,
    hasQR: false,
  });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [puppeteerHealth, setPuppeteerHealth] = useState(null);

  // Batch settings
  const [batchSettings, setBatchSettings] = useState({
    enableBatching: false,
    batchSize: 50,
    delayBetweenBatches: 60, // minutes
    randomDelay: {
      enabled: false,
      min: 0,
      max: 5, // seconds
    },
  });

  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const whatsappService = useRef(new WhatsAppService());

  useEffect(() => {
    // Initialize socket connection
    const socket = whatsappService.current.initializeSocket(
      (qrCodeDataURL) => {
        setQrCode(qrCodeDataURL);
        setIsConnected(false);
        setBackendLog((log) => [
          `[QR] QR code generated at ${new Date().toLocaleTimeString()}`,
          ...log,
        ]);
      },
      () => {
        setIsConnected(true);
        setQrCode("");
        setBackendLog((log) => [
          `[READY] WhatsApp client ready at ${new Date().toLocaleTimeString()}`,
          ...log,
        ]);
      },
      (current, total, contactName) => {
        setProgress((current / total) * 100);
        setCurrentContact(contactName);
        setBackendLog((log) => [
          `[PROGRESS] ${contactName} (${current}/${total})`,
          ...log,
        ]);
      },
      () => {
        setIsConnected(false);
        setQrCode("");
        setIsLoggingOut(false);
        setBackendLog((log) => [
          `[LOGOUT] Logged out at ${new Date().toLocaleTimeString()}`,
          ...log,
        ]);
        alert("Logged out successfully");
      }
    );

    // Listen for backend status and other events
    socket.on("status-update", (status) => {
      setBackendStatus(status);
      setBackendLog((log) => [
        `[STATUS] isReady: ${status.isReady}, hasQR: ${
          status.hasQR
        } (${new Date().toLocaleTimeString()})`,
        ...log,
      ]);
    });
    socket.on("bulk-progress", (progress) => {
      setBackendLog((log) => [
        `[BULK] ${progress.contact} (${progress.current}/${progress.total})`,
        ...log,
      ]);
    });
    socket.on("disconnected", (reason) => {
      setBackendLog((log) => [
        `[DISCONNECTED] Reason: ${reason} (${new Date().toLocaleTimeString()})`,
        ...log,
      ]);
      setIsAuthenticated(false);
    });
    socket.on("authenticated", () => {
      setBackendLog((log) => [
        `[AUTHENTICATED] WhatsApp authenticated (${new Date().toLocaleTimeString()})`,
        ...log,
      ]);
      setIsAuthenticated(true);
    });
    socket.on("logged-out", () => {
      setBackendLog((log) => [
        `[LOGGED-OUT] WhatsApp logged out (${new Date().toLocaleTimeString()})`,
        ...log,
      ]);
      setIsAuthenticated(false);
    });

    // Check initial status
    checkStatus();

    return () => {
      whatsappService.current.disconnect();
    };
  }, []);

  const checkStatus = async () => {
    const status = await whatsappService.current.getStatus();
    setIsConnected(status.isReady);
    if (status.error) {
      setQrCode("");
      setResults([]);
      setCurrentContact("");
      alert(
        "Backend not reachable or not ready. Please check server logs or scan QR if shown."
      );
    }
  };

  const handleCSVUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const parsedContacts = await parseCSV(file);
      setContacts(parsedContacts);
      console.log("Parsed contacts:", parsedContacts);
    } catch (error) {
      console.error("Error parsing CSV:", error);
      alert("Error parsing CSV file. Please check the format.");
    }
  };

  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    setImageFile(file);

    // Create preview URL
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      setImagePreview(previewUrl);
    } else {
      setImagePreview(null);
    }
  };

  // Cleanup preview URL when component unmounts or image changes
  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  const handleBatchSettingsChange = (key, value) => {
    setBatchSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleRandomDelayChange = (key, value) => {
    setBatchSettings((prev) => ({
      ...prev,
      randomDelay: {
        ...prev.randomDelay,
        [key]: value,
      },
    }));
  };

  const sendMessages = async () => {
    if (!message.trim() || contacts.length === 0) {
      alert("Please provide a message and upload contacts");
      return;
    }

    setIsSending(true);
    setProgress(0);
    setResults([]);
    setCurrentContact("");

    try {
      const messageResults = await whatsappService.current.sendBulkMessages(
        contacts,
        message,
        imageFile,
        batchSettings
      );

      setResults(messageResults);
      console.log("Bulk message results:", messageResults);
      alert("Messages sent successfully!");
    } catch (error) {
      console.error("Error sending messages:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsSending(false);
      setCurrentContact("");
    }
  };

  const handleLogout = async () => {
    if (window.confirm("Are you sure you want to logout from WhatsApp?")) {
      setIsLoggingOut(true);
      try {
        await whatsappService.current.logout();
        // Reset states after logout
        setQrCode("");
        setIsConnected(false);
      } catch (error) {
        console.error("Error during logout:", error);
        alert(`Error during logout: ${error.message}`);
      } finally {
        setIsLoggingOut(false);
      }
    }
  };

  const checkPuppeteerHealth = async () => {
    setPuppeteerHealth("Checking...");
    try {
      const res = await fetch("http://localhost:3001/api/puppeteer-health");
      const data = await res.json();
      setPuppeteerHealth(
        `Puppeteer: ${
          data.puppeteerInstalled ? "✅ Installed" : "❌ Not Installed"
        } | ` +
          `Chrome: ${data.chromeVersion ? data.chromeVersion : "❌ Not Found"}${
            data.error ? " | Error: " + data.error : ""
          }`
      );
    } catch (err) {
      setPuppeteerHealth("Error: " + err.message);
    }
  };

  return (
    <div className="app">
      <h1>WhatsApp Bulk Messenger</h1>

      {/* <div className="info-banner">
        📱 All messages will be sent to: <strong>9314539152</strong>
      </div> */}

      <div className="section">
        <h2>1. WhatsApp Connection</h2>
        <div style={{ marginBottom: 8 }}>
          <strong>Backend Status:</strong>
          <span style={{ marginLeft: 8 }}>
            {backendStatus.isReady ? "🟢 Ready" : "🔴 Not Ready"}
          </span>
          <span style={{ marginLeft: 8 }}>
            {backendStatus.hasQR ? "QR Available" : "No QR"}
          </span>
          <span style={{ marginLeft: 8 }}>
            {isAuthenticated ? "🔒 Authenticated" : "🔓 Not Authenticated"}
          </span>
        </div>
        {/* Puppeteer health check button and result */}
        <div style={{ marginBottom: 8 }}>
          <button onClick={checkPuppeteerHealth} style={{ marginRight: 8 }}>
            Check Puppeteer/Chromium Health
          </button>
          {puppeteerHealth && (
            <span
              style={{
                fontSize: 13,
                color:
                  puppeteerHealth.includes("Error") ||
                  puppeteerHealth.includes("❌")
                    ? "#d9534f"
                    : "#28a745",
              }}
            >
              {puppeteerHealth}
            </span>
          )}
        </div>
        {/* Show QR section if QR is available, even if qrCode is not set yet */}
        {(qrCode || backendStatus.hasQR) && (
          <div className="qr-section">
            <p>
              {qrCode
                ? "Scan this QR code with your WhatsApp mobile app:"
                : "QR code is available. Please wait for it to load or check your browser connection."}
            </p>
            {qrCode ? (
              <img src={qrCode} alt="WhatsApp QR Code" className="qr-code" />
            ) : (
              <div style={{ color: "#d9534f", margin: "16px 0" }}>
                QR code is being generated... If it does not appear, reload or
                check backend logs.
              </div>
            )}
            <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
            <p style={{ color: "#d9534f" }}>
              {isConnected
                ? "WhatsApp is ready."
                : "Waiting for QR scan. Please scan the QR code above."}
            </p>
          </div>
        )}
        <div
          className={`connection-status ${
            isConnected ? "connected" : "disconnected"
          }`}
        >
          {isConnected ? "✅ WhatsApp Connected" : "❌ WhatsApp Disconnected"}
        </div>

        {isConnected && (
          <button
            onClick={handleLogout}
            disabled={isLoggingOut || isSending}
            className="logout-button"
          >
            {isLoggingOut ? "Logging out..." : "🚪 Logout"}
          </button>
        )}
      </div>

      <div className="section">
        <h2>2. Upload CSV File</h2>
        <input
          type="file"
          accept=".csv"
          onChange={handleCSVUpload}
          ref={fileInputRef}
        />
        {contacts.length > 0 && <p>✅ {contacts.length} contacts loaded</p>}
      </div>

      <div className="section">
        <h2>3. Batch Settings</h2>
        <div className="batch-settings">
          <div className="setting-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={batchSettings.enableBatching}
                onChange={(e) =>
                  handleBatchSettingsChange("enableBatching", e.target.checked)
                }
              />
              Split Messages Into Batches
            </label>
          </div>

          {batchSettings.enableBatching && (
            <>
              <div className="setting-group">
                <label>
                  Send in batches of:
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={batchSettings.batchSize}
                    onChange={(e) =>
                      handleBatchSettingsChange(
                        "batchSize",
                        parseInt(e.target.value)
                      )
                    }
                    className="number-input"
                  />
                  messages
                </label>
              </div>

              <div className="setting-group">
                <label>
                  Wait between batches:
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={batchSettings.delayBetweenBatches}
                    onChange={(e) =>
                      handleBatchSettingsChange(
                        "delayBetweenBatches",
                        parseInt(e.target.value)
                      )
                    }
                    className="number-input"
                  />
                  minutes after every batch
                </label>
              </div>
            </>
          )}

          <div className="setting-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={batchSettings.randomDelay.enabled}
                onChange={(e) =>
                  handleRandomDelayChange("enabled", e.target.checked)
                }
              />
              Random time gap
            </label>
          </div>

          {batchSettings.randomDelay.enabled && (
            <div className="random-delay-settings">
              <div className="delay-range">
                <label>
                  From:
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={batchSettings.randomDelay.min}
                    onChange={(e) =>
                      handleRandomDelayChange("min", parseInt(e.target.value))
                    }
                    className="number-input small"
                  />
                  sec
                </label>
                <label>
                  To:
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={batchSettings.randomDelay.max}
                    onChange={(e) =>
                      handleRandomDelayChange("max", parseInt(e.target.value))
                    }
                    className="number-input small"
                  />
                  sec
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <h2>4. Compose Message</h2>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Enter your message here..."
          rows={4}
          cols={50}
        />
      </div>

      <div className="section">
        <h2>5. Upload Image (Optional)</h2>
        <input
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          ref={imageInputRef}
        />
        {imageFile && (
          <div className="image-preview-section">
            <p>✅ Image: {imageFile.name}</p>
            {imagePreview && (
              <div className="image-preview">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="preview-image"
                />
                <button
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                    imageInputRef.current.value = "";
                  }}
                  className="remove-image-btn"
                >
                  ❌ Remove Image
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="section">
        <h2>6. Send Messages</h2>
        <button
          onClick={sendMessages}
          disabled={isSending || contacts.length === 0}
          className="send-button"
        >
          {isSending ? "Sending..." : "Send Messages"}
        </button>

        {isSending && (
          <div className="progress">
            <div
              className="progress-bar"
              style={{ width: `${progress}%` }}
            ></div>
            <span>{Math.round(progress)}%</span>
            {currentContact && <p>Sending to: {currentContact}</p>}
          </div>
        )}
      </div>

      <div className="section">
        <h2>Backend Activity Log</h2>
        <div
          className="results"
          style={{
            maxHeight: 180,
            overflowY: "auto",
            fontSize: 13,
            border: "1px solid #ddd",
            padding: 10,
            borderRadius: 4,
          }}
        >
          {backendLog.length === 0 && (
            <p style={{ color: "#666" }}>No backend events yet</p>
          )}
          {backendLog.slice(0, 50).map((entry, i) => (
            <div
              key={i}
              style={{
                padding: "4px 0",
                borderBottom: "1px solid #eee",
                whiteSpace: "pre-wrap",
              }}
            >
              {entry}
            </div>
          ))}
        </div>
      </div>

      {results.length > 0 && (
        <div className="section">
          <h2>Results</h2>
          <div className="results">
            {results.map((result, index) => (
              <div
                key={index}
                className={`result ${result.success ? "success" : "error"}`}
              >
                {result.success ? "✅" : "❌"} {result.contact.displayName} →
                9314539152
                {!result.success && (
                  <span className="error-msg"> - {result.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {contacts.length > 0 && (
        <div className="section">
          <h2>Loaded Contacts</h2>
          <div className="contacts-preview">
            {contacts.slice(0, 5).map((contact) => (
              <div key={contact.id} className="contact">
                {contact.displayName} - {contact.mobileNumber}
              </div>
            ))}
            {contacts.length > 5 && (
              <p>...and {contacts.length - 5} more contacts</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
