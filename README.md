# WhatsApp Group Link Moderator

A free, minimal Node.js bot that moderates links in the configured WhatsApp
group. It replies to unapproved links with a warning and gives the sender two
minutes to remove the link. If the link is removed in time, the bot removes its
warning and sends a polite thank-you message in Tamil. Otherwise, it attempts
to delete both the link and its warning. The default allowlist is empty, so all
detected links are treated as unapproved.

The bot only moderates the group whose name matches `TARGET_GROUP_NAME` in
`index.js` (currently `ABCD!`). The comparison ignores capitalization and
leading/trailing spaces.

## Requirements

- Node.js 20 or newer
- A WhatsApp account to link to the bot
- Group-admin approval to add the bot to the group and promote it to admin

## Run it

1. Install dependencies: `npm install`
2. Start the bot: `npm start`
3. Scan the QR code with WhatsApp under **Settings > Linked devices > Link a
   device**.
4. Add the linked account to your group and promote it to admin so it can
   delete messages after the two-minute grace period and remove its warnings.

Make sure the group's name matches `TARGET_GROUP_NAME` in `index.js`. If you
rename the group, update this setting and restart the bot.

The linked-device session is stored in `auth_info_baileys/`. Keep that folder
private: anyone with it may be able to use the linked WhatsApp session. It is
excluded from Git by `.gitignore`.

## Allow trusted domains

Edit `ALLOWED_DOMAINS` near the top of `index.js`, for example:

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
