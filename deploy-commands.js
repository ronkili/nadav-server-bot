require("dotenv").config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const config = require("./config");

function userReasonCommand(name, description, withDuration = false) {
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
        .setDescription("בחר לכמה זמן")
        .setRequired(true)
        .addChoices(
          { name: "10 שניות", value: "10s" },
          { name: "30 שניות", value: "30s" },
          { name: "דקה", value: "1m" },
          { name: "5 דקות", value: "5m" },
          { name: "10 דקות", value: "10m" },
          { name: "30 דקות", value: "30m" },
          { name: "שעה", value: "1h" },
          { name: "שעתיים", value: "2h" },
          { name: "6 שעות", value: "6h" },
          { name: "12 שעות", value: "12h" },
          { name: "יום", value: "1d" },
          { name: "3 ימים", value: "3d" },
          { name: "7 ימים", value: "7d" },
          { name: "14 ימים", value: "14d" },
          { name: "28 ימים", value: "28d" }
        )
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
    .setDescription("בודק אם Zone X עובד"),

  new SlashCommandBuilder()
    .setName("verify-panel")
    .setDescription("שולח פאנל Verify")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("שולח את פאנל הטיקטים של Zone X")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("setup-xp-shop")
    .setDescription("שולח את פאנל ה־XP Shop של Zone X"),

  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("מציג את הסטטיסטיקות של משתמש ב-Zone X")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("המשתמש להצגת ה-Rank")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("נותן Warn ובוחר פעולה")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("המשתמש")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("action")
        .setDescription("מה לעשות יחד עם ה-Warn")
        .setRequired(true)
        .addChoices(
          { name: "Warn בלבד", value: "none" },
          { name: "Voice Mute", value: "voice-mute" },
          { name: "Chat Mute", value: "chat-mute" },
          { name: "Timeout", value: "timeout" },
          { name: "Ban", value: "ban" }
        )
    )
    .addStringOption(option =>
      option
        .setName("duration")
        .setDescription("חובה ל-Voice Mute / Chat Mute / Timeout")
        .setRequired(false)
        .addChoices(
          { name: "10 שניות", value: "10s" },
          { name: "30 שניות", value: "30s" },
          { name: "דקה", value: "1m" },
          { name: "5 דקות", value: "5m" },
          { name: "10 דקות", value: "10m" },
          { name: "30 דקות", value: "30m" },
          { name: "שעה", value: "1h" },
          { name: "שעתיים", value: "2h" },
          { name: "6 שעות", value: "6h" },
          { name: "12 שעות", value: "12h" },
          { name: "יום", value: "1d" },
          { name: "3 ימים", value: "3d" },
          { name: "7 ימים", value: "7d" },
          { name: "14 ימים", value: "14d" },
          { name: "28 ימים", value: "28d" }
        )
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("סיבה")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("מציג את כל ה-Warns של משתמש")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("המשתמש לבדיקה")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unwarn")
    .setDescription("מסיר Warn ספציפי ממשתמש")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("המשתמש")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("id")
        .setDescription("Warn ID, לדוגמה W0001")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clear-warns")
    .setDescription("מוחק את כל ה-Warns של משתמש")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("המשתמש")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("restraining-order")
    .setDescription("יוצר צו הרחקה בין שני משתמשים")
    .addUserOption(option =>
      option
        .setName("user1")
        .setDescription("המשתמש הראשון")
        .setRequired(true)
    )
    .addUserOption(option =>
      option
        .setName("user2")
        .setDescription("המשתמש השני")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("duration")
        .setDescription("בחר לכמה זמן הצו יהיה פעיל")
        .setRequired(true)
        .addChoices(
          { name: "10 דקות", value: "10m" },
          { name: "30 דקות", value: "30m" },
          { name: "שעה", value: "1h" },
          { name: "שעתיים", value: "2h" },
          { name: "6 שעות", value: "6h" },
          { name: "12 שעות", value: "12h" },
          { name: "יום", value: "1d" },
          { name: "3 ימים", value: "3d" },
          { name: "7 ימים", value: "7d" },
          { name: "14 ימים", value: "14d" },
          { name: "30 ימים", value: "30d" },
          { name: "90 ימים", value: "90d" },
          { name: "180 ימים", value: "180d" },
          { name: "שנה", value: "365d" },
          { name: "לצמיתות", value: "permanent" }
        )
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("סיבה")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("restraining-orders")
    .setDescription("מציג צווי הרחקה פעילים")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("סנן לפי משתמש")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unrestraining-order")
    .setDescription("מבטל צו הרחקה")
    .addStringOption(option =>
      option
        .setName("id")
        .setDescription("Order ID, לדוגמה RO0001")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("סיבת הביטול")
        .setRequired(false)
    ),

  userReasonCommand(
    "mute",
    "נותן Voice Mute זמני למשתמש",
    true
  ),

  userReasonCommand(
    "unvoice-mute",
    "מסיר Voice Mute ממשתמש"
  ),

  userReasonCommand(
    "chat-mute",
    "נותן Chat Mute זמני למשתמש",
    true
  ),

  userReasonCommand(
    "un-chat-mute",
    "מסיר Chat Mute ממשתמש"
  ),

  userReasonCommand(
    "timeout",
    "נותן Timeout זמני למשתמש",
    true
  ),

  userReasonCommand(
    "untimeout",
    "מסיר Timeout ממשתמש"
  ),

  userReasonCommand(
    "kick",
    "מעיף משתמש מהשרת"
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
        .setDescription("כמות הודעות")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
].map(command => command.toJSON());

const rest = new REST({
  version: "10"
}).setToken(process.env.TOKEN);

async function deployCommands() {
  try {
    if (!process.env.TOKEN) {
      console.error("❌ TOKEN missing in .env");
      process.exit(1);
    }

    if (!config.clientId) {
      console.error("❌ clientId missing in config.js");
      process.exit(1);
    }

    if (!config.guildId) {
      console.error("❌ guildId missing in config.js");
      process.exit(1);
    }

    console.log(
      `🔄 Registering ${commands.length} Zone X slash commands...`
    );

    const registered = await rest.put(
      Routes.applicationGuildCommands(
        config.clientId,
        config.guildId
      ),
      { body: commands }
    );

    console.log(
      `✅ Registered ${registered.length} Zone X slash commands`
    );

    console.log(
      registered
        .map(command => `✅ /${command.name}`)
        .join("\n")
    );
  } catch (error) {
    console.error("❌ Deploy error:", error);
    process.exit(1);
  }
}

deployCommands();
