# WhatsApp Group Link Moderator

A free, minimal Node.js bot that moderates links in the configured WhatsApp
group. It replies to unapproved links with a warning and gives the sender two
minutes to remove the link. The warning remains in the group in either case.
If the link is removed in time, the bot sends a polite thank-you message in
Tamil. Otherwise, it attempts to delete the link and sends a courteous removal
notice in Tamil. Both follow-up replies quote the original link message. All
bot replies end with “இங்ஙனம், நமது ஊர் உறவுகள்”. The bot addresses the member
by their WhatsApp display name, or by phone number when a display name is
unavailable. Links on configured payment-provider
domains are allowed automatically. WhatsApp links are exempt only when their
path is `/pay` or `/payments`; other WhatsApp links are still moderated.

In the configured group, the bot also uses OCR to look for payment-service or
transaction terms together with a payment status, amount, or transaction
reference in uploaded images. When both kinds of clues are detected, it replies
with a Tamil welcome and thanks; ordinary photos without payment text are
ignored. Links in a recognized payment-image message are not moderated. OCR
recognizes text; it does not verify that a payment is genuine.
The terminal reports whether OCR found each kind of clue, without printing
recognized image text. On first use, Tesseract downloads English and Tamil
language data and caches it under `node_modules/.cache/tesseract`, so the bot
needs internet access.

The bot moderates the group named by `targetGroupName` in `config.json`
(currently `ABCD!`). The comparison ignores capitalization and leading/trailing
spaces.

When connected, the bot sets the linked WhatsApp account's profile name to
`Uravukal Bot` and applies the bot avatar in `bot-logo.svg` as its profile
picture. Profile changes require the linked account to be online.

The bot also posts a Tamil morning greeting with a rotating Thirukkural,
short moral story, or saying to that group every day at the configured time.
Edit `dailyGreeting.sendAt`, `dailyGreeting.timeZone`, and the `dailyGreeting.messages`
list in `config.json` to change the schedule or content. The default is 2:15 PM
India time (`Asia/Kolkata`). The bot must be online and in the group when the
message is due; it does not send missed greetings later.

## Requirements

- Node.js 20 or newer
- The bot avatar uses the `sharp` image-processing package, installed by
  `npm install`
- A WhatsApp account to link to the bot
- Group-admin approval to add the bot to the group and promote it to admin

## Run it

1. Install dependencies: `npm install`
2. Start the bot: `npm start`
3. Scan the QR code with WhatsApp under **Settings > Linked devices > Link a
   device**.
4. Add the linked account to your group and promote it to admin so it can
   delete link messages after the two-minute grace period.

Make sure the group's name matches `targetGroupName` in `config.json`. If you
rename the group, update this setting and restart the bot.

The linked-device session is stored in `auth_info_baileys/`. Keep that folder
private: anyone with it may be able to use the linked WhatsApp session. It is
excluded from Git by `.gitignore`.

## Allow trusted domains

Edit `ALLOWED_DOMAINS` near the top of `index.js` to add more trusted domains,
for example:

```js
const ALLOWED_DOMAINS = ["example.com", "news.example.org"];
```

Subdomains are allowed too (for example, `docs.example.com` is accepted when
`example.com` is allowlisted). Unapproved links from group admins are moderated
the same way as links from other members.

## Important

Baileys connects through WhatsApp Web's unofficial protocol; it is not an
official WhatsApp Business API. Using unofficial automation may violate
WhatsApp's terms or result in account restrictions. Use a separate account and
at your own risk. Keep the bot running on a computer or server for it to
moderate messages; this starter has no paid hosting requirement.
