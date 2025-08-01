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

  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const whatsappService = useRef(new WhatsAppService());

  useEffect(() => {
    // Initialize socket connection
    whatsappService.current.initializeSocket(
      (qrCodeDataURL) => {
        setQrCode(qrCodeDataURL);
        setIsConnected(false);
      },
      () => {
        setIsConnected(true);
        setQrCode("");
      },
      (current, total, contactName) => {
        setProgress((current / total) * 100);
        setCurrentContact(contactName);
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

  const sendMessages = async () => {
    if (!message.trim() || contacts.length === 0) {
      alert("Please provide a message and upload contacts");
      return;
    }

    if (!isConnected) {
      alert("Please connect to WhatsApp first");
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
        imageFile
      );

      setResults(messageResults);
      console.log("Bulk message results:", messageResults);
      alert("Messages sent successfully!");
    } catch (error) {
      console.error("Error sending messages:", error);
      alert(`Error sending messages: ${error.message}`);
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

  return (
    <div className="app">
      <h1>WhatsApp Bulk Messenger</h1>

      <div className="info-banner">
        📱 All messages will be sent to: <strong>9314539152</strong>
      </div>

      <div className="section">
        <h2>1. WhatsApp Connection</h2>
        {qrCode && (
          <div className="qr-section">
            <p>Scan this QR code with your WhatsApp mobile app:</p>
            <img src={qrCode} alt="WhatsApp QR Code" className="qr-code" />
            <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
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
        <h2>3. Compose Message</h2>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Enter your message here..."
          rows={4}
          cols={50}
        />
      </div>

      <div className="section">
        <h2>4. Upload Image (Optional)</h2>
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
        <h2>5. Send Messages</h2>
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
