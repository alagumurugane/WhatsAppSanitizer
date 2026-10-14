function getZonedDateParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));

  return Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
}

function getTimestampForLocalTime(parts, timeZone) {
  const localTimestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let timestamp = localTimestamp;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoned = getZonedDateParts(timestamp, timeZone);
    const zonedTimestamp = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
    );
    timestamp += localTimestamp - zonedTimestamp;
  }

  return timestamp;
}

function getNextGreetingTime(now, sendAt, timeZone) {
  const [hour, minute] = sendAt.split(":").map(Number);
  const today = getZonedDateParts(now, timeZone);
  const targetParts = {
    year: today.year,
    month: today.month,
    day: today.day,
    hour,
    minute,
    second: 0,
  };
  let timestamp = getTimestampForLocalTime(targetParts, timeZone);

  if (timestamp <= now) {
    const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    targetParts.year = tomorrow.getUTCFullYear();
    targetParts.month = tomorrow.getUTCMonth() + 1;
    targetParts.day = tomorrow.getUTCDate();
    timestamp = getTimestampForLocalTime(targetParts, timeZone);
  }

  return timestamp;
}

function createGreetingMessage(now, settings) {
  const localDate = getZonedDateParts(now, settings.timeZone);
  const dayNumber = Math.floor(
    Date.UTC(localDate.year, localDate.month - 1, localDate.day) / 86400000,
  );
  const entry = settings.messages[dayNumber % settings.messages.length];
  const details = entry.meaning
    ? `\n\nபொருள்: ${entry.meaning}`
    : "";

  return `வணக்கம்! அனைவருக்கும் இனிய காலை வணக்கம் 🌞\n\n${entry.type}:\n${entry.text}${details}`;
}

function scheduleDailyGreeting(sock, config) {
  const settings = config.dailyGreeting;
  const sendAtMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(settings.sendAt);
  if (!sendAtMatch) {
    throw new Error('dailyGreeting.sendAt must be in 24-hour "HH:mm" format.');
  }
  if (typeof config.targetGroupName !== "string" || !config.targetGroupName.trim()) {
    throw new Error("targetGroupName must be a non-empty group name.");
  }
  if (!Array.isArray(settings.messages) || settings.messages.length === 0) {
    throw new Error("dailyGreeting.messages must contain at least one message.");
  }
  if (
    settings.messages.some(
      (entry) =>
        typeof entry.type !== "string" ||
        !entry.type.trim() ||
        typeof entry.text !== "string" ||
        !entry.text.trim() ||
        (entry.meaning !== undefined && typeof entry.meaning !== "string"),
    )
  ) {
    throw new Error(
      "Every dailyGreeting.messages entry must have a type and text, with an optional meaning.",
    );
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: settings.timeZone,
  });
  formatter.format(new Date());

  let timer;
  let cancelled = false;

  const scheduleNext = () => {
    if (cancelled) return;

    const now = Date.now();
    const sendTime = getNextGreetingTime(now, settings.sendAt, settings.timeZone);
    const delay = sendTime - now;
    timer = setTimeout(async () => {
      try {
        const groups = await sock.groupFetchAllParticipating();
        const targetName = config.targetGroupName.trim().toLowerCase();
        const targetGroup = Object.entries(groups).find(([, group]) =>
          group.subject?.trim().toLowerCase() === targetName
        );

        if (!targetGroup) {
          console.error(
            `Could not send the morning greeting: group "${config.targetGroupName}" was not found.`,
          );
          return;
        }

        await sock.sendMessage(targetGroup[0], {
          text: createGreetingMessage(sendTime, settings),
        });
        console.log(
          `Sent the Tamil morning greeting to "${targetGroup[1].subject}".`,
        );
      } catch (error) {
        console.error("Could not send the Tamil morning greeting:", error);
      } finally {
        scheduleNext();
      }
    }, delay);

    console.log(
      `Daily Tamil greeting scheduled for ${settings.sendAt} (${settings.timeZone}).`,
    );
  };

  scheduleNext();

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

module.exports = {
  createGreetingMessage,
  getNextGreetingTime,
  scheduleDailyGreeting,
};
