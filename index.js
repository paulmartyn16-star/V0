// ==========================================================
// V0 - Full Version with Reaction Role Dashboard + Command Handler + SetupRoles
// ==========================================================

require("dotenv").config();
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const Strategy = require("passport-discord").Strategy;
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  Partials,
  Collection,
} = require("discord.js");

// === DISCORD BOT SETUP ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// === LOAD ENV VARIABLES ===
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const FOOTER_ICON = process.env.FOOTER_ICON;
const CATEGORY_ID = process.env.CATEGORY_ID;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const RESTOCK_ROLE_ID = process.env.RESTOCK_ROLE_ID;
const DASHBOARD_PORT = process.env.PORT || 3000;
const SERVER_NAME = "V0 Carries";
const OWNER_ROLE_NAME = "👑 Owner";

// === EXPRESS DASHBOARD ===
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(
  session({
    secret: "V0_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

// === DISCORD OAUTH2 LOGIN ===
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(
  new Strategy(
    {
      clientID: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      callbackURL: "https://v0-plp3.onrender.com/callback",
      scope: ["identify", "guilds", "guilds.members.read"],
    },
    (accessToken, refreshToken, profile, done) => done(null, profile)
  )
);
app.use(passport.initialize());
app.use(passport.session());

// === OWNER AUTH CHECK ===
const isAuthenticated = async (req, res, next) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  try {
    const guild = client.guilds.cache.find((g) => g.name === SERVER_NAME);
    if (!guild) return res.send("❌ Server not found.");
    const member = await guild.members.fetch(req.user.id).catch(() => null);
    if (!member) return res.send("❌ You are not a member of the server.");
    const hasRole = member.roles.cache.some(
      (r) => r.name.toLowerCase() === OWNER_ROLE_NAME.toLowerCase()
    );
    if (!hasRole) return res.send("🚫 Access denied – Owner role required.");
    return next();
  } catch (err) {
    console.error("❌ Auth error:", err);
    return res.send("⚠️ Error checking permissions.");
  }
};

// === ROUTES ===
app.get("/", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  res.redirect("/dashboard");
});
app.get("/login", passport.authenticate("discord"));
app.get(
  "/callback",
  passport.authenticate("discord", { failureRedirect: "/" }),
  (req, res) => res.redirect("/dashboard")
);
app.get("/logout", (req, res) => req.logout(() => res.redirect("/")));

// === REACTION ROLE STORAGE ===
const rrFile = path.join(__dirname, "reactionroles.json");
let rr = fs.existsSync(rrFile)
  ? JSON.parse(fs.readFileSync(rrFile, "utf8"))
  : {};

// === DASHBOARD ===
app.get("/dashboard", isAuthenticated, async (req, res) => {
  const guild = client.guilds.cache.find((g) => g.name === SERVER_NAME);
  if (!guild) return res.send("❌ Server not found. Is the bot in your server?");
  const channels = guild.channels.cache.filter((ch) => ch.type === 0);
  const roles = guild.roles.cache.filter((r) => r.name !== "@everyone");
  res.render("dashboard", {
    user: req.user,
    channels,
    roles,
    rrData: rr,
    message: null,
  });
});

// === EMBED BUILDER ===
app.post("/send", isAuthenticated, async (req, res) => {
  const { channelId, title, description, color, footer, restock } = req.body;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return res.send("❌ Channel not found");
    const embed = new EmbedBuilder()
      .setTitle(title || "Untitled Embed")
      .setDescription(description || "")
      .setColor(parseInt((color || "#FFD700").replace("#", ""), 16))
      .setFooter({ text: footer || "V0 | Embed System", iconURL: FOOTER_ICON });
    if (restock === "on" && RESTOCK_ROLE_ID)
      await channel.send({ content: `<@&${RESTOCK_ROLE_ID}> 🔔 **Restock Alert!**` });
    await channel.send({ embeds: [embed] });
    const guild = client.guilds.cache.find((g) => g.name === SERVER_NAME);
    const channels = guild.channels.cache.filter((ch) => ch.type === 0);
    const roles = guild.roles.cache.filter((r) => r.name !== "@everyone");
    res.render("dashboard", {
      user: req.user,
      channels,
      roles,
      rrData: rr,
      message: "✅ Embed sent successfully!",
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Error sending embed");
  }
});

// === REACTION ROLE CREATION / EDIT / DELETE ===
app.post("/reactionrole", isAuthenticated, async (req, res) => {
  const { channelId, title, description, color, footer } = req.body;
  const pairs = Object.keys(req.body)
    .filter((k) => k.startsWith("emoji_"))
    .map((k) => k.split("_")[1])
    .filter((i) => req.body[`emoji_${i}`] && req.body[`role_${i}`])
    .map((i) => ({ emoji: req.body[`emoji_${i}`], roleId: req.body[`role_${i}`] }));

  if (!pairs.length) return res.send("❌ No emoji-role pairs.");
  try {
    const channel = await client.channels.fetch(channelId);
    const embed = new EmbedBuilder()
      .setTitle(title || "Reaction Roles")
      .setDescription(description || "React below to get roles!")
      .setColor(parseInt((color || "#FFD700").replace("#", ""), 16))
      .setFooter({ text: footer || "V0 | Reaction Roles", iconURL: FOOTER_ICON });
    const msg = await channel.send({ embeds: [embed] });
    for (const p of pairs) await msg.react(p.emoji);

    rr[msg.id] = { channelId, channelName: channel.name, pairs, embed: { title, description, color, footer } };
    fs.writeFileSync(rrFile, JSON.stringify(rr, null, 2));

    const guild = client.guilds.cache.find((g) => g.name === SERVER_NAME);
    const channels = guild.channels.cache.filter((ch) => ch.type === 0);
    const roles = guild.roles.cache.filter((r) => r.name !== "@everyone");
    res.render("dashboard", { user: req.user, channels, roles, rrData: rr, message: "✅ Reaction Role created!" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating reaction role");
  }
});

app.post("/reactionrole/update", isAuthenticated, async (req, res) => {
  const { messageId, title, description, color, footer } = req.body;
  if (!rr[messageId]) return res.send("❌ Unknown message ID.");
  const data = rr[messageId];
  const channel = await client.channels.fetch(data.channelId);
  const msg = await channel.messages.fetch(messageId);
  const embed = new EmbedBuilder()
    .setTitle(title || "Reaction Roles")
    .setDescription(description || "")
    .setColor(parseInt((color || "#FFD700").replace("#", ""), 16))
    .setFooter({ text: footer || "V0 | Reaction Roles", iconURL: FOOTER_ICON });
  await msg.edit({ embeds: [embed] });

  const pairs = Object.keys(req.body)
    .filter((k) => k.startsWith("emoji_"))
    .map((k) => k.split("_")[1])
    .filter((i) => req.body[`emoji_${i}`] && req.body[`role_${i}`])
    .map((i) => ({ emoji: req.body[`emoji_${i}`], roleId: req.body[`role_${i}`] }));

  data.pairs = pairs;
  data.embed = { title, description, color, footer };
  fs.writeFileSync(rrFile, JSON.stringify(rr, null, 2));
  for (const react of msg.reactions.cache.values()) await react.remove().catch(() => {});
  for (const p of pairs) await msg.react(p.emoji);
  res.redirect("/dashboard");
});

app.post("/reactionrole/delete", isAuthenticated, async (req, res) => {
  const { messageId } = req.body;
  if (!rr[messageId]) return res.send("❌ Unknown message ID.");
  try {
    const ch = await client.channels.fetch(rr[messageId].channelId);
    const m = await ch.messages.fetch(messageId);
    await m.delete();
    delete rr[messageId];
    fs.writeFileSync(rrFile, JSON.stringify(rr, null, 2));
    res.redirect("/dashboard");
  } catch (e) {
    console.error(e);
    res.send("Error deleting message.");
  }
});

client.on("messageReactionAdd", async (r, u) => {
  if (u.bot || !rr[r.message.id]) return;
  const pair = rr[r.message.id].pairs.find((p) => p.emoji === r.emoji.name);
  if (!pair) return;
  const member = await r.message.guild.members.fetch(u.id);
  await member.roles.add(pair.roleId).catch(() => {});
});
client.on("messageReactionRemove", async (r, u) => {
  if (u.bot || !rr[r.message.id]) return;
  const pair = rr[r.message.id].pairs.find((p) => p.emoji === r.emoji.name);
  if (!pair) return;
  const member = await r.message.guild.members.fetch(u.id);
  await member.roles.remove(pair.roleId).catch(() => {});
});

// === DASHBOARD START ===
app.listen(DASHBOARD_PORT, () => console.log(`🌐 Dashboard running on port ${DASHBOARD_PORT}`));

// === COMMAND HANDLER SETUP ===
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    client.commands.set(command.data.name, command);
  }
}

// === BOT READY ===
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// === SLASH COMMAND EXECUTION (supports /setuproles etc.) ===
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "❌ Error executing command.", ephemeral: true });
    } else {
      await interaction.reply({ content: "❌ Error executing command.", ephemeral: true });
    }
  }
});

// === Support Ticket System (V0 Carries Style | Fixed Category + await fix) ===
client.once("ready", async () => {
  try {
    const guild = client.guilds.cache.find(g => g.name === SERVER_NAME);
    if (!guild) return console.log("❌ Server not found for Support Panel.");

    const supportChannel = guild.channels.cache.find(c => c.name === "🎟️・support-ticket");
    if (!supportChannel) return console.log("❌ Support channel not found.");

    const supportEmbed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle("💎 V0 Support")
      .setDescription(
        "Need help or have a question about carries?\n\n" +
        "Our support team is here for you! Click the button below to open a private ticket.\n\n" +
        "⚠️ Only use this for **support-related issues.**"
      )
      .setFooter({ text: "V0 | Support System", iconURL: FOOTER_ICON });

    const supportBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("create_support_ticket")
        .setLabel("🎟️ Create Support Ticket")
        .setStyle(ButtonStyle.Primary)
    );

    await supportChannel.bulkDelete(10).catch(() => {});
    await supportChannel.send({ embeds: [supportEmbed], components: [supportBtn] });

    console.log("✅ Support panel initialized.");
  } catch (err) {
    console.error("❌ Error setting up support panel:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== "create_support_ticket") return;

  const guild = interaction.guild;
  const user = interaction.user;

  const category = guild.channels.cache.find(
    c => c.name.toUpperCase() === "SUPPORT TICKETS" && c.type === 4
  );
  if (!category) {
    await interaction.reply({
      content: "❌ Category **SUPPORT TICKETS** not found. Please create it first.",
      ephemeral: true,
    });
    return;
  }

  const existing = guild.channels.cache.find(
    c => c.parentId === category.id && c.name === `ticket-${user.username.toLowerCase()}`
  );
  if (existing) {
    await interaction.reply({
      content: `❌ You already have an open ticket: ${existing}`,
      ephemeral: true,
    });
    return;
  }

  const ticketChannel = await guild.channels.create({
    name: `ticket-${user.username}`,
    type: 0,
    parent: category.id,
    topic: `Support ticket for ${user.tag}`,
    permissionOverwrites: [
      { id: guild.id, deny: ["ViewChannel"] },
      { id: user.id, allow: ["ViewChannel", "SendMessages", "AttachFiles"] },
    ],
  });

  const embed = new EmbedBuilder()
    .setColor("#FFD700")
    .setTitle("🎟️ V0 Support Ticket")
    .setDescription(
      `Hey ${user}, 👋\n\nPlease describe your issue below. A team member will assist you shortly.\n\n` +
      "Click **🔒 Close Ticket** when you are done."
    )
    .setFooter({ text: "V0 | Support", iconURL: FOOTER_ICON });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("🔒 Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await ticketChannel.send({ embeds: [embed], components: [buttons] });
  await interaction.reply({
    content: `✅ Your support ticket has been created in ${category.name}: ${ticketChannel}`,
    ephemeral: true,
  });
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== "close_ticket") return;
  await interaction.reply({ content: "🔒 Closing ticket...", ephemeral: true });
  setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
});

// === Verify System ===
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== "verify_user") return;
  const guild = interaction.guild;
  const member = await guild.members.fetch(interaction.user.id);
  const verifiedRole = guild.roles.cache.find((r) => r.name === "💎 Verified");
  if (!verifiedRole) {
    await interaction.reply({
      content: "❌ The '💎 Verified' role doesn't exist! Please create it first.",
      ephemeral: true,
    });
    return;
  }
  if (member.roles.cache.has(verifiedRole.id)) {
    await interaction.reply({ content: "✅ You are already verified!", ephemeral: true });
  } else {
    await member.roles.add(verifiedRole);
    await interaction.reply({ content: "💎 You have been verified successfully! Welcome to V0.", ephemeral: true });
  }
});

// === Welcome System ===
client.on("guildMemberAdd", async (member) => {
  try {
    const welcomeChannel = member.guild.channels.cache.find(c => c.name === "👋・welcome");
    if (!welcomeChannel) return;

    const verifyChannel = member.guild.channels.cache.find(c => c.name.includes("verify"));
    const rulesChannel = member.guild.channels.cache.find(c => c.name.includes("rules"));

    const verifyMention = verifyChannel ? `<#${verifyChannel.id}>` : "#verify";
    const rulesMention = rulesChannel ? `<#${rulesChannel.id}>` : "#rules";

    const welcomeEmbed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle("👋 Welcome to V0 Carries!")
      .setDescription(
        `Hey ${member}, welcome to **V0 Carries**!\n\n` +
        "We're glad to have you here. Please make sure to:\n" +
        `✅ Verify yourself in ${verifyMention}\n` +
        `📜 Read the rules in ${rulesMention}\n\n` +
        "We hope you enjoy your stay 💎"
      )
      .setFooter({ text: "V0 | Welcome System", iconURL: FOOTER_ICON });

    await welcomeChannel.send({ embeds: [welcomeEmbed] });
