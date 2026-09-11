require("dotenv").config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const config = require("./config");

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("בודק אם הבוט עובד"),

  new SlashCommandBuilder()
    .setName("verify-panel")
    .setDescription("שולח פאנל Verify")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("שולח פאנל טיקטים")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
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
      `🔄 Registering ${commands.length} Nadav Server Bot slash commands...`
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
      `✅ Registered ${registered.length} Nadav Server Bot slash commands`
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
