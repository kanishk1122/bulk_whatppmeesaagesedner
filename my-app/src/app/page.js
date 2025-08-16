"use client";

import { useState, useRef, useEffect } from "react";
import { parseCSV } from "../services/csvParser";
import { WhatsAppService } from "../services/whatsappService";

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

  // New UI states
  const [showQRModal, setShowQRModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activityLog, setActivityLog] = useState([]);

  useEffect(() => {
    // Initialize socket connection
    whatsappService.current.initializeSocket(
      (qrCodeDataURL) => {
        setQrCode(qrCodeDataURL);
        setIsConnected(false);
        setShowQRModal(true);
        setActivityLog((l) => [
          `QR generated at ${new Date().toLocaleTimeString()}`,
          ...l,
        ]);
      },
      () => {
        setIsConnected(true);
        setQrCode("");
        setShowQRModal(false);
        setActivityLog((l) => [
          `Client ready at ${new Date().toLocaleTimeString()}`,
          ...l,
        ]);
      },
      (current, total, contactName) => {
        setProgress((current / total) * 100);
        setCurrentContact(contactName);
        setActivityLog((l) =>
          [`${contactName} (${current}/${total})`, ...l].slice(0, 50)
        );
      },
      () => {
        setIsConnected(false);
        setQrCode("");
        setIsLoggingOut(false);
        alert("Logged out successfully");
      }
    );

    // Check initial status
    checkStatus();

    return () => {
      whatsappService.current.disconnect();
    };
  }, []);

  const checkStatus = async () => {
    const status = await whatsappService.current.getStatus();
    setIsConnected(status.isReady);
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
      const formData = new FormData();
      formData.append("contacts", JSON.stringify(contacts));
      formData.append("message", message);
      if (imageFile) formData.append("image", imageFile);
      formData.append("batchSettings", JSON.stringify(batchSettings));

      const response = await fetch("/api/send-bulk", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to send bulk messages");
      }

      setResults(result.results);
      setActivityLog((l) =>
        [`Send finished: ${result.results.length} items`, ...l].slice(0, 50)
      );
      alert("Messages sent successfully!");
    } catch (error) {
      setActivityLog((l) =>
        [`Send error: ${error.message}`, ...l].slice(0, 50)
      );
      alert(`Error sending messages: ${error.message}`);
    } finally {
      setIsSending(false);
      setCurrentContact("");
    }
  };

  // Reset session to force new QR (calls Next.js API)
  const handleResetSession = async () => {
    if (!confirm("Reset session and force a new QR?")) return;
    try {
      const res = await fetch("/api/reset-session", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to reset session");
      setActivityLog((l) =>
        [`Session reset at ${new Date().toLocaleTimeString()}`, ...l].slice(
          0,
          50
        )
      );
      // show QR modal while waiting for new QR
      setShowQRModal(true);
    } catch (err) {
      alert(`Reset failed: ${err.message}`);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await whatsappService.current.logout();
      setActivityLog((l) =>
        [`Logged out at ${new Date().toLocaleTimeString()}`, ...l].slice(0, 50)
      );
      setIsConnected(false);
      setQrCode("");
      alert("Logged out successfully");
    } catch (error) {
      setActivityLog((l) =>
        [`Logout error: ${error.message}`, ...l].slice(0, 50)
      );
      alert(`Error logging out: ${error.message}`);
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Filtered contacts for search
  const filteredContacts = contacts.filter((c) => {
    if (!searchQuery) return true;
    return (
      c.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.mobileNumber?.includes(searchQuery)
    );
  });

  return (
    <div className="app">
      <div
        className="toolbar"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>WhatsApp Bulk Messenger</h1>
          <div style={{ fontSize: "0.9rem", marginTop: "4px" }}>
            <span style={{ marginRight: 8 }}>
              {isConnected ? "✅ Connected" : "❌ Disconnected"}
            </span>
            <button
              onClick={handleResetSession}
              style={{ marginLeft: 8 }}
              className="logout-button"
            >
              🔄 Reset Session
            </button>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <small style={{ color: "#666" }}>{contacts.length} contacts</small>
        </div>
      </div>

      {/* QR Modal */}
      {showQRModal && qrCode && (
        <div style={{ marginBottom: "1rem", textAlign: "center" }}>
          <div
            style={{
              display: "inline-block",
              padding: 12,
              borderRadius: 8,
              background: "#fff",
              boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
            }}
          >
            <p style={{ margin: "0 0 8px 0", color: "#666" }}>
              Scan QR with WhatsApp → Linked Devices
            </p>
            <img src={qrCode} alt="WhatsApp QR Code" className="qr-code" />
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => setShowQRModal(false)}
                className="remove-image-btn"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="section">
        <h2>1. WhatsApp Connection</h2>
        {qrCode && (
          <div className="qr-section" style={{ textAlign: "center" }}>
            <p style={{ marginBottom: 8 }}>QR available — open modal to scan</p>
            <button
              onClick={() => {
                setShowQRModal(true);
              }}
              className="send-button"
            >
              Show QR
            </button>
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

      <div
        className="section"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: "1rem",
          alignItems: "start",
        }}
      >
        <div>
          <h2>2. Upload CSV File</h2>
          <input
            type="file"
            accept=".csv"
            onChange={handleCSVUpload}
            ref={fileInputRef}
          />
          {contacts.length > 0 && <p>✅ {contacts.length} contacts loaded</p>}
          <div style={{ marginTop: 12 }}>
            <h3 style={{ margin: "8px 0" }}>Search Contacts</h3>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name or number"
              style={{
                width: "100%",
                padding: "8px",
                borderRadius: 4,
                border: "1px solid #ccc",
              }}
            />
          </div>
        </div>

        <div>
          <h2>Loaded Contacts (preview)</h2>
          <div
            className="contacts-preview"
            style={{ maxHeight: 320, overflowY: "auto" }}
          >
            {filteredContacts.length === 0 && (
              <p style={{ color: "#666" }}>No contacts</p>
            )}
            {filteredContacts.slice(0, 50).map((contact) => (
              <div
                key={contact.id}
                className="contact"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 0",
                }}
              >
                <div>
                  <strong>{contact.displayName}</strong>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {contact.mobileNumber}
                  </div>
                </div>
                <div style={{ alignSelf: "center" }}>
                  <button
                    className="send-button"
                    onClick={() => {
                      navigator.clipboard?.writeText(contact.mobileNumber);
                      setActivityLog((l) =>
                        [`Copied ${contact.mobileNumber}`, ...l].slice(0, 50)
                      );
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            ))}
            {contacts.length > 50 && (
              <p>...and {contacts.length - 50} more contacts</p>
            )}
          </div>
        </div>
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
          disabled={isSending || !isConnected || contacts.length === 0}
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
        <h2>Activity</h2>
        <div className="results" style={{ maxHeight: 200 }}>
          {activityLog.length === 0 && (
            <p style={{ color: "#666" }}>No activity yet</p>
          )}
          {activityLog.map((entry, i) => (
            <div
              key={i}
              style={{
                padding: "6px 0",
                borderBottom: "1px solid #eee",
                fontSize: 13,
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
    </div>
  );
}

export default App;
