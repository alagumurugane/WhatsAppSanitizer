const {
  DisconnectReason,
  downloadMediaMessage,
  makeWASocket,
  useMultiFileAuthState,
  WAMessageStubType,
} = require("@whiskeysockets/baileys");
const fs = require("node:fs");
const path = require("node:path");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const { createWorker } = require("tesseract.js");

// Official payment domains are exempt from link moderation.
const ALLOWED_DOMAINS = [
  "gpay.app",
  "pay.google.com",
  "phonepe.com",
  "phon.pe",
  "paytm.com",
  "paytm.me",
];
const TARGET_GROUP_NAME = "ABCD!";
const DELETE_GRACE_PERIOD_MS = 2 * 60 * 1000;
const SIGNATURE = "இங்ஙனம்,\nநமது ஊர் உறவுகள்";
const OCR_CACHE_PATH = path.join(
  __dirname,
  "node_modules",
  ".cache",
  "tesseract",
);
const PAYMENT_WELCOME_MESSAGE =
  "பரிவர்த்தனைத் தகவல்களை பகிர்ந்ததற்கு மிக்க மகிழ்ச்சி! உங்கள் அருட்கொடைக்கு மனமார்ந்த நன்றி. மகிழ்ச்சியுடன் வரவேற்கிறோம் 🙏";
const pendingWarnings = new Map();
let ocrWorkerPromise;

function withSignature(message) {
  return `${message}\n\n${SIGNATURE}`;
}

function getMessageId(key) {
  return `${key.remoteJid}:${key.id}`;
}

function getMemberName(message) {
  const pushName = message.pushName?.trim();
  if (pushName) return pushName;

  const participant = message.key.participant || message.participant;
  const phoneMatch = participant?.match(/^(\d+(?::\d+)?)@(s\.whatsapp\.net|c\.us)$/);
  if (phoneMatch) return phoneMatch[1].split(":")[0];

  return "அன்புள்ள குழு உறுப்பினரே";
}

function buildMemberReply(memberName, text) {
  return withSignature(`${memberName}, ${text}`);
}

function getText(message) {
  if (!message) return "";

  if (
    message.ephemeralMessage ||
    message.viewOnceMessage ||
    message.viewOnceMessageV2 ||
    message.documentWithCaptionMessage
  ) {
    const wrapped = Object.values(message).find((value) => value?.message);
    return getText(wrapped?.message);
  }

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ""
  );
}

function getImageMessage(message) {
  if (!message) return undefined;
  if (message.imageMessage) return message.imageMessage;

  const wrapped = Object.values(message).find((value) => value?.message);
  return getImageMessage(wrapped?.message);
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    fs.mkdirSync(OCR_CACHE_PATH, { recursive: true });
    ocrWorkerPromise = createWorker(["eng", "tam"], undefined, {
      cachePath: OCR_CACHE_PATH,
    }).catch((error) => {
      ocrWorkerPromise = undefined;
      throw error;
    });
  }

  return ocrWorkerPromise;
}

async function isPaymentScreenshot(message) {
  const imageMessage = getImageMessage(message.message);
  if (!imageMessage) return false;

  const mediaSize = Number(imageMessage.fileLength);
  if (Number.isFinite(mediaSize) && mediaSize > 20 * 1024 * 1024) {
    console.warn("Skipped payment-image OCR for an image larger than 20 MB.");
    return false;
  }

  const image = await downloadMediaMessage(message, "buffer", {});
  const worker = await getOcrWorker();
  const {
    data: { text },
  } = await worker.recognize(image);
  const normalizedText = text.toLowerCase().replace(/[\r\n\t]+/g, " ");
  const hasPaymentContext =
    /\b(?:upi|payment|transaction|transfer(?:red)?|paid\s+to|money\s+sent|amount|debit(?:ed)?|credit(?:ed)?|phonepe|google\s*pay|gpay|paytm|bhim|amazon\s*pay|bharatpe|mobikwik|imps|neft|rtgs|inr|rs\.?)\b|₹|பரிவர்த்தனை|கட்டணம்|செலுத்த|ரூபாய்/i.test(
      normalizedText,
    );
  const hasTransactionDetail =
    /\b(?:success(?:ful(?:ly)?)?|completed|paid|credited|received|sent\s+successfully|payment\s+done|transaction\s+done|transfer\s+complete|utr|rrn|reference|transaction\s+id|txn\s+id)\b|(?:₹|rs\.?|inr)\s*[\d,]+(?:\.\d{1,2})?|வெற்றிகரமாக|வெற்றியடைந்த|செலுத்தப்பட்டது|அனுப்பப்பட்டது|பெறப்பட்டது/i.test(
      normalizedText,
    );

  console.log(
    `Payment image OCR complete: ${text.trim().length} characters; payment terms ${hasPaymentContext ? "found" : "not found"}; transaction details ${hasTransactionDetail ? "found" : "not found"}.`,
  );
  return hasPaymentContext && hasTransactionDetail;
}

function findLinks(text) {
  return text.match(/https?:\/\/[^\s<>()]+|www\.[^\s<>()]+/gi) || [];
}

function isAllowedLink(link) {
  try {
    const url = new URL(link.startsWith("www.") ? `https://${link}` : link);
    const hostname = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (
      (hostname === "wa.me" || hostname === "whatsapp.com") &&
      /^\/(?:pay|payments)(?:\/|$)/.test(path)
    ) {
      return true;
    }

    return ALLOWED_DOMAINS.some((domain) => {
      const allowed = domain.toLowerCase().replace(/^\.+|\.+$/g, "");
      return hostname === allowed || hostname.endsWith(`.${allowed}`);
    });
  } catch (error) {
    console.warn(`Could not parse detected link "${link}":`, error.message);
    return false;
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("Scan this QR code with WhatsApp > Linked devices:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") console.log("WhatsApp bot connected.");
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log("Connection closed; reconnecting...");
        startBot().catch((error) => console.error("Reconnect failed:", error));
      } else {
        console.error("Logged out. Remove auth_info_baileys and scan the QR again.");
      }
    }
  });

  const handleLinkMessageRemoval = async (key) => {
    const messageId = getMessageId(key);
    const pending = pendingWarnings.get(messageId);
    if (!pending) return;

    clearTimeout(pending.timer);
    pendingWarnings.delete(messageId);

    try {
      await sock.sendMessage(pending.groupJid, {
        text: buildMemberReply(
          pending.memberName,
          "குறிப்பிட்ட நேரத்திற்குள் இணைப்பை நீக்கியதற்கு மிக்க நன்றி. உங்கள் ஒத்துழைப்பையும் குழு விதிகளை மதித்ததையும் மனமாரப் பாராட்டுகிறோம். 🙏",
        ),
      }, {
        quoted: pending.originalMessage,
      });
    } catch (error) {
      console.error("Could not send the Tamil thank-you message:", error);
    }
  };

  sock.ev.on("messages.delete", async ({ keys }) => {
    if (!keys) return;
    for (const key of keys) await handleLinkMessageRemoval(key);
  });

  sock.ev.on("messages.update", async (updates) => {
    for (const { key, update } of updates) {
      if (update.messageStubType === WAMessageStubType.REVOKE) {
        await handleLinkMessageRemoval(key);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const message of messages) {
      const groupJid = message.key.remoteJid;
      if (
        message.key.fromMe ||
        !groupJid?.endsWith("@g.us") ||
        !message.message
      ) {
        continue;
      }

      let paymentImage = false;
      if (getImageMessage(message.message)) {
        try {
          const metadata = await sock.groupMetadata(groupJid);
          if (
            metadata.subject.trim().toLowerCase() !==
            TARGET_GROUP_NAME.trim().toLowerCase()
          ) {
            continue;
          }

          paymentImage = await isPaymentScreenshot(message);
          if (paymentImage) {
            await sock.sendMessage(
              groupJid,
              {
                text: buildMemberReply(
                  getMemberName(message),
                  PAYMENT_WELCOME_MESSAGE,
                ),
              },
              { quoted: message },
            );
            console.log("Sent Tamil welcome for a payment image.");
          }
        } catch (error) {
          console.error("Could not inspect the group image for a payment:", error);
        }
      }

      if (paymentImage) continue;

      const links = findLinks(getText(message.message));
      if (!links.length || links.every(isAllowedLink)) continue;

      try {
        const metadata = await sock.groupMetadata(groupJid);
        if (
          metadata.subject.trim().toLowerCase() !==
          TARGET_GROUP_NAME.trim().toLowerCase()
        ) {
          continue;
        }

        const memberName = getMemberName(message);
        const warning = buildMemberReply(
          `⚠️ ${memberName}`,
          "தயவுசெய்து 2 நிமிடங்களுக்குள் இந்த அனுமதியற்ற இணைப்பை நீக்குமாறு பணிவன்புடன் கேட்டுக்கொள்கிறோம். ஒத்துழைப்பிற்கு நன்றி. 🙏",
        );
        const messageId = getMessageId(message.key);
        const pending = {
          groupJid,
          memberName,
          originalMessage: message,
          timer: undefined,
        };
        pendingWarnings.set(messageId, pending);

        try {
          await sock.sendMessage(
            groupJid,
            { text: warning },
            { quoted: message },
          );

          pending.timer = setTimeout(async () => {
            if (pendingWarnings.get(messageId) !== pending) return;
            pendingWarnings.delete(messageId);

            let deleted = false;
            try {
              await sock.sendMessage(groupJid, { delete: message.key });
              deleted = true;
            } catch (error) {
              console.error("Could not delete the link message:", error);
            }

            try {
              await sock.sendMessage(groupJid, {
                text: buildMemberReply(
                  memberName,
                  deleted
                    ? "குறிப்பிட்ட 2 நிமிடங்களுக்குள் இணைப்பு நீக்கப்படாததால், குழு விதிகளின்படி அந்தச் செய்தியை நீக்கியுள்ளோம். உங்கள் புரிதலுக்கும் ஒத்துழைப்பிற்கும் மிக்க நன்றி. 🙏"
                    : "குறிப்பிட்ட நேரத்திற்குள் இணைப்பு நீக்க முயற்சித்தோம்; ஆனால் எங்களால் அதை நீக்க முடியவில்லை. தயவுசெய்து குழு நிர்வாகியிடம் தெரிவிக்கவும். உங்கள் ஒத்துழைப்பிற்கு நன்றி. 🙏",
                ),
              }, {
                quoted: message,
              });
            } catch (error) {
              console.error("Could not send the Tamil removal notice:", error);
            }
          }, DELETE_GRACE_PERIOD_MS);
        } catch (error) {
          pendingWarnings.delete(messageId);
          console.error("Could not send the link warning:", error);
        }
      } catch (error) {
        console.error("Could not moderate the group message:", error);
      }
    }
  });
}

startBot().catch((error) => {
  console.error("Bot startup failed:", error);
  process.exitCode = 1;
});
