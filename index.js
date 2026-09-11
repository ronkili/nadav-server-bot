require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  Events,
  AttachmentBuilder
} = require("discord.js");

const config = require("./config");

const DATA_DIR = path.join(__dirname, "data");
const MOD_TIMERS_FILE = path.join(DATA_DIR, "mod-timers.json");
const XP_FILE = path.join(DATA_DIR, "xp.json");
const WARNINGS_FILE = path.join(DATA_DIR, "warns.json");
const VOICE_TIME_FILE = path.join(
  DATA_DIR,
  "voice-time.json"
);
const RESTRAINING_ORDERS_FILE = path.join(
  DATA_DIR,
  "restraining-orders.json"
);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error("❌ JSON load error:", error);
    return fallback;
  }
}

function saveJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("❌ JSON save error:", error);
  }
}

const modTimers = loadJson(MOD_TIMERS_FILE, {});
const xpData = loadJson(XP_FILE, {
  users: {},
  cooldowns: {}
});

const warningsData = loadJson(WARNINGS_FILE, {
  guilds: {}
});

const voiceTimeData = loadJson(
  VOICE_TIME_FILE,
  {
    guilds: {}
  }
);

const activeVoiceSessions = new Map();

const restrainingOrdersData = loadJson(
  RESTRAINING_ORDERS_FILE,
  {
    guilds: {}
  }
);

const restrainingDisconnectLocks = new Set();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

function isStaff(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    (config.staffRoleId && member?.roles?.cache?.has(config.staffRoleId))
  );
}

function hasPunishmentAccess(member) {
  return Boolean(
    config.punishmentRoleId &&
    member?.roles?.cache?.has(
      config.punishmentRoleId
    )
  );
}

function parseDuration(input, maxDays = 30) {
  const match = String(input || "")
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*(s|m|h|d)$/);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  const duration = amount * multipliers[unit];

  if (
    !Number.isFinite(duration) ||
    duration < 10 * 1000 ||
    duration > maxDays * 24 * 60 * 60 * 1000
  ) {
    return null;
  }

  return duration;
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} שניות`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} דקות`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} שעות`;

  const days = Math.floor(hours / 24);
  return `${days} ימים`;
}

function timerKey(guildId, userId, type) {
  return `${guildId}:${userId}:${type}`;
}

function addModTimer({ guildId, userId, type, expiresAt, reason, moderatorId }) {
  modTimers[timerKey(guildId, userId, type)] = {
    guildId,
    userId,
    type,
    expiresAt,
    reason,
    moderatorId,
    createdAt: Date.now()
  };

  saveJson(MOD_TIMERS_FILE, modTimers);
}

function removeModTimer(guildId, userId, type) {
  const key = timerKey(guildId, userId, type);

  if (modTimers[key]) {
    delete modTimers[key];
    saveJson(MOD_TIMERS_FILE, modTimers);
  }
}

async function sendModLog(guild, embed) {
  if (!config.modLogsChannelId) return;

  const channel = await guild.channels
    .fetch(config.modLogsChannelId)
    .catch(() => null);

  if (channel?.isTextBased()) {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

function buildModEmbed(title, color, fields) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(fields)
    .setTimestamp();
}

async function getGuildMember(interaction, user) {
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

// =====================
// WARNS SYSTEM
// =====================

const WARN_PUNISHMENTS = {
  3: {
    duration: 60 * 60 * 1000,
    label: "שעה"
  },
  5: {
    duration: 24 * 60 * 60 * 1000,
    label: "יום"
  },
  7: {
    duration: 7 * 24 * 60 * 60 * 1000,
    label: "7 ימים"
  }
};

function saveWarningsData() {
  saveJson(WARNINGS_FILE, warningsData);
}

function getGuildWarnings(guildId) {
  if (!warningsData.guilds[guildId]) {
    warningsData.guilds[guildId] = {
      nextId: 1,
      users: {}
    };
  }

  return warningsData.guilds[guildId];
}

function getUserWarnings(guildId, userId) {
  const guildData = getGuildWarnings(guildId);

  if (!guildData.users[userId]) {
    guildData.users[userId] = {
      warns: [],
      triggeredPunishments: []
    };
  }

  const userData = guildData.users[userId];

  if (!Array.isArray(userData.warns)) {
    userData.warns = [];
  }

  if (!Array.isArray(userData.triggeredPunishments)) {
    userData.triggeredPunishments = [];
  }

  return userData;
}

function createWarning({
  guildId,
  userId,
  moderatorId,
  reason,
  action = "none",
  durationMs = null
}) {
  const guildData = getGuildWarnings(guildId);
  const userData = getUserWarnings(guildId, userId);

  const number = Number(guildData.nextId) || 1;
  const id = `W${String(number).padStart(4, "0")}`;

  guildData.nextId = number + 1;

  const warning = {
    id,
    userId,
    moderatorId,
    reason,
    action,
    durationMs:
      durationMs === null
        ? null
        : Number(durationMs),
    createdAt: Date.now()
  };

  userData.warns.push(warning);
  saveWarningsData();

  return warning;
}

function removeWarning(guildId, userId, warningId) {
  const userData = getUserWarnings(guildId, userId);

  const normalizedId = String(warningId || "")
    .trim()
    .toUpperCase();

  const index = userData.warns.findIndex(
    warn => String(warn.id).toUpperCase() === normalizedId
  );

  if (index === -1) {
    return null;
  }

  const [removed] = userData.warns.splice(index, 1);

  const currentCount = userData.warns.length;

  userData.triggeredPunishments =
    userData.triggeredPunishments.filter(
      threshold => Number(threshold) <= currentCount
    );

  saveWarningsData();
  return removed;
}

function clearUserWarnings(guildId, userId) {
  const userData = getUserWarnings(guildId, userId);
  const removedCount = userData.warns.length;

  userData.warns = [];
  userData.triggeredPunishments = [];

  saveWarningsData();
  return removedCount;
}

function getWarnActionLabel(action) {
  const labels = {
    none: "Warn בלבד",
    "voice-mute": "Voice Mute",
    "chat-mute": "Chat Mute",
    timeout: "Timeout",
    ban: "Ban",
    "auto-link": "Anti-Link"
  };

  return labels[action] || "Warn בלבד";
}

function getWarnActionDetails(
  action,
  durationMs = null
) {
  const label =
    getWarnActionLabel(action);

  if (
    [
      "voice-mute",
      "chat-mute",
      "timeout"
    ].includes(action) &&
    durationMs
  ) {
    return (
      `${label} ל־${formatDuration(durationMs)}`
    );
  }

  return label;
}

async function validateSelectedWarnAction({
  interaction,
  member,
  action,
  duration
}) {
  if (
    [
      "voice-mute",
      "chat-mute",
      "timeout"
    ].includes(action) &&
    !duration
  ) {
    return {
      ok: false,
      message:
        "❌ בפעולה שבחרת חייבים לבחור גם `duration`."
    };
  }

  if (
    ["timeout", "ban"].includes(action) &&
    !hasPunishmentAccess(
      interaction.member
    )
  ) {
    return {
      ok: false,
      message:
        "❌ בשביל Warn עם Timeout או Ban צריך את הרול שמוגדר ב־`punishmentRoleId`."
    };
  }

  if (action === "voice-mute") {
    if (!member.voice.channelId) {
      return {
        ok: false,
        message:
          "❌ אי אפשר לתת Voice Mute דרך ה־Warn כי המשתמש לא נמצא כרגע ב־Voice."
      };
    }

    const botMember =
      await interaction.guild.members
        .fetchMe()
        .catch(() => null);

    if (
      !botMember ||
      !botMember.permissions.has(
        PermissionFlagsBits.MuteMembers
      )
    ) {
      return {
        ok: false,
        message:
          "❌ לבוט אין `Mute Members`."
      };
    }
  }

  if (action === "chat-mute") {
    if (!config.muteRoleId) {
      return {
        ok: false,
        message:
          "❌ חסר `muteRoleId` ב־config.js."
      };
    }

    const muteRole =
      await interaction.guild.roles
        .fetch(config.muteRoleId)
        .catch(() => null);

    if (!muteRole) {
      return {
        ok: false,
        message:
          "❌ לא מצאתי את רול ה־Chat Mute."
      };
    }

    const botMember =
      await interaction.guild.members
        .fetchMe()
        .catch(() => null);

    if (
      !botMember ||
      !botMember.permissions.has(
        PermissionFlagsBits.ManageRoles
      )
    ) {
      return {
        ok: false,
        message:
          "❌ לבוט אין `Manage Roles`."
      };
    }

    if (
      muteRole.managed ||
      muteRole.position >=
        botMember.roles.highest.position
    ) {
      return {
        ok: false,
        message:
          "❌ הבוט לא יכול לנהל את רול ה־Chat Mute. שים את רול הבוט מעליו."
      };
    }
  }

  if (
    action === "timeout" &&
    !member.moderatable
  ) {
    return {
      ok: false,
      message:
        "❌ אי אפשר לתת Timeout למשתמש הזה."
    };
  }

  if (
    action === "ban" &&
    !member.bannable
  ) {
    return {
      ok: false,
      message:
        "❌ אי אפשר לתת Ban למשתמש הזה."
    };
  }

  return {
    ok: true
  };
}

async function applySelectedWarnAction({
  interaction,
  member,
  user,
  action,
  duration,
  reason
}) {
  if (action === "none") {
    return {
      applied: true,
      label: "Warn בלבד"
    };
  }

  if (action === "voice-mute") {
    await member.voice.setMute(
      true,
      `${reason} | Warn action by ${interaction.user.tag}`
    );

    addModTimer({
      guildId: interaction.guild.id,
      userId: user.id,
      type: "voice-mute",
      expiresAt: Date.now() + duration,
      reason,
      moderatorId: interaction.user.id
    });

    return {
      applied: true,
      label:
        `Voice Mute ל־${formatDuration(duration)}`
    };
  }

  if (action === "chat-mute") {
    const muteRole =
      await interaction.guild.roles
        .fetch(config.muteRoleId);

    await member.roles.add(
      muteRole,
      `${reason} | Warn action by ${interaction.user.tag}`
    );

    addModTimer({
      guildId: interaction.guild.id,
      userId: user.id,
      type: "chat-mute",
      expiresAt: Date.now() + duration,
      reason,
      moderatorId: interaction.user.id
    });

    return {
      applied: true,
      label:
        `Chat Mute ל־${formatDuration(duration)}`
    };
  }

  if (action === "timeout") {
    await member.timeout(
      duration,
      `${reason} | Warn action by ${interaction.user.tag}`
    );

    return {
      applied: true,
      label:
        `Timeout ל־${formatDuration(duration)}`
    };
  }

  if (action === "ban") {
    await interaction.guild.members.ban(
      user.id,
      {
        reason:
          `${reason} | Warn action by ${interaction.user.tag}`
      }
    );

    return {
      applied: true,
      label: "Ban"
    };
  }

  return {
    applied: false,
    label: "לא ידוע"
  };
}

function containsBlockedLink(content) {
  const text =
    String(content || "");

  const linkRegex =
    /(?:https?:\/\/|ftp:\/\/|www\.|discord\.gg\/|discord(?:app)?\.com\/invite\/|discord\.com\/channels\/|(?:[a-z0-9-]+\.)+(?:com|net|org|gg|io|co|il|me|tv|xyz|dev|app|link|site|info|ly|be)(?:\/[^\s]*)?)/i;

  return linkRegex.test(text);
}

async function handleAntiLink(message) {
  if (!message.guild) return false;
  if (message.author.bot) return false;

  // Staff/Admin can send links when needed.
  if (isStaff(message.member)) {
    return false;
  }

  if (
    !containsBlockedLink(
      message.content
    )
  ) {
    return false;
  }

  await message.delete().catch(error => {
    console.error(
      "❌ Anti-Link delete error:",
      error
    );
  });

  const warning =
    createWarning({
      guildId: message.guild.id,
      userId: message.author.id,
      moderatorId:
        client.user?.id ||
        message.guild.members.me?.id,
      reason: "שליחת קישור אסור",
      action: "auto-link"
    });

  const userWarnData =
    getUserWarnings(
      message.guild.id,
      message.author.id
    );

  const warnCount =
    userWarnData.warns.length;

  const member =
    message.member ||
    await message.guild.members
      .fetch(message.author.id)
      .catch(() => null);

  const autoPunishment =
    member
      ? await applyWarnPunishment(
          message.guild,
          member,
          userWarnData,
          client.user
        )
      : null;

  let autoText = "";

  if (autoPunishment?.applied) {
    autoText =
      `\n⏳ עונש אוטומטי: Timeout ל־${autoPunishment.label}.`;
  }

  await message.author.send(
    `⚠️ קיבלת Warn אוטומטי בשרת **${message.guild.name}**.\n` +
    `ID: **${warning.id}**\n` +
    "סיבה: שליחת קישור אסור\n" +
    `סה"כ Warns פעילים: **${warnCount}**` +
    autoText
  ).catch(() => {});

  await sendModLog(
    message.guild,
    buildModEmbed(
      "🔗 Anti-Link Warn",
      "Red",
      [
        {
          name: "משתמש",
          value: `${message.author}`
        },
        {
          name: "Warn ID",
          value: warning.id
        },
        {
          name: "סיבה",
          value: "שליחת קישור אסור"
        },
        {
          name: "Warns פעילים",
          value: `${warnCount}`
        },
        {
          name: "עונש אוטומטי",
          value:
            autoPunishment?.applied
              ? `Timeout ל־${autoPunishment.label}`
              : "אין"
        }
      ]
    )
  );

  const notice =
    await message.channel.send({
      content:
        `🚫 ${message.author} אסור לשלוח קישורים. קיבלת Warn **${warning.id}**.`,
      allowedMentions: {
        users: [message.author.id]
      }
    }).catch(() => null);

  if (notice) {
    setTimeout(() => {
      notice.delete().catch(() => {});
    }, 6000);
  }

  return true;
}

function warningListText(warns) {
  if (!warns.length) {
    return "אין אזהרות פעילות.";
  }

  const visible = warns.slice(-10).reverse();

  const lines = visible.map(warn => {
    const timestamp = Math.floor(
      Number(warn.createdAt || Date.now()) / 1000
    );

    const shortReason = String(
      warn.reason || "לא צוינה סיבה"
    ).slice(0, 160);

    const actionText =
      getWarnActionDetails(
        warn.action || "none",
        warn.durationMs || null
      );

    return (
      `**${warn.id}** • ${shortReason}\n` +
      `פעולה: **${actionText}**\n` +
      `צוות: <@${warn.moderatorId}> • <t:${timestamp}:R>`
    );
  });

  if (warns.length > visible.length) {
    lines.push(
      `\nמוצגות 10 האזהרות האחרונות מתוך ${warns.length}.`
    );
  }

  return lines.join("\n\n");
}

async function applyWarnPunishment(
  guild,
  member,
  userData,
  moderator
) {
  const count = userData.warns.length;
  const punishment = WARN_PUNISHMENTS[count];

  if (!punishment) {
    return null;
  }

  if (
    userData.triggeredPunishments.includes(count)
  ) {
    return null;
  }

  userData.triggeredPunishments.push(count);
  saveWarningsData();

  if (!member?.moderatable) {
    return {
      applied: false,
      count,
      label: punishment.label,
      reason:
        "הבוט לא יכול לתת Timeout למשתמש הזה."
    };
  }

  try {
    await member.timeout(
      punishment.duration,
      `Zone X auto punishment: ${count} warns | Staff: ${moderator.tag}`
    );

    return {
      applied: true,
      count,
      label: punishment.label
    };
  } catch (error) {
    console.error(
      "❌ Automatic warn punishment error:",
      error
    );

    return {
      applied: false,
      count,
      label: punishment.label,
      reason:
        error.code || error.message || "Unknown error"
    };
  }
}


// =====================
// WEEKLY VOICE TIME
// =====================

function saveVoiceTimeData() {
  saveJson(
    VOICE_TIME_FILE,
    voiceTimeData
  );
}

function getCurrentWeekStartMs(
  now = Date.now()
) {
  const date = new Date(now);

  const day = date.getUTCDay();

  const daysFromMonday =
    day === 0
      ? 6
      : day - 1;

  date.setUTCDate(
    date.getUTCDate() -
    daysFromMonday
  );

  date.setUTCHours(0, 0, 0, 0);

  return date.getTime();
}

function ensureVoiceWeek(
  guildId,
  now = Date.now()
) {
  const weekStart =
    getCurrentWeekStartMs(now);

  const current =
    voiceTimeData.guilds[guildId];

  if (
    !current ||
    Number(current.weekStart) !==
      weekStart
  ) {
    voiceTimeData.guilds[guildId] = {
      weekStart,
      users: {}
    };

    for (
      const session of
      activeVoiceSessions.values()
    ) {
      if (
        session.guildId === guildId
      ) {
        session.startedAt =
          Math.max(
            Number(session.startedAt) ||
              weekStart,
            weekStart
          );
      }
    }

    saveVoiceTimeData();
  }

  const guildData =
    voiceTimeData.guilds[guildId];

  if (
    !guildData.users ||
    typeof guildData.users !== "object"
  ) {
    guildData.users = {};
  }

  return guildData;
}

function getVoiceTimeProfile(
  guildId,
  userId
) {
  const guildData =
    ensureVoiceWeek(guildId);

  if (!guildData.users[userId]) {
    guildData.users[userId] = {
      milliseconds: 0
    };
  }

  const profile =
    guildData.users[userId];

  profile.milliseconds =
    Math.max(
      0,
      Number(
        profile.milliseconds || 0
      )
    );

  return profile;
}

function voiceSessionKey(
  guildId,
  userId
) {
  return `${guildId}:${userId}`;
}

function startVoiceSession(
  guildId,
  userId,
  startedAt = Date.now()
) {
  const guildData =
    ensureVoiceWeek(
      guildId,
      startedAt
    );

  const key =
    voiceSessionKey(
      guildId,
      userId
    );

  if (
    activeVoiceSessions.has(key)
  ) {
    return;
  }

  activeVoiceSessions.set(
    key,
    {
      guildId,
      userId,
      startedAt:
        Math.max(
          startedAt,
          guildData.weekStart
        )
    }
  );
}

function endVoiceSession(
  guildId,
  userId,
  endedAt = Date.now()
) {
  const key =
    voiceSessionKey(
      guildId,
      userId
    );

  const session =
    activeVoiceSessions.get(key);

  if (!session) {
    return;
  }

  const guildData =
    ensureVoiceWeek(
      guildId,
      endedAt
    );

  const profile =
    getVoiceTimeProfile(
      guildId,
      userId
    );

  const startedAt =
    Math.max(
      Number(session.startedAt) ||
        endedAt,
      guildData.weekStart
    );

  const elapsed =
    Math.max(
      0,
      endedAt - startedAt
    );

  profile.milliseconds += elapsed;

  activeVoiceSessions.delete(key);
  saveVoiceTimeData();
}

function flushActiveVoiceSessions() {
  const now = Date.now();
  let changed = false;

  for (
    const [
      key,
      session
    ] of activeVoiceSessions
  ) {
    const guildData =
      ensureVoiceWeek(
        session.guildId,
        now
      );

    const profile =
      getVoiceTimeProfile(
        session.guildId,
        session.userId
      );

    const startedAt =
      Math.max(
        Number(session.startedAt) ||
          now,
        guildData.weekStart
      );

    const elapsed =
      Math.max(
        0,
        now - startedAt
      );

    if (elapsed > 0) {
      profile.milliseconds +=
        elapsed;

      session.startedAt = now;

      activeVoiceSessions.set(
        key,
        session
      );

      changed = true;
    }
  }

  if (changed) {
    saveVoiceTimeData();
  }
}

function getWeeklyVoiceTimeMs(
  guildId,
  userId
) {
  const now = Date.now();

  const guildData =
    ensureVoiceWeek(
      guildId,
      now
    );

  const profile =
    getVoiceTimeProfile(
      guildId,
      userId
    );

  let total =
    Number(
      profile.milliseconds || 0
    );

  const session =
    activeVoiceSessions.get(
      voiceSessionKey(
        guildId,
        userId
      )
    );

  if (session) {
    total += Math.max(
      0,
      now -
        Math.max(
          Number(session.startedAt) ||
            now,
          guildData.weekStart
        )
    );
  }

  return total;
}

function formatWeeklyVoiceTime(ms) {
  const totalMinutes =
    Math.floor(
      Math.max(0, Number(ms || 0)) /
      60000
    );

  const hours =
    Math.floor(
      totalMinutes / 60
    );

  const minutes =
    totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

function handleVoiceTimeStateChange(
  oldState,
  newState
) {
  const member =
    newState.member ||
    oldState.member;

  if (
    !member ||
    member.user?.bot
  ) {
    return;
  }

  const oldChannelId =
    oldState.channelId;

  const newChannelId =
    newState.channelId;

  if (
    !oldChannelId &&
    newChannelId
  ) {
    startVoiceSession(
      newState.guild.id,
      newState.id
    );

    return;
  }

  if (
    oldChannelId &&
    !newChannelId
  ) {
    endVoiceSession(
      oldState.guild.id,
      oldState.id
    );
  }
}

function initializeActiveVoiceSessions() {
  for (
    const guild of
    client.guilds.cache.values()
  ) {
    ensureVoiceWeek(guild.id);

    for (
      const voiceState of
      guild.voiceStates.cache.values()
    ) {
      if (
        !voiceState.channelId ||
        voiceState.member?.user?.bot
      ) {
        continue;
      }

      startVoiceSession(
        guild.id,
        voiceState.id
      );
    }
  }
}


// =====================
// RESTRAINING ORDERS
// =====================

function saveRestrainingOrdersData() {
  saveJson(
    RESTRAINING_ORDERS_FILE,
    restrainingOrdersData
  );
}

function getGuildRestrainingOrders(guildId) {
  if (!restrainingOrdersData.guilds[guildId]) {
    restrainingOrdersData.guilds[guildId] = {
      nextId: 1,
      orders: []
    };
  }

  const guildData =
    restrainingOrdersData.guilds[guildId];

  if (!Array.isArray(guildData.orders)) {
    guildData.orders = [];
  }

  if (
    !Number.isInteger(
      Number(guildData.nextId)
    ) ||
    Number(guildData.nextId) < 1
  ) {
    guildData.nextId = 1;
  }

  return guildData;
}

function isRestrainingOrderActive(order) {
  return Boolean(
    order &&
    (
      order.expiresAt === null ||
      Number(order.expiresAt) > Date.now()
    )
  );
}

function sameRestrainingPair(
  order,
  user1Id,
  user2Id
) {
  return Boolean(
    order &&
    (
      (
        order.user1Id === user1Id &&
        order.user2Id === user2Id
      ) ||
      (
        order.user1Id === user2Id &&
        order.user2Id === user1Id
      )
    )
  );
}

function findActiveRestrainingOrder(
  guildId,
  user1Id,
  user2Id
) {
  const guildData =
    getGuildRestrainingOrders(guildId);

  return guildData.orders.find(
    order =>
      isRestrainingOrderActive(order) &&
      sameRestrainingPair(
        order,
        user1Id,
        user2Id
      )
  ) || null;
}

function createRestrainingOrder({
  guildId,
  user1Id,
  user2Id,
  moderatorId,
  reason,
  expiresAt
}) {
  const guildData =
    getGuildRestrainingOrders(guildId);

  const number =
    Number(guildData.nextId) || 1;

  const id =
    `RO${String(number).padStart(4, "0")}`;

  guildData.nextId = number + 1;

  const order = {
    id,
    guildId,
    user1Id,
    user2Id,
    moderatorId,
    reason,
    createdAt: Date.now(),
    expiresAt
  };

  guildData.orders.push(order);
  saveRestrainingOrdersData();

  return order;
}

function removeRestrainingOrder(
  guildId,
  orderId
) {
  const guildData =
    getGuildRestrainingOrders(guildId);

  const normalizedId =
    String(orderId || "")
      .trim()
      .toUpperCase();

  const index =
    guildData.orders.findIndex(
      order =>
        String(order.id)
          .toUpperCase() === normalizedId
    );

  if (index === -1) {
    return null;
  }

  const [removed] =
    guildData.orders.splice(index, 1);

  saveRestrainingOrdersData();
  return removed;
}

function restrainingOrderDurationText(order) {
  if (order.expiresAt === null) {
    return "לצמיתות";
  }

  const remaining =
    Number(order.expiresAt) - Date.now();

  if (remaining <= 0) {
    return "הסתיים";
  }

  const timestamp =
    Math.floor(
      Number(order.expiresAt) / 1000
    );

  return (
    `${formatDuration(remaining)} ` +
    `(<t:${timestamp}:R>)`
  );
}

function activeRestrainingOrdersForUser(
  guildId,
  userId
) {
  const guildData =
    getGuildRestrainingOrders(guildId);

  return guildData.orders.filter(
    order =>
      isRestrainingOrderActive(order) &&
      (
        order.user1Id === userId ||
        order.user2Id === userId
      )
  );
}

async function checkRestrainingOrders() {
  const now = Date.now();
  let changed = false;
  const expired = [];

  for (
    const [
      guildId,
      guildData
    ] of Object.entries(
      restrainingOrdersData.guilds
    )
  ) {
    if (!Array.isArray(guildData.orders)) {
      guildData.orders = [];
      changed = true;
      continue;
    }

    const keep = [];

    for (const order of guildData.orders) {
      if (
        order.expiresAt !== null &&
        Number(order.expiresAt) <= now
      ) {
        expired.push({
          guildId,
          order
        });
        changed = true;
      } else {
        keep.push(order);
      }
    }

    guildData.orders = keep;
  }

  if (changed) {
    saveRestrainingOrdersData();
  }

  for (const item of expired) {
    const guild =
      client.guilds.cache.get(
        item.guildId
      );

    if (!guild) continue;

    await sendModLog(
      guild,
      buildModEmbed(
        "✅ Restraining Order הסתיים",
        "Green",
        [
          {
            name: "Order ID",
            value: item.order.id
          },
          {
            name: "בין",
            value:
              `<@${item.order.user1Id}> ↔ ` +
              `<@${item.order.user2Id}>`
          },
          {
            name: "סיבה מקורית",
            value:
              item.order.reason ||
              "לא צוינה סיבה"
          }
        ]
      )
    );
  }
}

async function enforceRestrainingOrder(
  guild,
  order
) {
  if (
    !guild ||
    !isRestrainingOrderActive(order)
  ) {
    return {
      triggered: false,
      disconnected: []
    };
  }

  const member1 =
    await guild.members
      .fetch(order.user1Id)
      .catch(() => null);

  const member2 =
    await guild.members
      .fetch(order.user2Id)
      .catch(() => null);

  if (!member1 || !member2) {
    return {
      triggered: false,
      disconnected: []
    };
  }

  const channelId1 =
    member1.voice.channelId;

  const channelId2 =
    member2.voice.channelId;

  if (
    !channelId1 ||
    !channelId2 ||
    channelId1 !== channelId2
  ) {
    return {
      triggered: false,
      disconnected: []
    };
  }

  const lockKey =
    `${guild.id}:${order.id}:${channelId1}`;

  if (
    restrainingDisconnectLocks.has(
      lockKey
    )
  ) {
    return {
      triggered: false,
      disconnected: []
    };
  }

  restrainingDisconnectLocks.add(lockKey);

  try {
    const botMember =
      await guild.members
        .fetchMe()
        .catch(() => null);

    if (
      !botMember ||
      !botMember.permissions.has(
        PermissionFlagsBits.MoveMembers
      )
    ) {
      console.error(
        "❌ Restraining Order requires Move Members."
      );

      return {
        triggered: true,
        disconnected: [],
        permissionMissing: true
      };
    }

    const results =
      await Promise.allSettled([
        member1.voice.disconnect(
          `Restraining Order ${order.id}`
        ),
        member2.voice.disconnect(
          `Restraining Order ${order.id}`
        )
      ]);

    const disconnected = [];

    if (results[0].status === "fulfilled") {
      disconnected.push(member1.id);
    }

    if (results[1].status === "fulfilled") {
      disconnected.push(member2.id);
    }

    await sendModLog(
      guild,
      buildModEmbed(
        "🚫 Restraining Order הופעל",
        "Red",
        [
          {
            name: "Order ID",
            value: order.id
          },
          {
            name: "בין",
            value:
              `${member1} ↔ ${member2}`
          },
          {
            name: "Voice Channel",
            value: `<#${channelId1}>`
          },
          {
            name: "תוצאה",
            value:
              disconnected.length === 2
                ? "שני המשתמשים נותקו."
                : (
                    disconnected.length === 1
                      ? "רק משתמש אחד נותק."
                      : "לא הצלחתי לנתק את המשתמשים."
                  )
          }
        ]
      )
    );

    return {
      triggered: true,
      disconnected
    };
  } finally {
    setTimeout(() => {
      restrainingDisconnectLocks.delete(
        lockKey
      );
    }, 1500);
  }
}

async function enforceRestrainingOrdersForUser(
  guild,
  userId
) {
  const orders =
    activeRestrainingOrdersForUser(
      guild.id,
      userId
    );

  for (const order of orders) {
    await enforceRestrainingOrder(
      guild,
      order
    );
  }
}

async function enforceAllRestrainingOrders() {
  for (
    const [
      guildId,
      guildData
    ] of Object.entries(
      restrainingOrdersData.guilds
    )
  ) {
    const guild =
      client.guilds.cache.get(guildId);

    if (!guild) continue;

    for (
      const order of
      (guildData.orders || [])
    ) {
      if (
        isRestrainingOrderActive(order)
      ) {
        await enforceRestrainingOrder(
          guild,
          order
        );
      }
    }
  }
}


// =====================
// XP + SHOP + PREFIX GAMES
// =====================

const casinoCooldowns = new Map();

function getXpProfile(userId) {
  if (!xpData.users[userId]) {
    xpData.users[userId] = {
      xp: 0,
      messages: 0,
      lastXpAt: 0
    };
  }

  return xpData.users[userId];
}

function saveXpData() {
  saveJson(XP_FILE, xpData);
}

function formatXp(amount) {
  return Number(amount || 0).toLocaleString("en-US");
}

function getXpPosition(userId, field = "xp") {
  const sorted = Object.entries(
    xpData.users || {}
  )
    .map(([id, profile]) => ({
      id,
      value: Number(profile?.[field] || 0)
    }))
    .sort((a, b) => b.value - a.value);

  const position =
    sorted.findIndex(
      item => item.id === userId
    );

  return position === -1
    ? sorted.length + 1
    : position + 1;
}

function getRankLevelInfo(xp) {
  const safeXp =
    Math.max(0, Number(xp || 0));

  const xpPerLevel = 500;
  const level =
    Math.floor(safeXp / xpPerLevel) + 1;

  const xpIntoLevel =
    safeXp % xpPerLevel;

  const progress =
    Math.floor(
      (xpIntoLevel / xpPerLevel) * 100
    );

  const xpToNext =
    xpPerLevel - xpIntoLevel;

  return {
    level,
    progress,
    xpToNext,
    xpPerLevel
  };
}

function buildRankEmbed(
  guild,
  member
) {
  const profile =
    getXpProfile(member.id);

  const xp =
    Number(profile.xp || 0);

  const messages =
    Number(profile.messages || 0);

  const xpPosition =
    getXpPosition(member.id, "xp");

  const messagePosition =
    getXpPosition(member.id, "messages");

  const levelInfo =
    getRankLevelInfo(xp);

  const warnCount =
    getUserWarnings(
      guild.id,
      member.id
    ).warns.length;

  const restrainingCount =
    activeRestrainingOrdersForUser(
      guild.id,
      member.id
    ).length;

  const roleCount =
    member.roles.cache.filter(
      role => role.id !== guild.id
    ).size;

  const weeklyVoiceTime =
    formatWeeklyVoiceTime(
      getWeeklyVoiceTimeMs(
        guild.id,
        member.id
      )
    );

  const topText = [
    `**#${xpPosition} ${member.displayName}** 💎 **${levelInfo.level}**`,
    "",
    `Total XP: **${formatXp(xp)}** (#${xpPosition})`,
    `Next Level: **${levelInfo.progress}%**`,
    `XP needed: **${formatXp(levelInfo.xpToNext)}**`
  ].join("\n");

  const statsText = [
    `💬 **${formatXp(messages)}** (#${messagePosition})`,
    `🎙️ **${weeklyVoiceTime}** Voice This Week`,
    `⚠️ **${warnCount}** Warns`,
    `🚫 **${restrainingCount}** Active Orders`,
    `🎭 **${roleCount}** Roles`
  ].join("\n");

  return new EmbedBuilder()
    .setColor("Aqua")
    .setTitle("All stats in Zone X")
    .setThumbnail(
      member.user.displayAvatarURL({
        size: 256
      })
    )
    .setDescription(topText)
    .addFields({
      name: "Stats",
      value: statsText,
      inline: false
    })
    .setFooter({
      text:
        `Zone X • Rank • ${member.user.username}`
    })
    .setTimestamp();
}

function getShopItems() {
  return Array.isArray(config.xpShop)
    ? config.xpShop.filter(item =>
        item &&
        item.key &&
        item.name &&
        item.roleId &&
        Number.isFinite(Number(item.price)) &&
        Number(item.price) > 0
      )
    : [];
}

function findShopItem(key) {
  const normalized = String(key || "")
    .trim()
    .toLowerCase();

  return getShopItems().find(
    item => String(item.key).toLowerCase() === normalized
  );
}

function parseXpAmount(value) {
  const amount = Number(String(value || "").replace(/,/g, ""));

  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  return amount;
}

function getMaxCasinoBet() {
  const configured = Number(config.maxCasinoBet);

  if (
    Number.isInteger(configured) &&
    configured > 0
  ) {
    return configured;
  }

  return 1000;
}

function getCasinoCooldownMs() {
  const configured = Number(config.casinoCooldownMs);

  if (
    Number.isInteger(configured) &&
    configured >= 1000
  ) {
    return configured;
  }

  return 5000;
}

function checkCasinoCooldown(userId) {
  const now = Date.now();
  const expiresAt = casinoCooldowns.get(userId) || 0;

  if (expiresAt > now) {
    return expiresAt - now;
  }

  casinoCooldowns.set(
    userId,
    now + getCasinoCooldownMs()
  );

  return 0;
}

function validateBet(userId, rawAmount) {
  const amount = parseXpAmount(rawAmount);

  if (!amount) {
    return {
      ok: false,
      message:
        "❌ סכום לא תקין. לדוגמה: `!coinflip 100 heads`"
    };
  }

  const profile = getXpProfile(userId);
  const maxBet = getMaxCasinoBet();

  if (amount > maxBet) {
    return {
      ok: false,
      message:
        `❌ ההימור המקסימלי הוא **${formatXp(maxBet)} XP**.`
    };
  }

  if (profile.xp < amount) {
    return {
      ok: false,
      message:
        `❌ אין לך מספיק XP. יש לך **${formatXp(profile.xp)} XP**.`
    };
  }

  return {
    ok: true,
    amount,
    profile
  };
}

function buildHelpRequestEmbed(
  user,
  reason,
  requestId,
  handler = null
) {
  return new EmbedBuilder()
    .setColor(handler ? "Green" : "DarkGreen")
    .setTitle("🚨 בקשת עזרה חדשה")
    .addFields(
      {
        name: "משתמש:",
        value: `${user}`,
        inline: false
      },
      {
        name: "סיבה:",
        value: reason || "לא צוינה סיבה",
        inline: false
      },
      {
        name: "סטטוס:",
        value: handler
          ? "✅ נמצא בטיפול"
          : "❌ לא נמצא בטיפול",
        inline: false
      },
      {
        name: "סטטוס טיפול:",
        value: handler
          ? `✅ בטיפול על ידי ${handler}`
          : "❌ אף אחד",
        inline: false
      }
    )
    .setFooter({
      text: `ID: ${requestId}`
    })
    .setTimestamp();
}

function buildXpHelpEmbed() {
  return new EmbedBuilder()
    .setColor("Blue")
    .setTitle("🎮 Zone X XP")
    .setDescription(
      [
        "כל המערכת משתמשת ב־**XP וירטואלי של השרת בלבד**.",
        "",
        "**XP & Shop**",
        "`!xp` — מציג את כמות ה־XP שלך",
        "החנות נשלחת על ידי הצוות עם `/setup-xp-shop`.",
        "קניית רולים מתבצעת רק דרך הכפתורים בפאנל.",
        "",
        "**משחקי מזל — Prefix בלבד**",
        "`!coinflip <xp> <heads/tails>`",
        "`!dice <xp> <1-6>`",
        "`!slots <xp>`",
        "",
        "**Staff**",
        "`!addxp @user <amount>`",
        "`!removexp @user <amount>`",
        "`!setxp @user <amount>`"
      ].join("\n")
    )
    .setFooter({
      text:
        `מקסימום למשחק: ${formatXp(getMaxCasinoBet())} XP`
    });
}

function buildXpShopPanel() {
  const items = getShopItems().slice(0, 25);

  if (!items.length) {
    return null;
  }

  const lines = items.map(item => {
    const emoji = item.emoji || "🎁";

    return (
      `${emoji} **${item.name}** — ` +
      `**${formatXp(item.price)} XP**\n` +
      `רול: <@&${item.roleId}>`
    );
  });

  const embed = new EmbedBuilder()
    .setColor("Blue")
    .setTitle("🛒 Zone X XP Shop")
    .setDescription(
      "לחצו על הכפתור של הרול שאתם רוצים לקנות.\n" +
      "אם יש לכם מספיק XP, המחיר ירד אוטומטית והרול יינתן לכם.\n\n" +
      lines.join("\n\n")
    )
    .setFooter({
      text: "Zone X • XP Shop"
    });

  const rows = [];

  for (let i = 0; i < items.length; i += 5) {
    const row = new ActionRowBuilder();

    for (const item of items.slice(i, i + 5)) {
      const button = new ButtonBuilder()
        .setCustomId(
          `xp_shop_buy:${String(item.key).slice(0, 80)}`
        )
        .setLabel(
          `${String(item.name).slice(0, 50)} • ${formatXp(item.price)} XP`
        )
        .setStyle(ButtonStyle.Primary);

      if (item.emoji) {
        button.setEmoji(item.emoji);
      }

      row.addComponents(button);
    }

    rows.push(row);
  }

  return {
    embeds: [embed],
    components: rows,
    allowedMentions: {
      roles: []
    }
  };
}

const xpPurchaseLocks = new Set();

async function buyXpRoleFromButton(interaction, itemKey) {
  if (xpPurchaseLocks.has(interaction.user.id)) {
    return interaction.reply({
      content: "⏳ יש לך כבר רכישה שמתבצעת. נסה שוב בעוד רגע.",
      ephemeral: true
    });
  }

  xpPurchaseLocks.add(interaction.user.id);

  try {
    await interaction.deferReply({
      ephemeral: true
    });

    const item = findShopItem(itemKey);

    if (!item) {
      return interaction.editReply({
        content:
          "❌ הפריט הזה כבר לא קיים בחנות. בקש מהצוות לשלוח פאנל חדש."
      });
    }

    const member = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);

    if (!member) {
      return interaction.editReply({
        content: "❌ לא הצלחתי למצוא אותך בשרת."
      });
    }

    if (member.roles.cache.has(item.roleId)) {
      return interaction.editReply({
        content:
          `❌ כבר יש לך את הרול **${item.name}**. לא ירד לך XP.`
      });
    }

    const role = await interaction.guild.roles
      .fetch(item.roleId)
      .catch(() => null);

    if (!role) {
      return interaction.editReply({
        content:
          `❌ הרול **${item.name}** לא נמצא. לא ירד לך XP.`
      });
    }

    const botMember = await interaction.guild.members
      .fetchMe()
      .catch(() => null);

    if (
      !botMember?.permissions.has(
        PermissionFlagsBits.ManageRoles
      )
    ) {
      return interaction.editReply({
        content:
          "❌ לבוט אין `Manage Roles`. לא ירד לך XP."
      });
    }

    if (
      role.managed ||
      role.position >= botMember.roles.highest.position
    ) {
      return interaction.editReply({
        content:
          "❌ הבוט לא יכול לתת את הרול הזה. שים את רול הבוט מעל רולי החנות. לא ירד לך XP."
      });
    }

    const profile = getXpProfile(interaction.user.id);
    const price = Number(item.price);

    if (profile.xp < price) {
      return interaction.editReply({
        content:
          `❌ אין לך מספיק XP בשביל **${item.name}**.\n` +
          `מחיר: **${formatXp(price)} XP**\n` +
          `יש לך: **${formatXp(profile.xp)} XP**`
      });
    }

    try {
      await member.roles.add(
        role,
        `Zone X XP Shop purchase by ${interaction.user.tag}`
      );
    } catch (error) {
      console.error("❌ XP shop button role add error:", error);

      return interaction.editReply({
        content:
          "❌ לא הצלחתי לתת את הרול ולכן לא ירד לך XP."
      });
    }

    profile.xp -= price;
    saveXpData();

    return interaction.editReply({
      content:
        `✅ קנית את **${item.name}** ב־**${formatXp(price)} XP**!\n` +
        `🎭 קיבלת את הרול ${role}.\n` +
        `💰 נשארו לך **${formatXp(profile.xp)} XP**.`
    });
  } finally {
    xpPurchaseLocks.delete(interaction.user.id);
  }
}

function awardMessageXp(message) {
  const profile = getXpProfile(message.author.id);
  const now = Date.now();

  const cooldownMs = Math.max(
    10_000,
    Number(config.xpMessageCooldownMs) || 60_000
  );

  if (now - profile.lastXpAt < cooldownMs) {
    return 0;
  }

  const min = Math.max(
    1,
    Number(config.xpPerMessageMin) || 5
  );

  const max = Math.max(
    min,
    Number(config.xpPerMessageMax) || 15
  );

  const gained =
    Math.floor(Math.random() * (max - min + 1)) + min;

  profile.xp += gained;
  profile.messages += 1;
  profile.lastXpAt = now;

  saveXpData();
  return gained;
}

function isXpStaff(member) {
  return isStaff(member);
}

async function handleStaffXpCommand(
  message,
  command,
  args
) {
  if (!isXpStaff(message.member)) {
    return message.reply(
      "❌ הפקודה הזאת מיועדת לצוות בלבד."
    );
  }

  const target =
    message.mentions.users.first();

  const amount = parseXpAmount(
    args.find(arg => /^\d[\d,]*$/.test(arg))
  );

  if (!target || !amount) {
    return message.reply(
      `❌ שימוש: \`!${command} @user <amount>\``
    );
  }

  const profile = getXpProfile(target.id);

  if (command === "addxp") {
    profile.xp += amount;
  }

  if (command === "removexp") {
    profile.xp = Math.max(0, profile.xp - amount);
  }

  if (command === "setxp") {
    profile.xp = amount;
  }

  saveXpData();

  return message.reply(
    `✅ ל־${target} יש עכשיו **${formatXp(profile.xp)} XP**.`
  );
}

async function playCoinflip(message, args) {
  const cooldown = checkCasinoCooldown(
    message.author.id
  );

  if (cooldown > 0) {
    return message.reply(
      `⏳ חכה עוד **${Math.ceil(cooldown / 1000)} שניות** לפני משחק נוסף.`
    );
  }

  const validation = validateBet(
    message.author.id,
    args[0]
  );

  if (!validation.ok) {
    return message.reply(validation.message);
  }

  const choice = String(args[1] || "")
    .toLowerCase();

  const aliases = {
    h: "heads",
    head: "heads",
    heads: "heads",
    עץ: "heads",
    t: "tails",
    tail: "tails",
    tails: "tails",
    פלי: "tails"
  };

  const picked = aliases[choice];

  if (!picked) {
    return message.reply(
      "❌ בחר `heads` או `tails`.\nלדוגמה: `!coinflip 100 heads`"
    );
  }

  const { amount, profile } = validation;
  profile.xp -= amount;

  const result =
    Math.random() < 0.5 ? "heads" : "tails";

  const won = picked === result;

  if (won) {
    profile.xp += amount * 2;
  }

  saveXpData();

  return message.reply(
    `${result === "heads" ? "🪙 Heads" : "🪙 Tails"}\n` +
    (
      won
        ? `✅ ניצחת **${formatXp(amount)} XP**!`
        : `❌ הפסדת **${formatXp(amount)} XP**.`
    ) +
    `\n💰 יתרה: **${formatXp(profile.xp)} XP**`
  );
}

async function playDice(message, args) {
  const cooldown = checkCasinoCooldown(
    message.author.id
  );

  if (cooldown > 0) {
    return message.reply(
      `⏳ חכה עוד **${Math.ceil(cooldown / 1000)} שניות** לפני משחק נוסף.`
    );
  }

  const validation = validateBet(
    message.author.id,
    args[0]
  );

  if (!validation.ok) {
    return message.reply(validation.message);
  }

  const picked = Number(args[1]);

  if (
    !Number.isInteger(picked) ||
    picked < 1 ||
    picked > 6
  ) {
    return message.reply(
      "❌ בחר מספר בין `1` ל־`6`.\nלדוגמה: `!dice 100 4`"
    );
  }

  const { amount, profile } = validation;
  profile.xp -= amount;

  const rolled =
    Math.floor(Math.random() * 6) + 1;

  const won = rolled === picked;

  // 1-in-6 chance, 6x total return when correct.
  if (won) {
    profile.xp += amount * 6;
  }

  saveXpData();

  return message.reply(
    `🎲 יצא **${rolled}**\n` +
    (
      won
        ? `✅ פגעת במספר! זכית ב־**${formatXp(amount * 5)} XP נטו**.`
        : `❌ לא פגעת. הפסדת **${formatXp(amount)} XP**.`
    ) +
    `\n💰 יתרה: **${formatXp(profile.xp)} XP**`
  );
}

async function playSlots(message, args) {
  const cooldown = checkCasinoCooldown(
    message.author.id
  );

  if (cooldown > 0) {
    return message.reply(
      `⏳ חכה עוד **${Math.ceil(cooldown / 1000)} שניות** לפני משחק נוסף.`
    );
  }

  const validation = validateBet(
    message.author.id,
    args[0]
  );

  if (!validation.ok) {
    return message.reply(validation.message);
  }

  const { amount, profile } = validation;
  profile.xp -= amount;

  const symbols = [
    "🍒",
    "🍋",
    "🍇",
    "🔔",
    "⭐",
    "💎"
  ];

  const spin = [
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)]
  ];

  const counts = {};
  for (const symbol of spin) {
    counts[symbol] = (counts[symbol] || 0) + 1;
  }

  const maxSame = Math.max(...Object.values(counts));
  let payout = 0;
  let resultText = "";

  if (maxSame === 3) {
    payout = amount * 6;
    resultText =
      `💎 שלישייה! זכית ב־**${formatXp(amount * 5)} XP נטו**.`;
  } else if (maxSame === 2) {
    payout = amount * 2;
    resultText =
      `✅ זוג! זכית ב־**${formatXp(amount)} XP נטו**.`;
  } else {
    resultText =
      `❌ אין התאמה. הפסדת **${formatXp(amount)} XP**.`;
  }

  profile.xp += payout;
  saveXpData();

  return message.reply(
    `🎰 | ${spin.join(" | ")} |\n` +
    `${resultText}\n` +
    `💰 יתרה: **${formatXp(profile.xp)} XP**`
  );
}

client.on(Events.MessageCreate, async message => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    if (await handleAntiLink(message)) {
      return;
    }

    const prefix = String(
      config.xpPrefix || "!"
    );

    const content = String(
      message.content || ""
    ).trim();

    // Prefix commands do not earn message XP.
    if (!content.startsWith(prefix)) {
      awardMessageXp(message);
      return;
    }

    const withoutPrefix =
      content.slice(prefix.length).trim();

    if (!withoutPrefix) return;

    const parts = withoutPrefix.split(/\s+/);
    const command = String(parts.shift() || "")
      .toLowerCase();
    const args = parts;

    if (
      [
        "h",
        "xphelp",
        "xp",
        "balance",
        "coinflip",
        "cf",
        "dice",
        "slots",
        "addxp",
        "removexp",
        "setxp"
      ].includes(command) === false
    ) {
      return;
    }

    if (command === "h") {
      const reason =
        args.join(" ").trim() ||
        "לא צוינה סיבה";

      const requestId =
        Date.now().toString();

      const row =
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(
              `take_help_request:${message.author.id}:${requestId}`
            )
            .setLabel("בטיפול")
            .setStyle(ButtonStyle.Primary)
        );

      return message.channel.send({
        content:
          config.staffRoleId
            ? `<@&${config.staffRoleId}>`
            : undefined,
        embeds: [
          buildHelpRequestEmbed(
            message.author,
            reason,
            requestId
          )
        ],
        components: [row],
        allowedMentions:
          config.staffRoleId
            ? {
                roles: [config.staffRoleId]
              }
            : undefined
      });
    }

    if (command === "xphelp") {
      return message.reply({
        embeds: [buildXpHelpEmbed()]
      });
    }

    if (
      command === "xp" ||
      command === "balance"
    ) {
      const profile =
        getXpProfile(message.author.id);

      return message.reply(
        `💰 יש לך **${formatXp(profile.xp)} XP**.`
      );
    }

    if (
      command === "addxp" ||
      command === "removexp" ||
      command === "setxp"
    ) {
      return handleStaffXpCommand(
        message,
        command,
        args
      );
    }

    if (
      command === "coinflip" ||
      command === "cf"
    ) {
      return playCoinflip(message, args);
    }

    if (command === "dice") {
      return playDice(message, args);
    }

    if (command === "slots") {
      return playSlots(message, args);
    }
  } catch (error) {
    console.error("❌ MessageCreate handler error:", error);

    return message.reply(
      "❌ הייתה שגיאה במערכת ה־XP."
    ).catch(() => {});
  }
});


async function checkModTimers() {
  const now = Date.now();
  let changed = false;

  for (const [key, timer] of Object.entries(modTimers)) {
    if (!timer || timer.expiresAt > now) continue;

    try {
      const guild = client.guilds.cache.get(timer.guildId);

      if (!guild) {
        delete modTimers[key];
        changed = true;
        continue;
      }

      const member = await guild.members
        .fetch(timer.userId)
        .catch(() => null);

      if (timer.type === "chat-mute") {
        const muteRole = config.muteRoleId
          ? await guild.roles.fetch(config.muteRoleId).catch(() => null)
          : null;

        if (member && muteRole && member.roles.cache.has(muteRole.id)) {
          await member.roles.remove(
            muteRole,
            "Zone X automatic mute expiration"
          ).catch(error => {
            console.error("❌ Auto unmute error:", error);
          });

          await sendModLog(
            guild,
            buildModEmbed(
              "🔊 Chat Mute הסתיים אוטומטית",
              "Green",
              [
                { name: "משתמש", value: `<@${timer.userId}>` },
                {
                  name: "סיבה מקורית",
                  value: timer.reason || "לא צוינה סיבה"
                }
              ]
            )
          );
        }
      } else if (timer.type === "voice-mute") {
        if (
          member &&
          member.voice.channelId &&
          member.voice.serverMute
        ) {
          await member.voice.setMute(
            false,
            "Zone X automatic voice mute expiration"
          ).catch(error => {
            console.error(
              "❌ Auto voice unmute error:",
              error
            );
          });

          await sendModLog(
            guild,
            buildModEmbed(
              "🔊 Voice Mute הסתיים אוטומטית",
              "Green",
              [
                {
                  name: "משתמש",
                  value: `<@${timer.userId}>`
                },
                {
                  name: "סיבה מקורית",
                  value:
                    timer.reason ||
                    "לא צוינה סיבה"
                }
              ]
            )
          );
        }
      }

      delete modTimers[key];
      changed = true;
    } catch (error) {
      console.error("❌ Timer processing error:", error);
    }
  }

  if (changed) {
    saveJson(MOD_TIMERS_FILE, modTimers);
  }
}

// =====================
// VERIFY — SAME STYLE AS SALES BOT
// =====================

async function sendVerifyPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor("Blue")
    .setTitle("Verify ✅")
    .setDescription(
      "לחץ על הכפתור, תקבל מספר, ואז תלחץ על המספר הנכון."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("start_verify")
      .setLabel("Verify")
      .setStyle(ButtonStyle.Success)
  );

  return channel.send({ embeds: [embed], components: [row] });
}


// =====================
// TICKETS
// =====================

const TICKET_PANEL_IMAGE = path.join(
  __dirname,
  "assets",
  "zone-x-server.webp"
);

const TICKET_TYPES = {
  general_question: {
    name: "שאלה כללית",
    emoji: "❓",
    access: "regular"
  },
  complaint: {
    name: "תלונה על ממבר/חבר צוות",
    emoji: "⚠️",
    access: "regular"
  },
  bug_report: {
    name: "דיווח על באג בשרת",
    emoji: "🛠️",
    access: "regular"
  },
  partnership: {
    name: "שיתוף פעולה",
    emoji: "🤝",
    access: "regular"
  },
  staff_test: {
    name: "בחינה לצוות",
    emoji: "📝",
    access: "staff_test"
  }
};

function hasTicketConfig() {
  return Boolean(
    config.ticketCategoryId &&
    config.ticketStaffRoleId &&
    config.staffTestTicketRoleId &&
    config.ticketLogsChannelId
  );
}

function getTicketAccessRoleIdByType(ticketType) {
  return ticketType?.access === "staff_test"
    ? config.staffTestTicketRoleId
    : config.ticketStaffRoleId;
}

function getTicketAccessRoleIdFromChannel(channel) {
  const ticketKey =
    channel.topic?.match(/ticketKey:([^|]+)/)?.[1]?.trim();

  const ticketType = ticketKey
    ? TICKET_TYPES[ticketKey]
    : null;

  return getTicketAccessRoleIdByType(ticketType);
}

function isTicketStaff(member, channel = null) {
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const requiredRoleId = channel
    ? getTicketAccessRoleIdFromChannel(channel)
    : config.ticketStaffRoleId;

  return Boolean(
    requiredRoleId &&
    member?.roles?.cache?.has(requiredRoleId)
  );
}

function getTicketOwner(channel) {
  return (
    channel.topic?.match(/ticketOwner:(\d{17,20})/)?.[1] ||
    null
  );
}

function getTicketClaimedBy(channel) {
  return (
    channel.topic?.match(/claimedBy:(\d{17,20})/)?.[1] ||
    null
  );
}

function getTicketType(channel) {
  return (
    channel.topic?.match(/ticketType:([^|]+)/)?.[1]?.trim() ||
    "לא ידוע"
  );
}

async function setTicketClaimedBy(channel, userId = null) {
  const currentTopic = channel.topic || "";

  const cleanedTopic = currentTopic
    .replace(/\s*\|\s*claimedBy:\d{17,20}/g, "")
    .trim();

  const newTopic = userId
    ? `${cleanedTopic} | claimedBy:${userId}`.slice(0, 1024)
    : cleanedTopic.slice(0, 1024);

  await channel.setTopic(newTopic).catch(() => {});
}

function buildTicketButtons(claimedById = null) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("zone_ticket_claim")
      .setLabel("Claim")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(claimedById)),

    new ButtonBuilder()
      .setCustomId("zone_ticket_release")
      .setLabel("Release")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!claimedById),

    new ButtonBuilder()
      .setCustomId("zone_ticket_add_user")
      .setLabel("Add User")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!claimedById),

    new ButtonBuilder()
      .setCustomId("zone_ticket_remove_user")
      .setLabel("Remove User")
      .setEmoji("➖")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!claimedById),

    new ButtonBuilder()
      .setCustomId("zone_ticket_close")
      .setLabel("Close")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

async function sendTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor("Blue")
    .setTitle("🎟️ מערכת פניות (טיקטים)")
    .setDescription(
      "בחרו את סוג הפנייה שלכם מהתפריט למטה כדי לפתוח טיקט מול צוות השרת.\n" +
      "אנא פתחו טיקט רק במידת הצורך."
    );

  const files = [];

  if (fs.existsSync(TICKET_PANEL_IMAGE)) {
    embed.setThumbnail("attachment://zone-x-server.webp");

    files.push(
      new AttachmentBuilder(TICKET_PANEL_IMAGE, {
        name: "zone-x-server.webp"
      })
    );
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("zone_ticket_type_select")
      .setPlaceholder("בחר את נושא הפנייה...")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("שאלה כללית")
          .setEmoji("❓")
          .setValue("general_question"),

        new StringSelectMenuOptionBuilder()
          .setLabel("תלונה על ממבר/חבר צוות")
          .setEmoji("⚠️")
          .setValue("complaint"),

        new StringSelectMenuOptionBuilder()
          .setLabel("דיווח על באג בשרת")
          .setEmoji("🛠️")
          .setValue("bug_report"),

        new StringSelectMenuOptionBuilder()
          .setLabel("שיתוף פעולה")
          .setEmoji("🤝")
          .setValue("partnership"),

        new StringSelectMenuOptionBuilder()
          .setLabel("בחינה לצוות")
          .setEmoji("📝")
          .setValue("staff_test")
      )
  );

  return channel.send({
    embeds: [embed],
    components: [row],
    files
  });
}

async function createTicketTranscript(channel) {
  const messages = await channel.messages.fetch({
    limit: 100
  });

  const sorted = [...messages.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  let transcript = `Zone X Ticket Transcript\n`;
  transcript += `Channel: #${channel.name}\n`;
  transcript += `Channel ID: ${channel.id}\n`;
  transcript += `Ticket Type: ${getTicketType(channel)}\n`;
  transcript += `Owner ID: ${getTicketOwner(channel) || "unknown"}\n`;
  transcript += `Created: ${new Date().toLocaleString("he-IL")}\n\n`;

  for (const message of sorted) {
    transcript +=
      `[${message.createdAt.toLocaleString("he-IL")}] ` +
      `${message.author.tag}: ` +
      `${message.content || "[בלי טקסט]"}\n`;

    message.attachments.forEach(attachment => {
      transcript += `Attachment: ${attachment.url}\n`;
    });
  }

  return new AttachmentBuilder(
    Buffer.from(transcript, "utf8"),
    {
      name: `${channel.name}-transcript.txt`
    }
  );
}

async function openTicket(interaction, ticketData) {
  if (!hasTicketConfig()) {
    return interaction.reply({
      content:
        "❌ חסרים IDs של מערכת הטיקטים ב־config.js.",
      ephemeral: true
    });
  }

  const existingChannel =
    interaction.guild.channels.cache.find(channel =>
      channel.topic?.includes(
        `ticketOwner:${interaction.user.id}`
      )
    );

  if (existingChannel) {
    return interaction.reply({
      content:
        `❌ כבר יש לך טיקט פתוח: ${existingChannel}`,
      ephemeral: true
    });
  }

  const safeName = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9א-ת]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 22);

  const ticketAccessRoleId =
    getTicketAccessRoleIdByType(ticketData);

  if (!ticketAccessRoleId) {
    return interaction.reply({
      content:
        "❌ לא הוגדר רול מתאים לסוג הטיקט הזה ב־config.js.",
      ephemeral: true
    });
  }

  const ticketKey = Object.entries(TICKET_TYPES)
    .find(([, data]) => data === ticketData)?.[0];

  const ticketChannel =
    await interaction.guild.channels.create({
      name: `ticket-${safeName || interaction.user.id}`,
      type: ChannelType.GuildText,
      parent: config.ticketCategoryId,
      topic:
        `ticketOwner:${interaction.user.id} | ` +
        `ticketType:${ticketData.name} | ` +
        `ticketKey:${ticketKey}`,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: ticketAccessRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        }
      ]
    });

  const ticketEmbed = new EmbedBuilder()
    .setColor("Blue")
    .setTitle(`${ticketData.emoji} טיקט חדש`)
    .setDescription(
      `👤 משתמש: ${interaction.user}\n` +
      `📌 נושא: **${ticketData.name}**\n\n` +
      "צוות השרת יענה בהקדם האפשרי."
    )
    .setTimestamp();

  await ticketChannel.send({
    content:
      `<@${interaction.user.id}> <@&${ticketAccessRoleId}>`,
    embeds: [ticketEmbed],
    components: [buildTicketButtons()],
    allowedMentions: {
      users: [interaction.user.id],
      roles: [ticketAccessRoleId]
    }
  });

  return interaction.reply({
    content: `✅ הטיקט שלך נפתח: ${ticketChannel}`,
    ephemeral: true
  });
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`✅ Zone X logged in as ${readyClient.user.tag}`);
  console.log("🎟️ Zone X ticket system loaded");
  console.log("🎮 Zone X XP + Shop loaded");

  await checkModTimers();
  await checkRestrainingOrders();
  await enforceAllRestrainingOrders();

  initializeActiveVoiceSessions();

  setInterval(() => {
    checkModTimers().catch(error => {
      console.error("❌ Mod timer interval error:", error);
    });

    checkRestrainingOrders().catch(error => {
      console.error(
        "❌ Restraining Order interval error:",
        error
      );
    });
  }, 10 * 1000);

  setInterval(() => {
    try {
      flushActiveVoiceSessions();
    } catch (error) {
      console.error(
        "❌ Voice time save interval error:",
        error
      );
    }
  }, 60 * 1000);
});

async function replyToInteraction(interaction, payload) {
  const data =
    typeof payload === "string"
      ? { content: payload }
      : { ...payload };

  // ephemeral is decided by deferReply and cannot be changed in editReply.
  if (interaction.deferred) {
    delete data.ephemeral;
    return interaction.editReply(data);
  }

  if (interaction.replied) {
    return interaction.followUp(data);
  }

  return interaction.reply(data);
}

client.on(
  Events.VoiceStateUpdate,
  async (oldState, newState) => {
    try {
      handleVoiceTimeStateChange(
        oldState,
        newState
      );

      if (
        oldState.channelId ===
        newState.channelId
      ) {
        return;
      }

      if (!newState.channelId) {
        return;
      }

      await enforceRestrainingOrdersForUser(
        newState.guild,
        newState.id
      );
    } catch (error) {
      console.error(
        "❌ Voice state handler error:",
        error
      );
    }
  }
);

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      // Discord requires slash commands to be acknowledged quickly.
      // /rank is public when used by Staff; all other slash replies stay private.
      const publicRank =
        interaction.commandName === "rank" &&
        isStaff(interaction.member);

      await interaction.deferReply({
        ephemeral: !publicRank
      });

      if (interaction.commandName === "ping") {
        return replyToInteraction(interaction, {
          content: `🏓 Pong! ${client.ws.ping}ms`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "verify-panel") {
        if (
          !interaction.member.permissions.has(
            PermissionFlagsBits.ManageGuild
          )
        ) {
          return replyToInteraction(interaction, {
            content: "❌ אין לך גישה לשלוח פאנל Verify.",
            ephemeral: true
          });
        }

        await sendVerifyPanel(interaction.channel);

        return replyToInteraction(interaction, {
          content: "✅ פאנל ה־Verify נשלח.",
          ephemeral: true
        });
      }

      if (interaction.commandName === "ticket-panel") {
        if (
          !interaction.member.permissions.has(
            PermissionFlagsBits.ManageGuild
          )
        ) {
          return replyToInteraction(interaction, {
            content:
              "❌ אין לך גישה לשלוח פאנל טיקטים.",
            ephemeral: true
          });
        }

        if (!hasTicketConfig()) {
          return replyToInteraction(interaction, {
            content:
              "❌ חסרים ticketCategoryId / ticketStaffRoleId / staffTestTicketRoleId / ticketLogsChannelId ב־config.js.",
            ephemeral: true
          });
        }

        if (!interaction.channel?.isTextBased()) {
          return replyToInteraction(interaction, {
            content:
              "❌ אפשר לשלוח את פאנל הטיקטים רק בחדר טקסט.",
            ephemeral: true
          });
        }

        const botMember =
          await interaction.guild.members
            .fetchMe()
            .catch(() => null);

        const permissions = botMember
          ? interaction.channel.permissionsFor(botMember)
          : null;

        const missingPermissions = [];

        if (
          !permissions?.has(
            PermissionFlagsBits.ViewChannel
          )
        ) {
          missingPermissions.push("View Channel");
        }

        if (
          !permissions?.has(
            PermissionFlagsBits.SendMessages
          )
        ) {
          missingPermissions.push("Send Messages");
        }

        if (
          !permissions?.has(
            PermissionFlagsBits.EmbedLinks
          )
        ) {
          missingPermissions.push("Embed Links");
        }

        if (
          fs.existsSync(TICKET_PANEL_IMAGE) &&
          !permissions?.has(
            PermissionFlagsBits.AttachFiles
          )
        ) {
          missingPermissions.push("Attach Files");
        }

        if (missingPermissions.length) {
          return replyToInteraction(interaction, {
            content:
              "❌ לבוט חסרות הרשאות בחדר הזה:\n" +
              missingPermissions
                .map(permission => `• ${permission}`)
                .join("\n"),
            ephemeral: true
          });
        }

        try {
          await sendTicketPanel(interaction.channel);

          return replyToInteraction(interaction, {
            content: "✅ פאנל הטיקטים נשלח.",
            ephemeral: true
          });
        } catch (error) {
          console.error(
            "❌ Ticket panel send error:",
            error
          );

          return replyToInteraction(interaction, {
            content:
              "❌ לא הצלחתי לשלוח את פאנל הטיקטים.\n" +
              `שגיאה: \`${error.code || error.message}\``,
            ephemeral: true
          });
        }
      }

      if (interaction.commandName === "setup-xp-shop") {
        if (!isStaff(interaction.member)) {
          return replyToInteraction(interaction, {
            content:
              "❌ רק צוות Zone X יכול לשלוח את פאנל ה־XP Shop.",
            ephemeral: true
          });
        }

        if (!interaction.channel?.isTextBased()) {
          return replyToInteraction(interaction, {
            content:
              "❌ אפשר לשלוח את פאנל ה־XP Shop רק בחדר טקסט.",
            ephemeral: true
          });
        }

        const panel = buildXpShopPanel();

        if (!panel) {
          return replyToInteraction(interaction, {
            content:
              "❌ אין רולים תקינים ב־`xpShop` בתוך config.js.",
            ephemeral: true
          });
        }

        try {
          await interaction.channel.send(panel);

          return replyToInteraction(interaction, {
            content: "✅ פאנל ה־XP Shop נשלח.",
            ephemeral: true
          });
        } catch (error) {
          console.error("❌ XP Shop panel error:", error);

          return replyToInteraction(interaction, {
            content:
              "❌ לא הצלחתי לשלוח את פאנל ה־XP Shop. בדוק שלבוט יש Send Messages ו־Embed Links.",
            ephemeral: true
          });
        }
      }

      const moderationCommands = [
        "rank",
        "warn",
        "warnings",
        "unwarn",
        "clear-warns",
        "restraining-order",
        "restraining-orders",
        "unrestraining-order",
        "mute",
        "unvoice-mute",
        "chat-mute",
        "un-chat-mute",
        "timeout",
        "untimeout",
        "kick",
        "ban",
        "clear"
      ];

      if (moderationCommands.includes(interaction.commandName)) {
        if (!isStaff(interaction.member)) {
          return replyToInteraction(interaction, {
            content: "❌ אין לך גישה לפקודת המודרציה הזאת.",
            ephemeral: true
          });
        }
      }

      const punishmentOnlyCommands = [
        "timeout",
        "untimeout",
        "kick",
        "ban"
      ];

      if (
        punishmentOnlyCommands.includes(
          interaction.commandName
        ) &&
        !hasPunishmentAccess(
          interaction.member
        )
      ) {
        return replyToInteraction(interaction, {
          content:
            "❌ רק הרול המוגדר ב־`punishmentRoleId` יכול להשתמש בפקודה הזאת.",
          ephemeral: true
        });
      }

      if (interaction.commandName === "rank") {
        const user =
          interaction.options.getUser("user") ||
          interaction.user;

        const member =
          await getGuildMember(
            interaction,
            user
          );

        if (!member) {
          return replyToInteraction(interaction, {
            content:
              "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        return replyToInteraction(interaction, {
          embeds: [
            buildRankEmbed(
              interaction.guild,
              member
            )
          ]
        });
      }

      if (interaction.commandName === "warn") {
        const user =
          interaction.options.getUser("user");

        const action =
          interaction.options.getString(
            "action"
          ) || "none";

        const durationText =
          interaction.options.getString(
            "duration"
          );

        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const duration =
          durationText
            ? parseDuration(
                durationText,
                28
              )
            : null;

        const member =
          await getGuildMember(
            interaction,
            user
          );

        if (!member) {
          return replyToInteraction(interaction, {
            content:
              "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        if (user.bot) {
          return replyToInteraction(interaction, {
            content:
              "❌ אי אפשר לתת Warn לבוט.",
            ephemeral: true
          });
        }

        if (user.id === interaction.user.id) {
          return replyToInteraction(interaction, {
            content:
              "❌ אי אפשר לתת Warn לעצמך.",
            ephemeral: true
          });
        }

        const validation =
          await validateSelectedWarnAction({
            interaction,
            member,
            action,
            duration
          });

        if (!validation.ok) {
          return replyToInteraction(
            interaction,
            {
              content:
                validation.message,
              ephemeral: true
            }
          );
        }

        const warning = createWarning({
          guildId: interaction.guild.id,
          userId: user.id,
          moderatorId: interaction.user.id,
          reason,
          action,
          durationMs: duration
        });

        const userWarnData =
          getUserWarnings(
            interaction.guild.id,
            user.id
          );

        const warnCount =
          userWarnData.warns.length;

        let selectedAction = null;

        try {
          selectedAction =
            await applySelectedWarnAction({
              interaction,
              member,
              user,
              action,
              duration,
              reason
            });
        } catch (error) {
          console.error(
            "❌ Selected warn action error:",
            error
          );

          selectedAction = {
            applied: false,
            label:
              getWarnActionDetails(
                action,
                duration
              )
          };
        }

        // Keep the original cumulative 3/5/7 Warn punishment
        // only when this Warn was "Warn only", avoiding double punishments.
        const autoPunishment =
          action === "none"
            ? await applyWarnPunishment(
                interaction.guild,
                member,
                userWarnData,
                interaction.user
              )
            : null;

        let punishmentText = "";

        if (
          action !== "none" &&
          selectedAction?.applied
        ) {
          punishmentText =
            `\n🛡️ פעולה: **${selectedAction.label}**.`;
        } else if (
          action !== "none" &&
          !selectedAction?.applied
        ) {
          punishmentText =
            `\n⚠️ ה־Warn נשמר, אבל הפעולה **${getWarnActionDetails(action, duration)}** נכשלה.`;
        }

        if (autoPunishment?.applied) {
          punishmentText +=
            `\n⏳ עונש אוטומטי: Timeout ל־**${autoPunishment.label}**.`;
        } else if (
          autoPunishment &&
          !autoPunishment.applied
        ) {
          punishmentText +=
            `\n⚠️ הגיע לסף של ${autoPunishment.count} Warns, ` +
            "אבל לא הצלחתי לתת Timeout אוטומטי.";
        }

        await user.send(
          `⚠️ קיבלת אזהרה בשרת **${interaction.guild.name}**.\n` +
          `ID: **${warning.id}**\n` +
          `סיבה: ${reason}\n` +
          `פעולה: ${getWarnActionDetails(action, duration)}\n` +
          `סה"כ Warns פעילים: **${warnCount}**` +
          punishmentText
        ).catch(() => {});

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "⚠️ Warn",
            "Yellow",
            [
              {
                name: "משתמש",
                value: `${user}`
              },
              {
                name: "צוות",
                value: `${interaction.user}`
              },
              {
                name: "Warn ID",
                value: warning.id
              },
              {
                name: "סיבה",
                value: reason
              },
              {
                name: "פעולה שנבחרה",
                value:
                  getWarnActionDetails(
                    action,
                    duration
                  )
              },
              {
                name: "Warns פעילים",
                value: `${warnCount}`
              },
              {
                name: "תוצאה",
                value:
                  action !== "none"
                    ? (
                        selectedAction?.applied
                          ? "הפעולה בוצעה"
                          : "ה־Warn נשמר, הפעולה נכשלה"
                      )
                    : (
                        autoPunishment?.applied
                          ? `Timeout אוטומטי ל־${autoPunishment.label}`
                          : (
                              autoPunishment
                                ? "הגיע לסף, אך ה־Timeout נכשל"
                                : "Warn בלבד"
                            )
                      )
              }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content:
            `✅ ${user} קיבל Warn **${warning.id}**.\n` +
            `📊 יש לו עכשיו **${warnCount} Warns**.` +
            punishmentText,
          ephemeral: true
        });
      }

      if (
        interaction.commandName ===
        "warnings"
      ) {
        const user =
          interaction.options.getUser("user");

        const member =
          await getGuildMember(
            interaction,
            user
          );

        if (!member) {
          return replyToInteraction(interaction, {
            content:
              "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        const userWarnData =
          getUserWarnings(
            interaction.guild.id,
            user.id
          );

        const embed =
          new EmbedBuilder()
            .setColor(
              userWarnData.warns.length
                ? "Yellow"
                : "Green"
            )
            .setTitle(
              `⚠️ Warns — ${user.username}`
            )
            .setThumbnail(
              user.displayAvatarURL()
            )
            .setDescription(
              warningListText(
                userWarnData.warns
              )
            )
            .addFields({
              name: "סה״כ Warns פעילים",
              value:
                `**${userWarnData.warns.length}**`,
              inline: true
            })
            .setTimestamp();

        return replyToInteraction(interaction, {
          embeds: [embed],
          ephemeral: true
        });
      }

      if (
        interaction.commandName ===
        "unwarn"
      ) {
        const user =
          interaction.options.getUser("user");

        const warningId =
          interaction.options.getString("id");

        const member =
          await getGuildMember(
            interaction,
            user
          );

        if (!member) {
          return replyToInteraction(interaction, {
            content:
              "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        const removed =
          removeWarning(
            interaction.guild.id,
            user.id,
            warningId
          );

        if (!removed) {
          return replyToInteraction(interaction, {
            content:
              `❌ לא מצאתי Warn עם ID **${String(warningId).toUpperCase()}** אצל ${user}.`,
            ephemeral: true
          });
        }

        const remaining =
          getUserWarnings(
            interaction.guild.id,
            user.id
          ).warns.length;

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "🗑️ Warn Removed",
            "Orange",
            [
              {
                name: "משתמש",
                value: `${user}`
              },
              {
                name: "צוות",
                value: `${interaction.user}`
              },
              {
                name: "Warn ID",
                value: removed.id
              },
              {
                name: "סיבה מקורית",
                value:
                  removed.reason ||
                  "לא צוינה סיבה"
              },
              {
                name: "Warns שנותרו",
                value: `${remaining}`
              }
            ]
          )
        );

        await user.send(
          `🗑️ Warn **${removed.id}** הוסר לך בשרת **${interaction.guild.name}**.\n` +
          `נשארו לך **${remaining} Warns**.`
        ).catch(() => {});

        return replyToInteraction(interaction, {
          content:
            `✅ Warn **${removed.id}** הוסר מ־${user}.\n` +
            `נשארו לו **${remaining} Warns**.`,
          ephemeral: true
        });
      }

      if (
        interaction.commandName ===
        "clear-warns"
      ) {
        const user =
          interaction.options.getUser("user");

        const member =
          await getGuildMember(
            interaction,
            user
          );

        if (!member) {
          return replyToInteraction(interaction, {
            content:
              "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        const removedCount =
          clearUserWarnings(
            interaction.guild.id,
            user.id
          );

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "🧹 Warns Cleared",
            "Red",
            [
              {
                name: "משתמש",
                value: `${user}`
              },
              {
                name: "צוות",
                value: `${interaction.user}`
              },
              {
                name: "Warns שנמחקו",
                value: `${removedCount}`
              }
            ]
          )
        );

        await user.send(
          `🧹 כל ה־Warns שלך נוקו בשרת **${interaction.guild.name}**.`
        ).catch(() => {});

        return replyToInteraction(interaction, {
          content:
            removedCount
              ? `✅ נמחקו **${removedCount} Warns** מ־${user}.`
              : `ℹ️ ל־${user} לא היו Warns פעילים.`,
          ephemeral: true
        });
      }

      if (
        interaction.commandName ===
        "restraining-order"
      ) {
        const user1 =
          interaction.options.getUser(
            "user1"
          );

        const user2 =
          interaction.options.getUser(
            "user2"
          );

        const durationValue =
          interaction.options.getString(
            "duration"
          );

        const reason =
          interaction.options.getString(
            "reason"
          ) || "לא צוינה סיבה";

        if (user1.id === user2.id) {
          return replyToInteraction(
            interaction,
            {
              content:
                "❌ צריך לבחור שני משתמשים שונים.",
              ephemeral: true
            }
          );
        }

        if (user1.bot || user2.bot) {
          return replyToInteraction(
            interaction,
            {
              content:
                "❌ אי אפשר ליצור צו הרחקה מול בוט.",
              ephemeral: true
            }
          );
        }

        const member1 =
          await getGuildMember(
            interaction,
            user1
          );

        const member2 =
          await getGuildMember(
            interaction,
            user2
          );

        if (!member1 || !member2) {
          return replyToInteraction(
            interaction,
            {
              content:
                "❌ שני המשתמשים חייבים להיות בשרת.",
              ephemeral: true
            }
          );
        }

        const botMember =
          await interaction.guild.members
            .fetchMe()
            .catch(() => null);

        if (
          !botMember ||
          !botMember.permissions.has(
            PermissionFlagsBits.MoveMembers
          )
        ) {
          return replyToInteraction(
            interaction,
            {
              content:
                "❌ כדי לאכוף צו הרחקה לבוט צריך `Move Members`.",
              ephemeral: true
            }
          );
        }

        const existing =
          findActiveRestrainingOrder(
            interaction.guild.id,
            user1.id,
            user2.id
          );

        if (existing) {
          return replyToInteraction(
            interaction,
            {
              content:
                `❌ כבר קיים צו הרחקה פעיל ביניהם: **${existing.id}**.\n` +
                `⏳ זמן: **${restrainingOrderDurationText(existing)}**`,
              ephemeral: true
            }
          );
        }

        const permanent =
          durationValue === "permanent";

        const duration =
          permanent
            ? null
            : parseDuration(
                durationValue,
                3650
              );

        if (!permanent && !duration) {
          return replyToInteraction(
            interaction,
            {
              content:
                "❌ זמן צו ההרחקה לא תקין.",
              ephemeral: true
            }
          );
        }

        const order =
          createRestrainingOrder({
            guildId:
              interaction.guild.id,
            user1Id: user1.id,
            user2Id: user2.id,
            moderatorId:
              interaction.user.id,
            reason,
            expiresAt:
              permanent
                ? null
                : Date.now() + duration
          });

        const enforcement =
          await enforceRestrainingOrder(
            interaction.guild,
            order
          );

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "🚫 Restraining Order נוצר",
            "DarkRed",
            [
              {
                name: "Order ID",
                value: order.id
              },
              {
                name: "בין",
                value:
                  `${user1} ↔ ${user2}`
              },
              {
                name: "זמן",
                value:
                  permanent
                    ? "לצמיתות"
                    : formatDuration(
                        duration
                      )
              },
              {
                name: "צוות",
                value:
                  `${interaction.user}`
              },
              {
                name: "סיבה",
                value: reason
              }
            ]
          )
        );

        return replyToInteraction(
          interaction,
          {
            content:
              `✅ נוצר צו הרחקה **${order.id}** בין ${user1} ל־${user2}.\n` +
              `⏳ זמן: **${permanent ? "לצמיתות" : formatDuration(duration)}**.\n` +
              "🎙️ כל עוד הצו פעיל, אם שניהם יהיו באותו Voice Channel הבוט ינתק את שניהם." +
              (
                enforcement.triggered
                  ? "\n🚫 הצו נאכף מיד כי הם כבר היו באותה שיחה."
                  : ""
              ),
            ephemeral: true
          }
        );
      }

      if (
        interaction.commandName ===
        "restraining-orders"
      ) {
        const selectedUser =
          interaction.options.getUser(
            "user"
          );

        const guildData =
          getGuildRestrainingOrders(
            interaction.guild.id
          );

        const orders =
          guildData.orders.filter(
            order =>
              isRestrainingOrderActive(
                order
              ) &&
              (
                !selectedUser ||
                order.user1Id ===
                  selectedUser.id ||
                order.user2Id ===
                  selectedUser.id
              )
          );

        if (!orders.length) {
          return replyToInteraction(
            interaction,
            {
              content:
                selectedUser
                  ? `ℹ️ אין צווי הרחקה פעילים שקשורים ל־${selectedUser}.`
                  : "ℹ️ אין כרגע צווי הרחקה פעילים.",
              ephemeral: true
            }
          );
        }

        const visible =
          orders.slice(0, 15);

        const description =
          visible.map(order => {
            return (
              `**${order.id}** — ` +
              `<@${order.user1Id}> ↔ ` +
              `<@${order.user2Id}>\n` +
              `⏳ ${restrainingOrderDurationText(order)}\n` +
              `📝 ${String(
                order.reason ||
                "לא צוינה סיבה"
              ).slice(0, 120)}`
            );
          }).join("\n\n");

        const embed =
          new EmbedBuilder()
            .setColor("DarkRed")
            .setTitle(
              "🚫 Active Restraining Orders"
            )
            .setDescription(
              description +
              (
                orders.length >
                visible.length
                  ? `\n\nמוצגים ${visible.length} מתוך ${orders.length} צווים.`
                  : ""
              )
            )
            .setTimestamp();

        return replyToInteraction(
          interaction,
          {
            embeds: [embed],
            ephemeral: true
          }
        );
      }

      if (
        interaction.commandName ===
        "unrestraining-order"
      ) {
        const orderId =
          interaction.options.getString(
            "id"
          );

        const reason =
          interaction.options.getString(
            "reason"
          ) || "הוסר ידנית";

        const removed =
          removeRestrainingOrder(
            interaction.guild.id,
            orderId
          );

        if (!removed) {
          return replyToInteraction(
            interaction,
            {
              content:
                `❌ לא מצאתי צו הרחקה עם ID **${String(orderId).toUpperCase()}**.`,
              ephemeral: true
            }
          );
        }

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "✅ Restraining Order בוטל",
            "Green",
            [
              {
                name: "Order ID",
                value: removed.id
              },
              {
                name: "בין",
                value:
                  `<@${removed.user1Id}> ↔ ` +
                  `<@${removed.user2Id}>`
              },
              {
                name: "צוות",
                value:
                  `${interaction.user}`
              },
              {
                name: "סיבת ביטול",
                value: reason
              }
            ]
          )
        );

        return replyToInteraction(
          interaction,
          {
            content:
              `✅ צו ההרחקה **${removed.id}** בוטל.\n` +
              `<@${removed.user1Id}> ו־<@${removed.user2Id}> יכולים שוב להיות באותה שיחה.`,
            ephemeral: true
          }
        );
      }

      if (interaction.commandName === "mute") {
        const user =
          interaction.options.getUser("user");

        const durationText =
          interaction.options.getString(
            "duration"
          );

        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const duration =
          parseDuration(durationText, 28);

        if (!duration) {
          return replyToInteraction(interaction, {
            content:
              "❌ זמן לא תקין. בחר זמן מתוך הרשימה.",
            ephemeral: true
          });
        }

        const member =
          await getGuildMember(
            interaction,
            user
          );

        if (!member) {
          return replyToInteraction(interaction, {
            content:
              "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        if (!member.voice.channelId) {
          return replyToInteraction(interaction, {
            content:
              "❌ המשתמש לא נמצא כרגע בשיחה קולית.",
            ephemeral: true
          });
        }

        if (
          member.id === interaction.guild.ownerId
        ) {
          return replyToInteraction(interaction, {
            content:
              "❌ אי אפשר לעשות Voice Mute לבעל השרת.",
            ephemeral: true
          });
        }

        if (
          member.permissions.has(
            PermissionFlagsBits.Administrator
          ) &&
          interaction.guild.ownerId !==
            interaction.user.id
        ) {
          return replyToInteraction(interaction, {
            content:
              "❌ רק בעל השרת יכול לעשות Voice Mute לאדמין.",
            ephemeral: true
          });
        }

        const botMember =
          await interaction.guild.members
            .fetchMe()
            .catch(() => null);

        if (
          !botMember ||
          !botMember.permissions.has(
            PermissionFlagsBits.MuteMembers
          )
        ) {
          return replyToInteraction(interaction, {
            content:
              "❌ לבוט אין `Mute Members`.",
            ephemeral: true
          });
        }

        try {
          await member.voice.setMute(
            true,
            `${reason} | Zone X voice mute by ${interaction.user.tag}`
          );
        } catch (error) {
          console.error(
            "❌ Voice mute error:",
            error
          );

          return replyToInteraction(interaction, {
            content:
              "❌ לא הצלחתי לעשות Voice Mute למשתמש.\n" +
              `שגיאה: \`${error.code || error.message}\``,
            ephemeral: true
          });
        }

        addModTimer({
          guildId: interaction.guild.id,
          userId: user.id,
          type: "voice-mute",
          expiresAt: Date.now() + duration,
          reason,
          moderatorId: interaction.user.id
        });

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "🔇 Voice Mute",
            "Orange",
            [
              {
                name: "משתמש",
                value: `${user}`
              },
              {
                name: "זמן",
                value: formatDuration(duration)
              },
              {
                name: "צוות",
                value: `${interaction.user}`
              },
              {
                name: "סיבה",
                value: reason
              }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content:
            `✅ ${user} קיבל **Voice Mute** ל־**${formatDuration(duration)}**.\n` +
            "הוא לא יכול לדבר ב־Voice, אבל יכול להשתמש בצ׳אט.",
          ephemeral: true
        });
      }

      if (
        interaction.commandName ===
        "unvoice-mute"
      ) {
        const user =
          interaction.options.getUser("user");

        const reason =
          interaction.options.getString("reason") ||
          "הוסר ידנית";

        const member =
          await getGuildMember(
            interaction,
            user
          );

        if (!member) {
          return replyToInteraction(interaction, {
            content:
              "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        if (!member.voice.channelId) {
          return replyToInteraction(interaction, {
            content:
              "❌ המשתמש לא נמצא כרגע בשיחה קולית.",
            ephemeral: true
          });
        }

        const botMember =
          await interaction.guild.members
            .fetchMe()
            .catch(() => null);

        if (
          !botMember ||
          !botMember.permissions.has(
            PermissionFlagsBits.MuteMembers
          )
        ) {
          return replyToInteraction(interaction, {
            content:
              "❌ לבוט אין `Mute Members`.",
            ephemeral: true
          });
        }

        try {
          await member.voice.setMute(
            false,
            `${reason} | Zone X voice unmute by ${interaction.user.tag}`
          );
        } catch (error) {
          console.error(
            "❌ Voice unmute error:",
            error
          );

          return replyToInteraction(interaction, {
            content:
              "❌ לא הצלחתי להסיר את ה־Voice Mute.\n" +
              `שגיאה: \`${error.code || error.message}\``,
            ephemeral: true
          });
        }

        removeModTimer(
          interaction.guild.id,
          user.id,
          "voice-mute"
        );

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "🔊 Voice Unmute",
            "Green",
            [
              {
                name: "משתמש",
                value: `${user}`
              },
              {
                name: "צוות",
                value: `${interaction.user}`
              },
              {
                name: "סיבה",
                value: reason
              }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content:
            `✅ ה־Voice Mute הוסר מ־${user}.`,
          ephemeral: true
        });
      }

      if (
        interaction.commandName ===
        "chat-mute"
      ) {
        if (!config.muteRoleId) {
          return replyToInteraction(interaction, {
            content:
              "❌ חסר `muteRoleId` ב־config.js.",
            ephemeral: true
          });
        }

        const user =
          interaction.options.getUser("user");

        const durationText =
          interaction.options.getString(
            "duration"
          );

        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const duration =
          parseDuration(durationText, 28);

        if (!duration) {
          return replyToInteraction(interaction, {
            content:
              "❌ זמן לא תקין. השתמש לדוגמה ב־`30s`, `10m`, `2h`, `3d`. " +
              "המינימום 10 שניות והמקסימום 28 ימים.",
            ephemeral: true
          });
        }

        const member =
          await getGuildMember(
            interaction,
            user
          );

        if (!member) {
          return replyToInteraction(interaction, {
            content:
              "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        if (
          member.permissions.has(
            PermissionFlagsBits.Administrator
          ) &&
          interaction.guild.ownerId !==
            interaction.user.id
        ) {
          return replyToInteraction(interaction, {
            content:
              "❌ אי אפשר לעשות Chat Mute לאדמין.",
            ephemeral: true
          });
        }

        const muteRole =
          await interaction.guild.roles
            .fetch(config.muteRoleId)
            .catch(() => null);

        if (!muteRole) {
          return replyToInteraction(interaction, {
            content:
              "❌ לא מצאתי את רול ה־Mute.",
            ephemeral: true
          });
        }

        const botMember =
          await interaction.guild.members
            .fetchMe()
            .catch(() => null);

        if (
          !botMember ||
          !botMember.permissions.has(
            PermissionFlagsBits.ManageRoles
          )
        ) {
          return replyToInteraction(interaction, {
            content:
              "❌ לבוט אין `Manage Roles`.",
            ephemeral: true
          });
        }

        if (
          muteRole.managed ||
          muteRole.position >=
            botMember.roles.highest.position
        ) {
          return replyToInteraction(interaction, {
            content:
              "❌ הבוט לא יכול לנהל את רול ה־Mute. " +
              "שים את רול הבוט מעל רול ה־Mute.",
            ephemeral: true
          });
        }

        if (
          member.roles.cache.has(muteRole.id)
        ) {
          return replyToInteraction(interaction, {
            content:
              `ℹ️ ל־${user} כבר יש Chat Mute.`,
            ephemeral: true
          });
        }

        try {
          await member.roles.add(
            muteRole,
            `${reason} | Zone X chat mute by ${interaction.user.tag}`
          );
        } catch (error) {
          console.error(
            "❌ Chat mute role error:",
            error
          );

          return replyToInteraction(interaction, {
            content:
              "❌ לא הצלחתי לתת את רול ה־Chat Mute.\n" +
              `שגיאה: \`${error.code || error.message}\``,
            ephemeral: true
          });
        }

        addModTimer({
          guildId: interaction.guild.id,
          userId: user.id,
          type: "chat-mute",
          expiresAt: Date.now() + duration,
          reason,
          moderatorId: interaction.user.id
        });

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "💬 Chat Mute",
            "Orange",
            [
              {
                name: "משתמש",
                value: `${user}`
              },
              {
                name: "זמן",
                value:
                  formatDuration(duration)
              },
              {
                name: "צוות",
                value: `${interaction.user}`
              },
              {
                name: "סיבה",
                value: reason
              }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content:
            `✅ ${user} קיבל **Chat Mute** ל־**${formatDuration(duration)}**.\n` +
            "נוסף רק רול ה־Mute — לא הופעל Discord Timeout, ולכן הוא עדיין יכול להיכנס ל־Voice ולדבר.",
          ephemeral: true
        });
      }

      if (
        interaction.commandName ===
        "un-chat-mute"
      ) {
        if (!config.muteRoleId) {
          return replyToInteraction(interaction, {
            content:
              "❌ חסר `muteRoleId` ב־config.js.",
            ephemeral: true
          });
        }

        const user =
          interaction.options.getUser("user");

        const reason =
          interaction.options.getString("reason") ||
          "הוסר ידנית";

        const member =
          await getGuildMember(
            interaction,
            user
          );

        if (!member) {
          return replyToInteraction(interaction, {
            content:
              "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        const muteRole =
          await interaction.guild.roles
            .fetch(config.muteRoleId)
            .catch(() => null);

        if (!muteRole) {
          return replyToInteraction(interaction, {
            content:
              "❌ לא מצאתי את רול ה־Mute.",
            ephemeral: true
          });
        }

        if (
          !member.roles.cache.has(muteRole.id)
        ) {
          removeModTimer(
            interaction.guild.id,
            user.id,
            "chat-mute"
          );

          return replyToInteraction(interaction, {
            content:
              `ℹ️ ל־${user} אין Chat Mute כרגע.`,
            ephemeral: true
          });
        }

        try {
          await member.roles.remove(
            muteRole,
            `${reason} | Zone X chat unmute by ${interaction.user.tag}`
          );
        } catch (error) {
          console.error(
            "❌ Chat unmute role error:",
            error
          );

          return replyToInteraction(interaction, {
            content:
              "❌ לא הצלחתי להסיר את רול ה־Chat Mute.\n" +
              `שגיאה: \`${error.code || error.message}\``,
            ephemeral: true
          });
        }

        removeModTimer(
          interaction.guild.id,
          user.id,
          "chat-mute"
        );

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "💬 Chat Unmute",
            "Green",
            [
              {
                name: "משתמש",
                value: `${user}`
              },
              {
                name: "צוות",
                value: `${interaction.user}`
              },
              {
                name: "סיבה",
                value: reason
              }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content:
            `✅ ה־Chat Mute הוסר מ־${user}.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "timeout") {
        const user = interaction.options.getUser("user");
        const durationText =
          interaction.options.getString("duration");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const duration = parseDuration(durationText, 28);

        if (!duration) {
          return replyToInteraction(interaction, {
            content:
              "❌ זמן לא תקין. השתמש לדוגמה ב־`30s`, `10m`, `2h`, `3d`. " +
              "המקסימום ל־Timeout הוא 28 ימים.",
            ephemeral: true
          });
        }

        const member = await getGuildMember(interaction, user);

        if (!member?.moderatable) {
          return replyToInteraction(interaction, {
            content: "❌ אי אפשר לעשות Timeout למשתמש הזה.",
            ephemeral: true
          });
        }

        await member.timeout(
          duration,
          `${reason} | by ${interaction.user.tag}`
        );

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "⏳ Timeout",
            "Orange",
            [
              { name: "משתמש", value: `${user}` },
              { name: "זמן", value: formatDuration(duration) },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content:
            `✅ ${user} קיבל Timeout ל־**${formatDuration(duration)}**.\n` +
            "Discord יסיר את ה־Timeout אוטומטית בזמן שנבחר.",
          ephemeral: true
        });
      }

      if (interaction.commandName === "untimeout") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "הוסר ידנית";

        const member = await getGuildMember(interaction, user);

        if (!member?.moderatable) {
          return replyToInteraction(interaction, {
            content: "❌ אי אפשר לשנות Timeout למשתמש הזה.",
            ephemeral: true
          });
        }

        await member.timeout(
          null,
          `${reason} | by ${interaction.user.tag}`
        );

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "✅ Timeout הוסר",
            "Green",
            [
              { name: "משתמש", value: `${user}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content: `✅ ה־Timeout הוסר מ־${user}.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "kick") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const member = await getGuildMember(interaction, user);

        if (!member?.kickable) {
          return replyToInteraction(interaction, {
            content: "❌ אי אפשר להעיף את המשתמש הזה.",
            ephemeral: true
          });
        }

        await member.kick(
          `${reason} | by ${interaction.user.tag}`
        );

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "👢 Kick",
            "Red",
            [
              { name: "משתמש", value: `${user.tag}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content: `✅ ${user.tag} הועף מהשרת.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "ban") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const member = await getGuildMember(interaction, user);

        if (member && !member.bannable) {
          return replyToInteraction(interaction, {
            content: "❌ אי אפשר לתת באן למשתמש הזה.",
            ephemeral: true
          });
        }

        await interaction.guild.members.ban(user.id, {
          reason: `${reason} | by ${interaction.user.tag}`
        });

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "🔨 Ban",
            "DarkRed",
            [
              { name: "משתמש", value: `${user.tag}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content: `✅ ${user.tag} קיבל באן.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "clear") {
        const amount = interaction.options.getInteger("amount");

        if (!interaction.channel?.isTextBased()) {
          return replyToInteraction(interaction, {
            content: "❌ הפקודה הזאת עובדת רק בחדר טקסט.",
            ephemeral: true
          });
        }

        const deleted = await interaction.channel.bulkDelete(amount, true);

        return replyToInteraction(interaction, {
          content: `✅ נמחקו ${deleted.size} הודעות.`,
          ephemeral: true
        });
      }

      console.warn(
        `⚠️ Unknown slash command received: /${interaction.commandName}`
      );

      return replyToInteraction(interaction, {
        content:
          `❌ הפקודה /${interaction.commandName} רשומה בדיסקורד, ` +
          "אבל ה־index.js שרץ כרגע לא מטפל בה. " +
          "עצור את הבוט, החלף לקובץ החדש והפעל מחדש.",
        ephemeral: true
      });
    }

    if (interaction.isStringSelectMenu()) {
      if (
        interaction.customId !==
        "zone_ticket_type_select"
      ) {
        return;
      }

      const ticketData =
        TICKET_TYPES[interaction.values[0]];

      if (!ticketData) {
        return interaction.reply({
          content: "❌ סוג הטיקט לא תקין.",
          ephemeral: true
        });
      }

      return openTicket(interaction, ticketData);
    }

    if (interaction.isUserSelectMenu()) {
      if (
        interaction.customId !==
          "zone_ticket_add_user_select" &&
        interaction.customId !==
          "zone_ticket_remove_user_select"
      ) {
        return;
      }

      const claimedById =
        getTicketClaimedBy(interaction.channel);

      if (!claimedById) {
        return interaction.reply({
          content:
            "❌ קודם איש צוות צריך לעשות Claim לטיקט.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== claimedById) {
        return interaction.reply({
          content:
            "❌ רק מי שעשה Claim לטיקט יכול לבצע את הפעולה הזאת.",
          ephemeral: true
        });
      }

      const selectedUser =
        interaction.users.first();

      if (!selectedUser) {
        return interaction.update({
          content: "❌ לא נבחר משתמש.",
          components: []
        });
      }

      const ticketOwnerId =
        getTicketOwner(interaction.channel);

      if (
        interaction.customId ===
        "zone_ticket_add_user_select"
      ) {
        await interaction.channel.permissionOverwrites.edit(
          selectedUser.id,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          },
          {
            reason:
              `Zone X ticket add user by ${interaction.user.tag}`
          }
        );

        return interaction.update({
          content: `✅ ${selectedUser} נוסף לטיקט.`,
          components: []
        });
      }

      if (selectedUser.id === ticketOwnerId) {
        return interaction.update({
          content:
            "❌ אי אפשר להסיר את מי שפתח את הטיקט.",
          components: []
        });
      }

      if (selectedUser.id === claimedById) {
        return interaction.update({
          content:
            "❌ אי אפשר להסיר את איש הצוות שלקח את הטיקט.",
          components: []
        });
      }

      const selectedMember =
        await interaction.guild.members
          .fetch(selectedUser.id)
          .catch(() => null);

      const ticketAccessRoleId =
        getTicketAccessRoleIdFromChannel(
          interaction.channel
        );

      if (
        ticketAccessRoleId &&
        selectedMember?.roles.cache.has(
          ticketAccessRoleId
        )
      ) {
        return interaction.update({
          content:
            "❌ אי אפשר להסיר איש צוות מהטיקט.",
          components: []
        });
      }

      await interaction.channel.permissionOverwrites
        .delete(
          selectedUser.id,
          `Zone X ticket remove user by ${interaction.user.tag}`
        )
        .catch(() => null);

      return interaction.update({
        content: `✅ ${selectedUser} הוסר מהטיקט.`,
        components: []
      });
    }

    if (!interaction.isButton()) return;

    if (
      interaction.customId.startsWith(
        "take_help_request:"
      )
    ) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            "❌ רק צוות יכול לקחת בקשות עזרה.",
          ephemeral: true
        });
      }

      const [
        ,
        requesterId,
        requestId
      ] = interaction.customId.split(":");

      const requester =
        await interaction.guild.members
          .fetch(requesterId)
          .catch(() => null);

      const reason =
        interaction.message.embeds[0]
          ?.fields
          ?.find(
            field => field.name === "סיבה:"
          )
          ?.value ||
        "לא צוינה סיבה";

      const claimedRow =
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(
              `take_help_request:${requesterId}:${requestId}`
            )
            .setLabel("בטיפול")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true)
        );

      return interaction.update({
        embeds: [
          buildHelpRequestEmbed(
            requester || `<@${requesterId}>`,
            reason,
            requestId,
            interaction.user
          )
        ],
        components: [claimedRow]
      });
    }

    if (interaction.customId.startsWith("xp_shop_buy:")) {
      const itemKey = interaction.customId.slice(
        "xp_shop_buy:".length
      );

      return buyXpRoleFromButton(
        interaction,
        itemKey
      );
    }

    if (interaction.customId === "zone_ticket_claim") {
      if (!isTicketStaff(interaction.member, interaction.channel)) {
        return interaction.reply({
          content: "❌ רק צוות יכול לעשות Claim לטיקט.",
          ephemeral: true
        });
      }

      const alreadyClaimedBy =
        getTicketClaimedBy(interaction.channel);

      if (alreadyClaimedBy) {
        return interaction.reply({
          content:
            `❌ הטיקט כבר נלקח על ידי <@${alreadyClaimedBy}>.`,
          ephemeral: true
        });
      }

      await setTicketClaimedBy(
        interaction.channel,
        interaction.user.id
      );

      await interaction.update({
        components: [
          buildTicketButtons(interaction.user.id)
        ]
      });

      return interaction.channel.send(
        `🙋 הטיקט נלקח על ידי <@${interaction.user.id}>`
      ).catch(() => {});
    }

    if (interaction.customId === "zone_ticket_release") {
      const claimedById =
        getTicketClaimedBy(interaction.channel);

      if (!claimedById) {
        return interaction.reply({
          content: "❌ הטיקט כבר משוחרר.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== claimedById) {
        return interaction.reply({
          content:
            "❌ רק מי שעשה Claim יכול לשחרר את הטיקט.",
          ephemeral: true
        });
      }

      await setTicketClaimedBy(
        interaction.channel,
        null
      );

      await interaction.update({
        components: [buildTicketButtons()]
      });

      return interaction.channel.send(
        `🔓 <@${interaction.user.id}> שחרר את הטיקט.`
      ).catch(() => {});
    }

    if (interaction.customId === "zone_ticket_add_user") {
      const claimedById =
        getTicketClaimedBy(interaction.channel);

      if (
        !claimedById ||
        interaction.user.id !== claimedById
      ) {
        return interaction.reply({
          content:
            "❌ רק מי שעשה Claim יכול להוסיף משתמשים.",
          ephemeral: true
        });
      }

      const row =
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(
              "zone_ticket_add_user_select"
            )
            .setPlaceholder(
              "בחר משתמש להוסיף לטיקט"
            )
            .setMinValues(1)
            .setMaxValues(1)
        );

      return interaction.reply({
        content: "➕ בחר משתמש להוסיף:",
        components: [row],
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "zone_ticket_remove_user"
    ) {
      const claimedById =
        getTicketClaimedBy(interaction.channel);

      if (
        !claimedById ||
        interaction.user.id !== claimedById
      ) {
        return interaction.reply({
          content:
            "❌ רק מי שעשה Claim יכול להסיר משתמשים.",
          ephemeral: true
        });
      }

      const row =
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(
              "zone_ticket_remove_user_select"
            )
            .setPlaceholder(
              "בחר משתמש להסיר מהטיקט"
            )
            .setMinValues(1)
            .setMaxValues(1)
        );

      return interaction.reply({
        content: "➖ בחר משתמש להסיר:",
        components: [row],
        ephemeral: true
      });
    }

    if (interaction.customId === "zone_ticket_close") {
      if (!isTicketStaff(interaction.member, interaction.channel)) {
        return interaction.reply({
          content: "❌ רק צוות יכול לסגור טיקטים.",
          ephemeral: true
        });
      }

      await interaction.deferReply({
        ephemeral: true
      });

      const logsChannel =
        await interaction.guild.channels
          .fetch(config.ticketLogsChannelId)
          .catch(() => null);

      const transcriptFile =
        await createTicketTranscript(
          interaction.channel
        ).catch(() => null);

      if (logsChannel?.isTextBased()) {
        const closeEmbed =
          new EmbedBuilder()
            .setColor("Red")
            .setTitle("🔒 Ticket Closed")
            .addFields(
              {
                name: "טיקט",
                value: `#${interaction.channel.name}`
              },
              {
                name: "נושא",
                value: getTicketType(
                  interaction.channel
                )
              },
              {
                name: "נפתח על ידי",
                value:
                  `<@${getTicketOwner(interaction.channel)}>`
              },
              {
                name: "נסגר על ידי",
                value: `${interaction.user}`
              }
            )
            .setTimestamp();

        await logsChannel.send({
          embeds: [closeEmbed],
          files:
            transcriptFile
              ? [transcriptFile]
              : []
        }).catch(() => {});
      }

      await interaction.editReply({
        content:
          "🔒 הטיקט ייסגר בעוד 5 שניות..."
      });

      setTimeout(() => {
        interaction.channel
          .delete(
            `Zone X ticket closed by ${interaction.user.tag}`
          )
          .catch(() => {});
      }, 5000);

      return;
    }

    if (interaction.customId === "start_verify") {
      const correct = String(Math.floor(1000 + Math.random() * 9000));
      const numbers = new Set([correct]);

      while (numbers.size < 4) {
        numbers.add(String(Math.floor(1000 + Math.random() * 9000)));
      }

      const shuffled = [...numbers].sort(() => Math.random() - 0.5);

      const row = new ActionRowBuilder().addComponents(
        shuffled.map(num =>
          new ButtonBuilder()
            .setCustomId(`verify:${interaction.user.id}:${correct}:${num}`)
            .setLabel(num)
            .setStyle(ButtonStyle.Secondary)
        )
      );

      return replyToInteraction(interaction, {
        content:
          `המספר שלך הוא: **${correct}**\n` +
          "תלחץ על הכפתור עם המספר הזה.",
        components: [row],
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith("verify:")) {
      const [, userId, correct, picked] =
        interaction.customId.split(":");

      if (interaction.user.id !== userId) {
        return replyToInteraction(interaction, {
          content: "זה לא ה־Verify שלך 😭",
          ephemeral: true
        });
      }

      if (picked !== correct) {
        return replyToInteraction(interaction, {
          content: "לא נכון 💔 תלחץ שוב על Verify.",
          ephemeral: true
        });
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const botMember = await interaction.guild.members.fetchMe();
      const role = await interaction.guild.roles
        .fetch(config.memberRoleId)
        .catch(() => null);

      if (!role) {
        return interaction.update({
          content:
            "האימות הצליח, אבל לא מצאתי את הרול. " +
            "בדוק `memberRoleId` ב־config.js.",
          components: []
        });
      }

      if (role.managed) {
        return interaction.update({
          content:
            "האימות הצליח, אבל זה רול מנוהל שאי אפשר לתת ידנית.",
          components: []
        });
      }

      if (
        !botMember.permissions.has(PermissionFlagsBits.ManageRoles)
      ) {
        return interaction.update({
          content:
            "האימות הצליח, אבל לבוט אין `Manage Roles`.",
          components: []
        });
      }

      if (role.position >= botMember.roles.highest.position) {
        return interaction.update({
          content:
            "האימות הצליח, אבל רול הבוט נמוך מדי. " +
            "תעלה את רול הבוט מעל רול המאומת.",
          components: []
        });
      }

      try {
        await member.roles.add(
          role,
          "Zone X Verify completed"
        );
      } catch (error) {
        console.error("❌ Verify role add error:", error);

        return interaction.update({
          content:
            "האימות הצליח, אבל לא הצלחתי לתת את הרול.\n" +
            `שגיאה: \`${error.code || error.message}\``,
          components: []
        });
      }

      return interaction.update({
        content: "אומתת בהצלחה ✅ קיבלת את הרול!",
        components: []
      });
    }
  } catch (error) {
    console.error("❌ Interaction error:", error);

    const response = {
      content: "❌ הייתה שגיאה בביצוע הפעולה.",
      ephemeral: true
    };

    return replyToInteraction(interaction, response).catch(() => {});
  }
});

if (!process.env.TOKEN) {
  console.error("❌ TOKEN missing in .env");
  process.exit(1);
}

client.login(process.env.TOKEN).catch(error => {
  console.error("❌ Login error:", error);
  process.exit(1);
});
