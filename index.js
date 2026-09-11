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
const XP_FILE = path.join(DATA_DIR, "xp.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJson(file, fallback) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const xpData = loadJson(XP_FILE, {});
const xpCooldown = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

function isStaff(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    (config.staffRoleId && member?.roles?.cache?.has(config.staffRoleId))
  );
}

function hasTicketConfig() {
  return Boolean(
    config.ticketCategoryId &&
    config.ticketStaffRoleId &&
    config.ticketLogsChannelId
  );
}

// כמו ב-Sales Bot: רק רול צוות הטיקטים יכול Claim/Close.
function isTicketStaff(member) {
  return Boolean(member?.roles?.cache?.has(config.ticketStaffRoleId));
}

function levelNeed(level) {
  return 100 + level * 50;
}

function getXp(guildId, userId) {
  xpData[guildId] ??= {};
  xpData[guildId][userId] ??= { xp: 0, level: 0, total: 0 };
  return xpData[guildId][userId];
}

function addXp(guildId, userId, amount) {
  const data = getXp(guildId, userId);
  data.xp += amount;
  data.total += amount;
  let leveled = false;

  while (data.xp >= levelNeed(data.level)) {
    data.xp -= levelNeed(data.level);
    data.level++;
    leveled = true;
  }

  saveJson(XP_FILE, xpData);
  return { ...data, leveled };
}

function buildHelpRequestEmbed(user, reason, requestId, handler = null) {
  return new EmbedBuilder()
    .setColor(handler ? "Green" : "DarkGreen")
    .setTitle("🚨 בקשת עזרה חדשה")
    .addFields(
      { name: "משתמש:", value: `${user}`, inline: false },
      { name: "סיבה:", value: reason || "לא צוינה סיבה", inline: false },
      { name: "סטטוס:", value: handler ? "✅ נמצא בטיפול" : "❌ לא נמצא בטיפול", inline: false },
      { name: "סטטוס טיפול:", value: handler ? `✅ בטיפול על ידי ${handler}` : "❌ אף אחד", inline: false }
    )
    .setFooter({ text: `ID: ${requestId}` })
    .setTimestamp();
}

// =====================
// VERIFY — כמו ב-Sales Bot
// =====================

async function sendVerifyPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor("Blue")
    .setTitle("Verify ✅")
    .setDescription("לחץ על הכפתור, תקבל מספר, ואז תלחץ על המספר הנכון.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("start_verify")
      .setLabel("Verify")
      .setStyle(ButtonStyle.Success)
  );

  return channel.send({ embeds: [embed], components: [row] });
}

// =====================
// TICKETS — מבוסס על Sales Bot
// =====================

const TICKET_TYPES = {
  complaint: { name: "תלונה על ממבר/חבר צוות", emoji: "⚠️" },
  question: { name: "שאלה כללית", emoji: "🚨" },
  giveaway: { name: "זכייה בהגרלה", emoji: "🎁" },
  general_help: { name: "עזרה כללית", emoji: "🔔" },
  staff_test: { name: "בחינה לצוות", emoji: "<:Master_Heart:807709273134989324>" },
  other: { name: "אחר", emoji: "📩" }
};

function getTicketOwner(channel) {
  return channel.topic?.match(/ticketOwner:(\d{17,20})/)?.[1] || null;
}

function getTicketClaimedBy(channel) {
  return channel.topic?.match(/claimedBy:(\d{17,20})/)?.[1] || null;
}

function getTicketType(channel) {
  return channel.topic?.match(/ticketType:([^|]+)/)?.[1]?.trim() || "לא ידוע";
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
      .setCustomId("claim_sales_ticket")
      .setLabel("Claim Ticket")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(claimedById)),
    new ButtonBuilder()
      .setCustomId("release_sales_ticket")
      .setLabel("Release Ticket")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!claimedById),
    new ButtonBuilder()
      .setCustomId("add_user_sales_ticket")
      .setLabel("Add User")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!claimedById),
    new ButtonBuilder()
      .setCustomId("remove_user_sales_ticket")
      .setLabel("Remove User")
      .setEmoji("➖")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!claimedById),
    new ButtonBuilder()
      .setCustomId("close_sales_ticket")
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

async function createTicketTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = [...messages.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  let transcript = `Transcript for #${channel.name}\n`;
  transcript += `Channel ID: ${channel.id}\n`;
  transcript += `Created At: ${new Date().toLocaleString("he-IL")}\n\n`;

  for (const msg of sorted) {
    transcript += `[${msg.createdAt.toLocaleString("he-IL")}] ${msg.author.tag}: ${msg.content || "[בלי טקסט]"}\n`;
    msg.attachments.forEach(att => {
      transcript += `Attachment: ${att.url}\n`;
    });
  }

  return new AttachmentBuilder(Buffer.from(transcript, "utf8"), {
    name: `${channel.name}-transcript.txt`
  });
}

async function openTicket(interaction, ticketData) {
  if (!hasTicketConfig()) {
    return interaction.reply({
      content: "❌ חסרים IDs של טיקטים ב־config.js.",
      ephemeral: true
    });
  }

  const existingChannel = interaction.guild.channels.cache.find(channel =>
    channel.topic?.includes(`ticketOwner:${interaction.user.id}`)
  );

  if (existingChannel) {
    return interaction.reply({
      content: `❌ כבר יש לך טיקט פתוח: ${existingChannel}`,
      ephemeral: true
    });
  }

  const safeName = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9א-ת]/g, "-")
    .slice(0, 20);

  const ticketChannel = await interaction.guild.channels.create({
    name: `ticket-${safeName}`,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId,
    topic: `ticketOwner:${interaction.user.id} | ticketType:${ticketData.name}`,
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

  await ticketChannel.send({
    content:
`${ticketData.emoji} **טיקט חדש נפתח**

👤 משתמש: <@${interaction.user.id}>
📌 סוג טיקט: **${ticketData.name}**

<@&${config.ticketStaffRoleId}>`,
    components: [buildTicketButtons()],
    allowedMentions: {
      users: [interaction.user.id],
      roles: [config.ticketStaffRoleId]
    }
  });

  return interaction.reply({
    content: `✅ הטיקט שלך נפתח: ${ticketChannel}`,
    ephemeral: true
  });
}

client.once(Events.ClientReady, readyClient => {
  console.log(`✅ Nadav Server Bot logged in as ${readyClient.user.tag}`);
});

// =====================
// PREFIX + XP
// =====================

client.on(Events.MessageCreate, async message => {
  try {
    if (!message.guild || message.author.bot) return;

    const key = `${message.guild.id}:${message.author.id}`;
    const last = xpCooldown.get(key) || 0;

    if (Date.now() - last >= 60000) {
      xpCooldown.set(key, Date.now());
      const result = addXp(
        message.guild.id,
        message.author.id,
        15 + Math.floor(Math.random() * 11)
      );

      if (result.leveled) {
        await message.channel.send(
          `🎉 ${message.author}, עלית לרמה **${result.level}**!`
        ).catch(() => {});
      }
    }

    const prefix = config.prefix || "!";
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();

    if (command === "h" || command === "help") {
      const reason = args.join(" ").trim() || "לא צוינה סיבה";
      const requestId = Date.now().toString();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`take_help_request:${message.author.id}:${requestId}`)
          .setLabel("בטיפול")
          .setStyle(ButtonStyle.Primary)
      );

      return message.channel.send({
        content: config.staffRoleId ? `<@&${config.staffRoleId}>` : undefined,
        embeds: [buildHelpRequestEmbed(message.author, reason, requestId)],
        components: [row],
        allowedMentions: config.staffRoleId ? { roles: [config.staffRoleId] } : undefined
      });
    }

    if (command === "rank") {
      const user = message.mentions.users.first() || message.author;
      const data = getXp(message.guild.id, user.id);

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("Gold")
            .setTitle(`⭐ Rank — ${user.username}`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
              { name: "Level", value: `${data.level}`, inline: true },
              { name: "XP", value: `${data.xp}/${levelNeed(data.level)}`, inline: true },
              { name: "Total XP", value: `${data.total}`, inline: true }
            )
        ]
      });
    }

    if (command === "top") {
      const top = Object.entries(xpData[message.guild.id] || {})
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10);

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("Gold")
            .setTitle("🏆 XP Leaderboard")
            .setDescription(
              top.length
                ? top.map(([id, d], i) =>
                    `**${i + 1}.** <@${id}> — Level **${d.level}** | ${d.total} XP`
                  ).join("\n")
                : "אין עדיין נתוני XP."
            )
        ]
      });
    }
  } catch (error) {
    console.error("❌ Message error:", error);
  }
});

// =====================
// INTERACTIONS
// =====================

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") {
        return interaction.reply({ content: "Pong ✅", ephemeral: true });
      }

      if (interaction.commandName === "verify-panel") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: "❌ אין לך גישה.", ephemeral: true });
        }

        await sendVerifyPanel(interaction.channel);
        return interaction.reply({
          content: "שלחתי פאנל Verify ✅",
          ephemeral: true
        });
      }

      if (interaction.commandName === "ticket-panel") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: "❌ אין לך גישה.", ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setColor("Blue")
          .setTitle("🎫 Tickets")
          .setDescription("לחץ על הכפתור כדי לבחור סוג טיקט.");

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("open_ticket_select")
            .setLabel("בחר סוג טיקט")
            .setEmoji("🎫")
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.channel.send({
          embeds: [embed],
          components: [row]
        });

        return interaction.reply({
          content: "✅ פאנל הטיקטים נשלח.",
          ephemeral: true
        });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId !== "ticket_type_select") return;
      return openTicket(interaction, TICKET_TYPES[interaction.values[0]]);
    }

    if (interaction.isUserSelectMenu()) {
      if (
        interaction.customId !== "ticket_add_user_select" &&
        interaction.customId !== "ticket_remove_user_select"
      ) return;

      const claimedById = getTicketClaimedBy(interaction.channel);

      if (!claimedById) {
        return interaction.reply({
          content: "❌ הטיקט לא נמצא כרגע ב־Claim.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== claimedById) {
        return interaction.reply({
          content: "❌ רק מי שלקח את הטיקט יכול להוסיף או להסיר משתמשים.",
          ephemeral: true
        });
      }

      const selectedUser = interaction.users.first();
      const ticketOwnerId = getTicketOwner(interaction.channel);

      if (interaction.customId === "ticket_add_user_select") {
        await interaction.channel.permissionOverwrites.edit(
          selectedUser.id,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          },
          { reason: `Added to ticket by ${interaction.user.tag}` }
        );

        return interaction.update({
          content: `✅ ${selectedUser} נוסף לטיקט.`,
          components: []
        });
      }

      if (selectedUser.id === ticketOwnerId) {
        return interaction.update({
          content: "❌ אי אפשר להסיר את מי שפתח את הטיקט.",
          components: []
        });
      }

      if (selectedUser.id === claimedById) {
        return interaction.update({
          content: "❌ אי אפשר להסיר את מי שלקח את הטיקט.",
          components: []
        });
      }

      const selectedMember = await interaction.guild.members
        .fetch(selectedUser.id)
        .catch(() => null);

      if (selectedMember?.roles.cache.has(config.ticketStaffRoleId)) {
        return interaction.update({
          content: "❌ אי אפשר להסיר איש צוות מהטיקט.",
          components: []
        });
      }

      await interaction.channel.permissionOverwrites
        .delete(
          selectedUser.id,
          `Removed from ticket by ${interaction.user.tag}`
        )
        .catch(() => null);

      return interaction.update({
        content: `✅ ${selectedUser} הוסר מהטיקט.`,
        components: []
      });
    }

    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith("take_help_request:")) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ רק צוות יכול לקחת בקשות עזרה.",
          ephemeral: true
        });
      }

      const [, requesterId, requestId] = interaction.customId.split(":");
      const requester = await interaction.guild.members.fetch(requesterId).catch(() => null);
      const reason = interaction.message.embeds[0]?.fields?.find(field => field.name === "סיבה:")?.value || "לא צוינה סיבה";

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`take_help_request:${requesterId}:${requestId}`)
          .setLabel("בטיפול")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true)
      );

      return interaction.update({
        embeds: [buildHelpRequestEmbed(requester || `<@${requesterId}>`, reason, requestId, interaction.user)],
        components: [row]
      });
    }

    if (interaction.customId === "open_ticket_select") {
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ticket_type_select")
          .setPlaceholder("בחר סוג טיקט")
          .addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel("תלונה על ממבר/חבר צוות")
              .setEmoji("⚠️")
              .setValue("complaint"),
            new StringSelectMenuOptionBuilder()
              .setLabel("שאלה כללית")
              .setEmoji({ id: "1515677093604622418" })
              .setValue("question"),
            new StringSelectMenuOptionBuilder()
              .setLabel("זכייה בהגרלה")
              .setEmoji("🎁")
              .setValue("giveaway"),
            new StringSelectMenuOptionBuilder()
              .setLabel("עזרה כללית")
              .setEmoji("🔔")
              .setValue("general_help"),
            new StringSelectMenuOptionBuilder()
              .setLabel("בחינה לצוות")
              .setEmoji({ id: "807709273134989324" })
              .setValue("staff_test"),
            new StringSelectMenuOptionBuilder()
              .setLabel("אחר")
              .setEmoji("📩")
              .setValue("other")
          )
      );

      return interaction.reply({
        content: "בחר את סוג הטיקט:",
        components: [row],
        ephemeral: true
      });
    }

    if (interaction.customId === "claim_sales_ticket") {
      if (!isTicketStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ רק צוות יכול לקחת טיקטים.",
          ephemeral: true
        });
      }

      const alreadyClaimedBy = getTicketClaimedBy(interaction.channel);

      if (alreadyClaimedBy) {
        return interaction.reply({
          content: `❌ הטיקט כבר נלקח על ידי <@${alreadyClaimedBy}>.`,
          ephemeral: true
        });
      }

      await setTicketClaimedBy(interaction.channel, interaction.user.id);

      await interaction.update({
        components: [buildTicketButtons(interaction.user.id)]
      });

      return interaction.channel.send(
        `🙋 הטיקט נלקח על ידי <@${interaction.user.id}>`
      ).catch(() => {});
    }

    if (interaction.customId === "release_sales_ticket") {
      const claimedById = getTicketClaimedBy(interaction.channel);

      if (!claimedById) {
        return interaction.reply({
          content: "❌ הטיקט כבר משוחרר.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== claimedById) {
        return interaction.reply({
          content: "❌ רק מי שלקח את הטיקט יכול לשחרר אותו.",
          ephemeral: true
        });
      }

      await setTicketClaimedBy(interaction.channel, null);

      await interaction.update({
        components: [buildTicketButtons()]
      });

      return interaction.channel.send(
        `🔓 <@${interaction.user.id}> שחרר את הטיקט. עכשיו איש צוות אחר יכול לקחת אותו.`
      ).catch(() => {});
    }

    if (interaction.customId === "add_user_sales_ticket") {
      const claimedById = getTicketClaimedBy(interaction.channel);

      if (!claimedById || interaction.user.id !== claimedById) {
        return interaction.reply({
          content: "❌ רק מי שלקח את הטיקט יכול להוסיף משתמשים.",
          ephemeral: true
        });
      }

      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId("ticket_add_user_select")
          .setPlaceholder("בחר משתמש להוסיף לטיקט")
          .setMinValues(1)
          .setMaxValues(1)
      );

      return interaction.reply({
        content: "➕ בחר משתמש להוסיף לטיקט:",
        components: [row],
        ephemeral: true
      });
    }

    if (interaction.customId === "remove_user_sales_ticket") {
      const claimedById = getTicketClaimedBy(interaction.channel);

      if (!claimedById || interaction.user.id !== claimedById) {
        return interaction.reply({
          content: "❌ רק מי שלקח את הטיקט יכול להסיר משתמשים.",
          ephemeral: true
        });
      }

      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId("ticket_remove_user_select")
          .setPlaceholder("בחר משתמש להסיר מהטיקט")
          .setMinValues(1)
          .setMaxValues(1)
      );

      return interaction.reply({
        content: "➖ בחר משתמש להסיר מהטיקט:",
        components: [row],
        ephemeral: true
      });
    }

    if (interaction.customId === "close_sales_ticket") {
      if (!isTicketStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ רק צוות יכול לסגור טיקטים.",
          ephemeral: true
        });
      }

      const logsChannel = interaction.guild.channels.cache.get(
        config.ticketLogsChannelId
      );

      const transcriptFile = await createTicketTranscript(interaction.channel)
        .catch(() => null);

      if (logsChannel?.isTextBased()) {
        await logsChannel.send({
          content:
`🔒 **Ticket Closed**

🎫 טיקט: ${interaction.channel.name}
📌 סוג: ${getTicketType(interaction.channel)}
👤 נפתח על ידי: <@${getTicketOwner(interaction.channel)}>
👤 נסגר על ידי: <@${interaction.user.id}>`,
          files: transcriptFile ? [transcriptFile] : []
        }).catch(() => {});
      }

      await interaction.reply("🔒 הטיקט ייסגר בעוד 5 שניות...");

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
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

      return interaction.reply({
        content: `המספר שלך הוא: **${correct}**\nתלחץ על הכפתור עם המספר הזה.`,
        components: [row],
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith("verify:")) {
      const [, userId, correct, picked] = interaction.customId.split(":");

      if (interaction.user.id !== userId) {
        return interaction.reply({
          content: "זה לא ה־verify שלך 😭",
          ephemeral: true
        });
      }

      if (picked !== correct) {
        return interaction.reply({
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
          content: "האימות הצליח, אבל לא מצאתי את הרול. בדוק memberRoleId.",
          components: []
        });
      }

      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.update({
          content: "האימות הצליח, אבל לבוט אין Manage Roles.",
          components: []
        });
      }

      if (role.position >= botMember.roles.highest.position) {
        return interaction.update({
          content: "האימות הצליח, אבל רול הבוט חייב להיות מעל רול המאומת.",
          components: []
        });
      }

      await member.roles.add(role, "Verify completed");

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

    if (interaction.replied || interaction.deferred) {
      return interaction.followUp(response).catch(() => {});
    }

    return interaction.reply(response).catch(() => {});
  }
});

if (!process.env.TOKEN) {
  console.error("❌ TOKEN missing in .env");
  process.exit(1);
}

client.login(process.env.TOKEN);
