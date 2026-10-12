const {
  DisconnectReason,
  makeWASocket,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

// Leave empty to block all links, or add trusted domains such as "example.com".
const ALLOWED_DOMAINS = [];
const TARGET_GROUP_NAME = "ABCD!";
const DELETE_GRACE_PERIOD_MS = 2 * 60 * 1000;
const THANK_YOU_MESSAGE =
  "இணைப்பை நீக்கியதற்கு மிக்க நன்றி. குழு விதிகளை மதித்ததற்கு நன்றி. 🙏";
const pendingWarnings = new Map();

function getMessageId(key) {
  return `${key.remoteJid}:${key.id}`;
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

function findLinks(text) {
  return text.match(/https?:\/\/[^\s<>()]+|www\.[^\s<>()]+/gi) || [];
}

function isAllowedLink(link) {
  try {
    const url = new URL(link.startsWith("www.") ? `https://${link}` : link);
    const hostname = url.hostname.toLowerCase();
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

  sock.ev.on("messages.delete", async ({ keys }) => {
    if (!keys) return;

    for (const key of keys) {
      const pending = pendingWarnings.get(getMessageId(key));
      if (!pending) continue;

      clearTimeout(pending.timer);
      pendingWarnings.delete(getMessageId(key));

      try {
        await sock.sendMessage(pending.groupJid, {
          delete: pending.warningKey,
        });
      } catch (error) {
        console.error("Could not delete the link warning:", error);
      }

      try {
        await sock.sendMessage(pending.groupJid, {
          text: THANK_YOU_MESSAGE,
        });
      } catch (error) {
        console.error("Could not send the Tamil thank-you message:", error);
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

        const sender = message.pushName || "A group member";
        const warning = `⚠️ ${sender}, தயவுசெய்து 2 நிமிடங்களுக்குள் அனுமதிக்கப்படாத இணைப்பை நீக்கவும். நன்றி.`;
        const messageId = getMessageId(message.key);
        const pending = { groupJid, warningKey: undefined, timer: undefined };
        pendingWarnings.set(messageId, pending);

        try {
          const warningMessage = await sock.sendMessage(
            groupJid,
            { text: warning },
            { quoted: message },
          );
          pending.warningKey = warningMessage.key;

          pending.timer = setTimeout(async () => {
            if (pendingWarnings.get(messageId) !== pending) return;
            pendingWarnings.delete(messageId);

            try {
              await sock.sendMessage(groupJid, { delete: message.key });
            } catch (error) {
              console.error("Could not delete the link message:", error);
            }

            try {
              await sock.sendMessage(groupJid, {
                delete: pending.warningKey,
              });
            } catch (error) {
              console.error("Could not delete the link warning:", error);
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
