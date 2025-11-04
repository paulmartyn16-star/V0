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
  if (!guild) return res.send("❌ Server not found.");
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
      await channel.send({
        content: `<@&${RESTOCK_ROLE_ID}> 🔔 **Restock Alert!**`,
      });
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

// === DASHBOARD START ===
app.listen(DASHBOARD_PORT, () =>
  console.log(`🌐 Dashboard running on port ${DASHBOARD_PORT}`)
);

// === BOT READY ===
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.find((g) => g.name === SERVER_NAME);
  if (!guild) return console.log("❌ Server not found.");

  const supportChannel = guild.channels.cache.find(
    (c) => c.name === "🎟️・support-ticket"
  );
  if (supportChannel) {
    await supportChannel.bulkDelete(10).catch(() => {});
    const embed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle("💎 V0 Support")
      .setDescription(
        "Need help or have a question about carries?\n\nOur support team is here for you! Click below to open a ticket.\n\n⚠️ Only use this for **support-related issues.**"
      )
      .setFooter({ text: "V0 | Support System", iconURL: FOOTER_ICON });
    const btn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("create_support_ticket")
        .setLabel("🎟️ Create Support Ticket")
        .setStyle(ButtonStyle.Primary)
    );
    await supportChannel.send({ embeds: [embed], components: [btn] });
    console.log("✅ Support panel initialized.");
  }
});
// === SUPPORT, VERIFY & WELCOME ===
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  // === SUPPORT SYSTEM ===
  if (interaction.customId === "create_support_ticket") {
    const guild = interaction.guild;
    const user = interaction.user;
    const category = guild.channels.cache.find(
      (c) => c.name.toUpperCase() === "SUPPORT TICKETS" && c.type === 4
    );
    if (!category)
      return interaction.reply({
        content: "❌ Category SUPPORT TICKETS not found.",
        ephemeral: true,
      });

    const existing = guild.channels.cache.find(
      (c) =>
        c.parentId === category.id &&
        c.name === `ticket-${user.username.toLowerCase()}`
    );
    if (existing)
      return interaction.reply({
        content: `❌ You already have an open ticket: ${existing}`,
        ephemeral: true,
      });

    const ticketChannel = await guild.channels.create({
      name: `ticket-${user.username}`,
      type: 0,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.id, deny: ["ViewChannel"] },
        { id: user.id, allow: ["ViewChannel", "SendMessages", "AttachFiles"] },
      ],
    });

    const embed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle("🎟️ V0 Support Ticket")
      .setDescription(
        `Hey ${user}, 👋\n\nPlease describe your issue below. A team member will assist you shortly.\n\nClick 🔒 Close Ticket when you're done.`
      )
      .setFooter({ text: "V0 | Support", iconURL: FOOTER_ICON });

    const btns = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("🔒 Close Ticket")
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({ embeds: [embed], components: [btns] });
    await interaction.reply({
      content: `✅ Your support ticket has been created: ${ticketChannel}`,
      ephemeral: true,
    });
  }

  // === CLOSE SUPPORT TICKET (Stabiler Fix) ===
if (interaction.customId === "close_ticket") {
  if (interaction.channel.name.startsWith("ticket-")) {
    try {
      // Neue sichere Antwortmethode (Flags statt ephemeral)
      await interaction.reply({
        content: "🔒 Closing ticket...",
        flags: 64 // ersetzt ephemeral: true
      }).catch(() => {}); // Ignoriere Discord Timeout Fehler

      // Channel nach 2 Sekunden löschen
      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 2000);
    } catch (err) {
      console.error("❌ Error closing ticket:", err);
    }
  }
}

  // === VERIFY SYSTEM ===
  if (interaction.customId === "verify_user") {
    const guild = interaction.guild;
    const member = await guild.members.fetch(interaction.user.id);
    const verifiedRole = guild.roles.cache.find((r) => r.name === "💎 Verified");
    if (!verifiedRole)
      return interaction.reply({
        content: "❌ The '💎 Verified' role doesn't exist!",
        ephemeral: true,
      });
    if (member.roles.cache.has(verifiedRole.id))
      return interaction.reply({
        content: "✅ You are already verified!",
        ephemeral: true,
      });
    await member.roles.add(verifiedRole);
    await interaction.reply({
      content: "💎 You have been verified successfully! Welcome to V0.",
      ephemeral: true,
    });
  }
});

// === WELCOME SYSTEM ===
client.on("guildMemberAdd", async (member) => {
  try {
    const welcomeChannel = member.guild.channels.cache.find(
      (c) => c.name === "👋・welcome"
    );
    if (!welcomeChannel) return;
    const verifyChannel = member.guild.channels.cache.find((c) =>
      c.name.includes("verify")
    );
    const rulesChannel = member.guild.channels.cache.find((c) =>
      c.name.includes("rules")
    );
    const verifyMention = verifyChannel ? `<#${verifyChannel.id}>` : "#verify";
    const rulesMention = rulesChannel ? `<#${rulesChannel.id}>` : "#rules";
    const embed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle("👋 Welcome to V0!")
      .setDescription(
        `Hey ${member}, welcome to **V0**!\n\nPlease make sure to:\n✅ Verify yourself in ${verifyMention}\n📜 Read the rules in ${rulesMention}\n\nWe hope you enjoy our service 💎`
      )
      .setFooter({ text: "V0 | Welcome System", iconURL: FOOTER_ICON });
    await welcomeChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error("❌ Error sending welcome message:", err);
  }
});

// === SLAYER SYSTEM ===
const ticketCategories = {
  revenant: "Revenant Slayer",
  tarantula: "Tarantula Slayer",
  sven: "Sven Slayer",
  enderman: "Enderman Slayer",
  blaze: "Blaze Slayer",
  vampire: "Vampire Slayer",
};

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  const id = interaction.customId;
  const guild = interaction.guild;
  const user = interaction.user;

  // === Slayer Ticket erstellen ===
  if (id.startsWith("open_ticket_")) {
    const [_, __, slayer, tier] = id.split("_");
    const categoryName = ticketCategories[slayer];
    const category = guild.channels.cache.find(
      (c) => c.name === categoryName && c.type === 4
    );
    if (!category)
      return interaction.reply({
        content: `❌ Category "${categoryName}" not found!`,
        ephemeral: true,
      });

    const existing = guild.channels.cache.find(
      (c) =>
        c.parentId === category.id &&
        c.name.includes(`${slayer}-t${tier}-${user.username}`)
    );
    if (existing)
      return interaction.reply({
        content: `❌ You already have an open ${slayer} ticket: ${existing}`,
        ephemeral: true,
      });

    const ch = await guild.channels.create({
      name: `${slayer}-t${tier}-${user.username}`,
      type: 0,
      parent: category,
      permissionOverwrites: [
        { id: guild.id, deny: ["ViewChannel"] },
        { id: user.id, allow: ["ViewChannel", "SendMessages", "AttachFiles"] },
      ],
    });

    const embed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle(`${slayer} Tier ${tier} Ticket`)
      .setDescription("Please wait for a carrier to claim your ticket.")
      .setFooter({ text: `V0 | ${slayer} Slayer` });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`claim_${ch.id}`)
        .setLabel("✅ Claim")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`unclaim_${ch.id}`)
        .setLabel("🔄 Unclaim")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`close_${ch.id}`)
        .setLabel("🔒 Close")
        .setStyle(ButtonStyle.Danger)
    );

    await ch.send({
      content: `|| @Tier ${tier} ${slayer} ||\n|| <@${user.id}> ||`,
      embeds: [embed],
      components: [buttons],
    });

    await interaction.reply({
      content: `✅ Your ${slayer} Tier ${tier} ticket has been created: ${ch}`,
      ephemeral: true,
    });
  }

  // === Slayer Claim / Unclaim / Close ===
  if (id.startsWith("claim_")) {
    await interaction.reply({ content: `✅ Ticket claimed by <@${user.id}>.` });
  }

  if (id.startsWith("unclaim_")) {
    await interaction.reply({ content: `🔄 Ticket unclaimed by <@${user.id}>.` });
  }

  if (id.startsWith("close_")) {
    await interaction.reply({ content: "🔒 Closing ticket...", ephemeral: true });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
  }
});

client.login(TOKEN);
