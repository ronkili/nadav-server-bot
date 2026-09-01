console.log("🚀 Starting bot...");

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
  AttachmentBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const config = require("./config");

const DATA_DIR = path.join(__dirname, "data");
const MOD_TIMERS_FILE = path.join(DATA_DIR, "mod-timers.json");

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
    fs.writeFileSync(
      filePath,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error("❌ JSON save error:", error);
  }
}

const modTimers = loadJson(MOD_TIMERS_FILE, {});


process.on("unhandledRejection", error => {
  console.error("❌ Unhandled Rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("❌ Uncaught Exception:", error);
});

console.log("✅ Loaded discord.js");
console.log("✅ Loaded config.js");
console.log("🔑 TOKEN exists:", Boolean(process.env.TOKEN));

if (!config.clientId) {
  console.log("⚠️ clientId חסר ב־config.js");
}

if (!config.guildId) {
  console.log("⚠️ guildId חסר ב־config.js");
}

if (!config.staffRoleId) {
  console.log("⚠️ staffRoleId חסר ב־config.js");
}

if (!config.ticketCategoryId) {
  console.log("⚠️ ticketCategoryId חסר ב־config.js");
}

if (!config.ticketStaffRoleId) {
  console.log("⚠️ ticketStaffRoleId חסר ב־config.js");
}

if (!config.ticketLogsChannelId) {
  console.log("⚠️ ticketLogsChannelId חסר ב־config.js");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel]
});

function userReasonCommand(name, description) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("המשתמש")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("סיבה")
        .setRequired(false)
    );
}

async function registerSlashCommands() {
  function userReasonCommand(
    name,
    description,
    withDuration = false
  ) {
    const command = new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription("המשתמש")
          .setRequired(true)
      );

    if (withDuration) {
      command.addStringOption(option =>
        option
          .setName("duration")
          .setDescription("זמן: 30s / 10m / 2h / 3d")
          .setRequired(true)
      );
    }

    command.addStringOption(option =>
      option
        .setName("reason")
        .setDescription("סיבה")
        .setRequired(false)
    );

    return command;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("בודק אם הבוט עובד"),

    new SlashCommandBuilder()
      .setName("help")
      .setDescription("מציג את כל פקודות הבוט"),

    new SlashCommandBuilder()
      .setName("ticket-panel")
      .setDescription("שולח פאנל טיקטים")
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      ),

    new SlashCommandBuilder()
      .setName("giverole")
      .setDescription("נותן רול למשתמש")
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription("בחר משתמש")
          .setRequired(true)
      )
      .addRoleOption(option =>
        option
          .setName("role")
          .setDescription("בחר רול")
          .setRequired(true)
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageRoles
      ),

    userReasonCommand(
      "warn",
      "נותן אזהרה למשתמש"
    ),

    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("נותן Timeout למשתמש")
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription("המשתמש")
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option
          .setName("minutes")
          .setDescription("כמה דקות")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(40320)
      )
      .addStringOption(option =>
        option
          .setName("reason")
          .setDescription("סיבה")
          .setRequired(false)
      ),

    userReasonCommand(
      "kick",
      "מעיף משתמש"
    ),

    userReasonCommand(
      "ban",
      "נותן באן למשתמש"
    ),

    new SlashCommandBuilder()
      .setName("clear")
      .setDescription("מוחק הודעות")
      .addIntegerOption(option =>
        option
          .setName("amount")
          .setDescription("כמות")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100)
      ),

    userReasonCommand(
      "mute",
      "נותן Chat Mute למשתמש",
      true
    ),

    userReasonCommand(
      "unmute",
      "מסיר Chat Mute ממשתמש"
    ),

    userReasonCommand(
      "voice-mute",
      "עושה Voice Mute למשתמש",
      true
    ),

    userReasonCommand(
      "voice-unmute",
      "מוריד Voice Mute ממשתמש"
    ),

    userReasonCommand(
      "voice-deafen",
      "עושה Voice Deafen למשתמש",
      true
    ),

    userReasonCommand(
      "voice-undeafen",
      "מוריד Voice Deafen ממשתמש"
    )
  ].map(command => command.toJSON());

  const rest = new REST({
    version: "10"
  }).setToken(process.env.TOKEN);

  console.log(
    `🔄 Registering ${commands.length} slash commands...`
  );

  const registered = await rest.put(
    Routes.applicationGuildCommands(
      config.clientId,
      config.guildId
    ),
    {
      body: commands
    }
  );

  console.log(
    `✅ Registered ${registered.length} slash commands`
  );

  console.log(
    registered
      .map(command => `✅ /${command.name}`)
      .join("\n")
  );
}

function isStaff(member) {
  return Boolean(
    member?.roles?.cache?.has(config.staffRoleId) ||
    member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function isTicketStaff(member) {
  return Boolean(
    member?.roles?.cache?.has(config.ticketStaffRoleId) ||
    member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function getTicketOwnerId(channel) {
  return channel.topic?.match(/ticketOwner:(\d+)/)?.[1] || null;
}

function getTicketClaimedById(channel) {
  return channel.topic?.match(/claimedBy:(\d+)/)?.[1] || null;
}

function getTicketType(channel) {
  return channel.topic?.match(/ticketType:([^|]+)/)?.[1]?.trim() || "לא ידוע";
}

async function setTicketClaimedBy(channel, userId) {
  const ownerId = getTicketOwnerId(channel);
  const type = getTicketType(channel);

  await channel.setTopic(
    `ticketOwner:${ownerId || "unknown"} | ticketType:${type} | claimedBy:${userId || "none"}`
  ).catch(error => {
    console.error("❌ Failed to update ticket topic:", error);
  });
}

function ticketButtons(claimedById = null) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("claim_ticket")
      .setLabel("Claim Ticket")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(claimedById)),

    new ButtonBuilder()
      .setCustomId("release_ticket")
      .setLabel("Release Ticket")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!claimedById),

    new ButtonBuilder()
      .setCustomId("add_user_ticket")
      .setLabel("Add User")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!claimedById),

    new ButtonBuilder()
      .setCustomId("remove_user_ticket")
      .setLabel("Remove User")
      .setEmoji("➖")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!claimedById),

    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

async function transcript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = [...messages.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  let text = `Transcript for #${channel.name}\n\n`;

  for (const msg of sorted) {
    text += `[${msg.createdAt.toLocaleString("he-IL")}] ${msg.author.tag}: ${msg.content || "[בלי טקסט]"}\n`;

    msg.attachments.forEach(att => {
      text += `Attachment: ${att.url}\n`;
    });
  }

  return new AttachmentBuilder(Buffer.from(text, "utf8"), {
    name: `${channel.name}-transcript.txt`
  });
}

async function modLog(guild, embed) {
  if (!config.modLogsChannelId) return;

  const channel = guild.channels.cache.get(config.modLogsChannelId);

  if (channel?.isTextBased()) {
    await channel.send({ embeds: [embed] }).catch(error => {
      console.error("❌ Mod log error:", error);
    });
  }
}

async function openTicket(interaction, data) {
  if (
    !config.ticketCategoryId ||
    !config.ticketStaffRoleId ||
    !config.ticketLogsChannelId
  ) {
    return interaction.reply({
      content: "❌ חסרים IDs של מערכת הטיקטים ב־config.js.",
      ephemeral: true
    });
  }

  const existing = interaction.guild.channels.cache.find(ch =>
    ch.topic?.includes(`ticketOwner:${interaction.user.id}`)
  );

  if (existing) {
    return interaction.reply({
      content: `❌ כבר יש לך טיקט פתוח: ${existing}`,
      ephemeral: true
    });
  }

  const safe = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9א-ת]/g, "-")
    .slice(0, 20);

  const channel = await interaction.guild.channels.create({
    name: `ticket-${safe}`,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId,
    topic: `ticketOwner:${interaction.user.id} | ticketType:${data.name} | claimedBy:none`,
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
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: config.ticketStaffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages
        ]
      }
    ]
  });

  const embed = new EmbedBuilder()
    .setColor("Blue")
    .setTitle(`${data.emoji} טיקט חדש`)
    .setDescription(
      `👤 משתמש: ${interaction.user}\n` +
      `📌 סוג טיקט: **${data.name}**`
    )
    .setTimestamp();

  await channel.send({
    content: `<@&${config.ticketStaffRoleId}>`,
    embeds: [embed],
    components: [ticketButtons()],
    allowedMentions: {
      roles: [config.ticketStaffRoleId]
    }
  });

  return interaction.reply({
    content: `✅ הטיקט נפתח: ${channel}`,
    ephemeral: true
  });
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  console.log(`✅ Bot ID: ${readyClient.user.id}`);
  console.log(`✅ Servers: ${readyClient.guilds.cache.size}`);

  try {
    await registerSlashCommands();
    await checkModTimers();

    setInterval(() => {
      checkModTimers().catch(error => {
        console.error("❌ Timer check error:", error);
      });
    }, 15 * 1000);
  } catch (error) {
    console.error(
      "❌ Slash command registration failed:",
      error
    );
  }
});


function buildHelpEmbed() {
  return new EmbedBuilder()
    .setColor("Blue")
    .setTitle("📚 Help")
    .setDescription(
      [
        "**בדיקת הבוט**",
        "`/ping` — בודק אם הבוט עובד",
        "",
        "**טיקטים**",
        "`/ticket-panel` — שולח פאנל טיקטים",
        "",
        "**רולים**",
        "`/giverole user role` — נותן רול למשתמש",
        "",
        "**מודרציה**",
        "`/warn` — אזהרה",
        "`/timeout` — Timeout",
        "`/kick` — Kick",
        "`/ban` — Ban",
        "`/clear` — מחיקת הודעות",
        "",
        "**Chat Mute**",
        "`/mute user duration reason` — Chat Mute זמני",
        "`/unmute user reason` — מסיר Chat Mute",
        "",
        "**Voice**",
        "`/voice-mute user duration reason` — Voice Mute זמני",
        "`/voice-unmute user reason` — מסיר Voice Mute",
        "`/voice-deafen user duration reason` — Voice Deafen זמני",
        "`/voice-undeafen user reason` — מסיר Voice Deafen",
        "",
        "**זמנים נתמכים**",
        "`30s` / `10m` / `2h` / `3d`",
        "",
        `גם \`${config.prefix || "!"}h\` מציג את ההודעה הזאת.`
      ].join("\n")
    )
    .setTimestamp();
}

client.on(Events.MessageCreate, async message => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    const prefix = config.prefix || "!";
    const content = String(message.content || "")
      .trim()
      .toLowerCase();

    if (content !== `${prefix}h`.toLowerCase()) {
      return;
    }

    return message.reply({
      embeds: [buildHelpEmbed()]
    });
  } catch (error) {
    console.error("❌ !h error:", error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") {
        return interaction.reply({
          content: `🏓 Pong! ${client.ws.ping}ms`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "help") {
        return interaction.reply({
          embeds: [buildHelpEmbed()],
          ephemeral: true
        });
      }

      if (interaction.commandName === "giverole") {
        if (
          !interaction.member.permissions.has(
            PermissionFlagsBits.ManageRoles
          ) &&
          !interaction.member.permissions.has(
            PermissionFlagsBits.Administrator
          )
        ) {
          return interaction.reply({
            content: "❌ אין לך הרשאה לתת רולים.",
            ephemeral: true
          });
        }

        const user = interaction.options.getUser("user");
        const role = interaction.options.getRole("role");

        const member = await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

        if (!member) {
          return interaction.reply({
            content: "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        const botMember = interaction.guild.members.me;

        if (
          !botMember?.permissions.has(
            PermissionFlagsBits.ManageRoles
          )
        ) {
          return interaction.reply({
            content: "❌ לבוט אין הרשאת Manage Roles.",
            ephemeral: true
          });
        }

        if (role.id === interaction.guild.id) {
          return interaction.reply({
            content: "❌ אי אפשר לתת את רול @everyone.",
            ephemeral: true
          });
        }

        if (role.managed) {
          return interaction.reply({
            content:
              "❌ אי אפשר לתת את הרול הזה כי הוא מנוהל על ידי בוט או אינטגרציה.",
            ephemeral: true
          });
        }

        if (role.position >= botMember.roles.highest.position) {
          return interaction.reply({
            content:
              "❌ הרול הזה גבוה מדי. שים את הרול של הבוט מעליו בהגדרות השרת.",
            ephemeral: true
          });
        }

        const executorIsAdmin = interaction.member.permissions.has(
          PermissionFlagsBits.Administrator
        );

        if (
          !executorIsAdmin &&
          role.position >= interaction.member.roles.highest.position
        ) {
          return interaction.reply({
            content:
              "❌ אי אפשר לתת רול ששווה או גבוה מהרול הגבוה ביותר שלך.",
            ephemeral: true
          });
        }

        if (member.roles.cache.has(role.id)) {
          return interaction.reply({
            content: `⚠️ ${user} כבר מחזיק ברול ${role}.`,
            ephemeral: true
          });
        }

        await member.roles.add(
          role,
          `Role given by ${interaction.user.tag}`
        );

        await modLog(
          interaction.guild,
          new EmbedBuilder()
            .setColor("Green")
            .setTitle("🎭 Role Added")
            .addFields(
              { name: "משתמש", value: `${user}` },
              { name: "רול", value: `${role}` },
              { name: "צוות", value: `${interaction.user}` }
            )
            .setTimestamp()
        );

        return interaction.reply({
          content: `✅ נתתי ל־${user} את הרול ${role}.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "ticket-panel") {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: "❌ אין לך גישה.",
            ephemeral: true
          });
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId("ticket_type_select")
          .setPlaceholder("בחר סוג טיקט")
          .addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel("זכייה בהגרלה")
              .setEmoji("🎉")
              .setValue("giveaway"),

            new StringSelectMenuOptionBuilder()
              .setLabel("זכייה במלך אמר")
              .setEmoji("👑")
              .setValue("king_says"),

            new StringSelectMenuOptionBuilder()
              .setLabel("דיווח על שחקנים")
              .setEmoji("❗")
              .setValue("report"),

            new StringSelectMenuOptionBuilder()
              .setLabel("בחינה לשוטר ואבטחה")
              .setEmoji("👮")
              .setValue("police")
          );

        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor("Blue")
              .setTitle("🎫 Tickets")
              .setDescription("בחר סוג טיקט.")
          ],
          components: [
            new ActionRowBuilder().addComponents(menu)
          ]
        });

        return interaction.reply({
          content: "✅ נשלח.",
          ephemeral: true
        });
      }

      if (
        [
          "warn",
          "timeout",
          "kick",
          "ban",
          "clear",
          "mute",
          "unmute",
          "voice-mute",
          "voice-unmute",
          "voice-deafen",
          "voice-undeafen"
        ].includes(interaction.commandName)
      ) {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: "❌ אין לך גישה.",
            ephemeral: true
          });
        }
      }

      if (
        ["mute", "unmute"].includes(interaction.commandName)
      ) {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: "❌ אין לך גישה.",
            ephemeral: true
          });
        }

        if (!config.muteRoleId) {
          return interaction.reply({
            content: "❌ חסר muteRoleId ב־config.js.",
            ephemeral: true
          });
        }

        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const member = await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

        if (!member) {
          return interaction.reply({
            content: "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        const muteRole = await interaction.guild.roles
          .fetch(config.muteRoleId)
          .catch(() => null);

        if (!muteRole) {
          return interaction.reply({
            content: "❌ לא מצאתי את רול ה־Chat Mute.",
            ephemeral: true
          });
        }

        if (interaction.commandName === "mute") {
          const durationText =
            interaction.options.getString("duration");
          const duration = parseDuration(durationText);

          if (!duration) {
            return interaction.reply({
              content:
                "❌ זמן לא תקין. השתמש ב־30s, 10m, 2h או 3d. " +
                "המינימום 10 שניות והמקסימום 30 ימים.",
              ephemeral: true
            });
          }

          await member.roles.add(
            muteRole,
            `${reason} | by ${interaction.user.tag}`
          );

          addModTimer({
            guildId: interaction.guild.id,
            userId: user.id,
            type: "chat-mute",
            expiresAt: Date.now() + duration,
            reason,
            moderatorId: interaction.user.id
          });

          await modLog(
            interaction.guild,
            new EmbedBuilder()
              .setColor("Orange")
              .setTitle("🔇 Chat Mute")
              .addFields(
                { name: "משתמש", value: `${user}` },
                { name: "זמן", value: formatDuration(duration) },
                { name: "צוות", value: `${interaction.user}` },
                { name: "סיבה", value: reason }
              )
              .setTimestamp()
          );

          return interaction.reply({
            content:
              `✅ ${user} קיבל Chat Mute ל־**${formatDuration(duration)}**.`,
            ephemeral: true
          });
        }

        await member.roles.remove(
          muteRole,
          `${reason} | by ${interaction.user.tag}`
        );

        removeModTimer(
          interaction.guild.id,
          user.id,
          "chat-mute"
        );

        await modLog(
          interaction.guild,
          new EmbedBuilder()
            .setColor("Green")
            .setTitle("🔊 Chat Unmute")
            .addFields(
              { name: "משתמש", value: `${user}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            )
            .setTimestamp()
        );

        return interaction.reply({
          content: `✅ ה־Chat Mute הוסר מ־${user}.`,
          ephemeral: true
        });
      }

      if (
        [
          "voice-mute",
          "voice-unmute",
          "voice-deafen",
          "voice-undeafen"
        ].includes(interaction.commandName)
      ) {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: "❌ אין לך גישה.",
            ephemeral: true
          });
        }

        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const member = await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

        if (!member) {
          return interaction.reply({
            content: "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        if (!member.voice.channel) {
          return interaction.reply({
            content: "❌ המשתמש לא נמצא כרגע ב־Voice.",
            ephemeral: true
          });
        }

        const action = interaction.commandName;

        if (
          action === "voice-mute" ||
          action === "voice-deafen"
        ) {
          const durationText =
            interaction.options.getString("duration");
          const duration = parseDuration(durationText);

          if (!duration) {
            return interaction.reply({
              content:
                "❌ זמן לא תקין. השתמש ב־30s, 10m, 2h או 3d. " +
                "המינימום 10 שניות והמקסימום 30 ימים.",
              ephemeral: true
            });
          }

          if (action === "voice-mute") {
            await member.voice.setMute(
              true,
              `${reason} | by ${interaction.user.tag}`
            );

            addModTimer({
              guildId: interaction.guild.id,
              userId: user.id,
              type: "voice-mute",
              expiresAt: Date.now() + duration,
              reason,
              moderatorId: interaction.user.id
            });

            await modLog(
              interaction.guild,
              new EmbedBuilder()
                .setColor("Orange")
                .setTitle("🔇 Voice Mute")
                .addFields(
                  { name: "משתמש", value: `${user}` },
                  { name: "זמן", value: formatDuration(duration) },
                  { name: "צוות", value: `${interaction.user}` },
                  { name: "סיבה", value: reason }
                )
                .setTimestamp()
            );

            return interaction.reply({
              content:
                `✅ ${user} קיבל Voice Mute ל־**${formatDuration(duration)}**.`,
              ephemeral: true
            });
          }

          await member.voice.setDeaf(
            true,
            `${reason} | by ${interaction.user.tag}`
          );

          addModTimer({
            guildId: interaction.guild.id,
            userId: user.id,
            type: "voice-deafen",
            expiresAt: Date.now() + duration,
            reason,
            moderatorId: interaction.user.id
          });

          await modLog(
            interaction.guild,
            new EmbedBuilder()
              .setColor("DarkOrange")
              .setTitle("🎧 Voice Deafen")
              .addFields(
                { name: "משתמש", value: `${user}` },
                { name: "זמן", value: formatDuration(duration) },
                { name: "צוות", value: `${interaction.user}` },
                { name: "סיבה", value: reason }
              )
              .setTimestamp()
          );

          return interaction.reply({
            content:
              `✅ ${user} קיבל Voice Deafen ל־**${formatDuration(duration)}**.`,
            ephemeral: true
          });
        }

        if (action === "voice-unmute") {
          await member.voice.setMute(
            false,
            `${reason} | by ${interaction.user.tag}`
          );

          removeModTimer(
            interaction.guild.id,
            user.id,
            "voice-mute"
          );

          return interaction.reply({
            content: `✅ ה־Voice Mute הוסר מ־${user}.`,
            ephemeral: true
          });
        }

        await member.voice.setDeaf(
          false,
          `${reason} | by ${interaction.user.tag}`
        );

        removeModTimer(
          interaction.guild.id,
          user.id,
          "voice-deafen"
        );

        return interaction.reply({
          content: `✅ ה־Voice Deafen הוסר מ־${user}.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "warn") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        await user.send(
          `⚠️ קיבלת אזהרה בשרת **${interaction.guild.name}**.\n` +
          `סיבה: ${reason}`
        ).catch(() => {});

        await modLog(
          interaction.guild,
          new EmbedBuilder()
            .setColor("Yellow")
            .setTitle("⚠️ Warn")
            .addFields(
              { name: "משתמש", value: `${user}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            )
            .setTimestamp()
        );

        return interaction.reply({
          content: `✅ ${user} קיבל אזהרה.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "timeout") {
        const user = interaction.options.getUser("user");
        const minutes =
          interaction.options.getInteger("minutes");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const member = await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

        if (!member?.moderatable) {
          return interaction.reply({
            content:
              "❌ אי אפשר לעשות Timeout למשתמש הזה.",
            ephemeral: true
          });
        }

        await member.timeout(
          minutes * 60000,
          `${reason} | by ${interaction.user.tag}`
        );

        await modLog(
          interaction.guild,
          new EmbedBuilder()
            .setColor("Orange")
            .setTitle("⏳ Timeout")
            .addFields(
              { name: "משתמש", value: `${user}` },
              { name: "זמן", value: `${minutes} דקות` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            )
            .setTimestamp()
        );

        return interaction.reply({
          content:
            `✅ ${user} קיבל Timeout ל־${minutes} דקות.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "kick") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const member = await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

        if (!member?.kickable) {
          return interaction.reply({
            content: "❌ אי אפשר להעיף את המשתמש.",
            ephemeral: true
          });
        }

        await member.kick(
          `${reason} | by ${interaction.user.tag}`
        );

        await modLog(
          interaction.guild,
          new EmbedBuilder()
            .setColor("Red")
            .setTitle("👢 Kick")
            .addFields(
              { name: "משתמש", value: `${user.tag}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            )
            .setTimestamp()
        );

        return interaction.reply({
          content: `✅ ${user.tag} הועף.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "ban") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        await interaction.guild.members.ban(user.id, {
          reason:
            `${reason} | by ${interaction.user.tag}`
        });

        await modLog(
          interaction.guild,
          new EmbedBuilder()
            .setColor("DarkRed")
            .setTitle("🔨 Ban")
            .addFields(
              { name: "משתמש", value: `${user.tag}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            )
            .setTimestamp()
        );

        return interaction.reply({
          content: `✅ ${user.tag} קיבל באן.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "clear") {
        const amount =
          interaction.options.getInteger("amount");

        const deleted =
          await interaction.channel.bulkDelete(amount, true);

        return interaction.reply({
          content:
            `✅ נמחקו ${deleted.size} הודעות.`,
          ephemeral: true
        });
      }
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "ticket_type_select"
    ) {
      const types = {
        giveaway: {
          name: "זכייה בהגרלה",
          emoji: "🎉"
        },
        king_says: {
          name: "זכייה במלך אמר",
          emoji: "👑"
        },
        report: {
          name: "דיווח על שחקנים",
          emoji: "❗"
        },
        police: {
          name: "בחינה לשוטר ואבטחה",
          emoji: "👮"
        }
      };

      return openTicket(
        interaction,
        types[interaction.values[0]]
      );
    }

    if (interaction.isButton()) {
      if (interaction.customId === "claim_ticket") {
        if (!isTicketStaff(interaction.member)) {
          return interaction.reply({
            content:
              "❌ רק צוות יכול לקחת טיקט.",
            ephemeral: true
          });
        }

        const claimed =
          getTicketClaimedById(interaction.channel);

        if (claimed && claimed !== "none") {
          return interaction.reply({
            content:
              `❌ הטיקט כבר נלקח על ידי <@${claimed}>.`,
            ephemeral: true
          });
        }

        await setTicketClaimedBy(
          interaction.channel,
          interaction.user.id
        );

        return interaction.update({
          components: [
            ticketButtons(interaction.user.id)
          ]
        });
      }

      if (interaction.customId === "release_ticket") {
        const claimed =
          getTicketClaimedById(interaction.channel);

        if (claimed !== interaction.user.id) {
          return interaction.reply({
            content:
              "❌ רק מי שלקח את הטיקט יכול לשחרר אותו.",
            ephemeral: true
          });
        }

        await setTicketClaimedBy(
          interaction.channel,
          null
        );

        return interaction.update({
          components: [ticketButtons()]
        });
      }

      if (interaction.customId === "add_user_ticket") {
        const claimed =
          getTicketClaimedById(interaction.channel);

        if (claimed !== interaction.user.id) {
          return interaction.reply({
            content:
              "❌ רק מי שלקח את הטיקט יכול להוסיף משתמש.",
            ephemeral: true
          });
        }

        const menu = new UserSelectMenuBuilder()
          .setCustomId("ticket_add_user_select")
          .setPlaceholder("בחר משתמש להוספה");

        return interaction.reply({
          content: "בחר משתמש:",
          components: [
            new ActionRowBuilder().addComponents(menu)
          ],
          ephemeral: true
        });
      }

      if (interaction.customId === "remove_user_ticket") {
        const claimed =
          getTicketClaimedById(interaction.channel);

        if (claimed !== interaction.user.id) {
          return interaction.reply({
            content:
              "❌ רק מי שלקח את הטיקט יכול להסיר משתמש.",
            ephemeral: true
          });
        }

        const menu = new UserSelectMenuBuilder()
          .setCustomId("ticket_remove_user_select")
          .setPlaceholder("בחר משתמש להסרה");

        return interaction.reply({
          content: "בחר משתמש:",
          components: [
            new ActionRowBuilder().addComponents(menu)
          ],
          ephemeral: true
        });
      }

      if (interaction.customId === "close_ticket") {
        if (!isTicketStaff(interaction.member)) {
          return interaction.reply({
            content:
              "❌ רק צוות יכול לסגור טיקט.",
            ephemeral: true
          });
        }

        const logs =
          interaction.guild.channels.cache.get(
            config.ticketLogsChannelId
          );

        const file =
          await transcript(interaction.channel)
            .catch(() => null);

        if (logs?.isTextBased()) {
          await logs.send({
            content:
              `🔒 טיקט נסגר\n` +
              `🎫 ${interaction.channel.name}\n` +
              `👤 על ידי ${interaction.user}`,
            files: file ? [file] : []
          }).catch(() => {});
        }

        await interaction.reply(
          "🔒 הטיקט ייסגר בעוד 5 שניות..."
        );

        setTimeout(() => {
          interaction.channel.delete().catch(() => {});
        }, 5000);

        return;
      }
    }

    if (interaction.isUserSelectMenu()) {
      if (
        interaction.customId ===
        "ticket_add_user_select"
      ) {
        const userId = interaction.values[0];

        await interaction.channel.permissionOverwrites.edit(
          userId,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          }
        );

        return interaction.update({
          content:
            `✅ <@${userId}> נוסף לטיקט.`,
          components: []
        });
      }

      if (
        interaction.customId ===
        "ticket_remove_user_select"
      ) {
        const userId = interaction.values[0];
        const ownerId =
          getTicketOwnerId(interaction.channel);
        const claimedId =
          getTicketClaimedById(interaction.channel);

        if (
          userId === ownerId ||
          userId === claimedId
        ) {
          return interaction.update({
            content:
              "❌ אי אפשר להסיר את המשתמש הזה.",
            components: []
          });
        }

        const member =
          await interaction.guild.members
            .fetch(userId)
            .catch(() => null);

        if (
          member?.roles.cache.has(
            config.ticketStaffRoleId
          )
        ) {
          return interaction.update({
            content:
              "❌ אי אפשר להסיר Staff.",
            components: []
          });
        }

        await interaction.channel.permissionOverwrites
          .delete(userId)
          .catch(() => {});

        return interaction.update({
          content:
            `✅ <@${userId}> הוסר מהטיקט.`,
          components: []
        });
      }
    }
  } catch (error) {
    console.error("❌ Interaction error:", error);

    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({
        content:
          "❌ הייתה שגיאה בביצוע הפעולה.",
        ephemeral: true
      }).catch(() => {});
    }

    return interaction.reply({
      content:
        "❌ הייתה שגיאה בביצוע הפעולה.",
      ephemeral: true
    }).catch(() => {});
  }
});

if (!process.env.TOKEN) {
  console.log(
    "❌ TOKEN missing in .env — הבוט לא יכול להתחבר."
  );
  process.exit(1);
}

console.log("🔄 Connecting to Discord...");

client.login(process.env.TOKEN)
  .then(() => {
    console.log("✅ Login request sent successfully.");
  })
  .catch(error => {
    console.error("❌ Login failed:", error);
    process.exit(1);
  });
