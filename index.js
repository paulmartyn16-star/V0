// ==========================================================
// V0 - Full Version with Reaction Role Dashboard + Command Handler + SetupRoles
// Cleaned & consolidated version (replace your index.js with this)
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

// === COMMAND HANDLER SETUP (minimal) ===
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command?.data?.name) client.commands.set(command.data.name, command);
  }
}

// === BOT READY (single ready) ===
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.find((g) => g.name === SERVER_NAME);
  if (!guild) return console.log("❌ Server not found.");

  // --- Support panel (single send; do not re-create on every action) ---
  try {
    const supportChannel = guild.channels.cache.find(
      (c) => c.name === "🎟️・support-ticket" && c.type === 0
    );
    if (supportChannel) {
      // remove only old bot messages from top to keep a clean panel (safe)
      try {
        const fetched = await supportChannel.messages.fetch({ limit: 20 });
        const botMsgs = fetched.filter(m => m.author?.id === client.user.id);
        // keep one most recent bot panel if any; remove only extra bot messages beyond 1
        if (botMsgs.size > 1) {
          const toDelete = botMsgs.sort((a,b)=> b.createdTimestamp - a.createdTimestamp).slice(1);
          for (const m of toDelete.values()) m.delete().catch(()=>{});
        }
      } catch (e) { /* ignore fetch errors */ }

      // ensure a panel exists — check for embed title exactly "💎 V0 Support"
      const recent = await supportChannel.messages.fetch({ limit: 20 }).catch(()=>null);
      const hasSupportPanel = recent && recent.some(m => m.embeds?.length && m.embeds[0].title === "💎 V0 Support");

      if (!hasSupportPanel) {
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
        await supportChannel.send({ embeds: [supportEmbed], components: [supportBtn] }).catch(()=>{});
        console.log("✅ Support panel posted.");
      } else {
        console.log("✅ Support panel already exists, not reposting.");
      }
    } else {
      console.log("⚠️ Support channel not found (🎟️・support-ticket).");
    }
  } catch (e) {
    console.error("Error initializing support panel:", e);
  }

  // --- Verify panel: create only if missing and in a verify channel ---
  try {
// finds channel like "verify", "✅・verify", "✔verify", etc.
const verifyChannel = guild.channels.cache.find(
  c => c.type === 0 && c.name.replace(/[^\w\s]/gi, "").toLowerCase().includes("verify")
);

    if (verifyChannel) {
      const messages = await verifyChannel.messages.fetch({ limit: 50 }).catch(()=>null);
      const hasVerify = messages && messages.some(m => m.embeds?.length && m.embeds[0].title === "💎 Verify to Access V0");

      if (!hasVerify) {
        const verifyEmbed = new EmbedBuilder()
          .setColor("#00FF99")
          .setTitle("💎 Verify to Access V0")
          .setDescription("Welcome to **V0 Carries!**\n\nClick **Verify Me** below to get full access to the server.")
          .setFooter({ text: "V0 | Verification System", iconURL: FOOTER_ICON });

        const verifyBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("verify_user")
            .setLabel("✅ Verify Me")
            .setStyle(ButtonStyle.Success)
        );
        await verifyChannel.send({ embeds: [verifyEmbed], components: [verifyBtn] }).catch(()=>{});
        console.log("✅ Verify panel posted.");
      } else {
        console.log("✅ Verify panel already exists, not reposting.");
      }
    } else {
      console.log("ℹ️ Verify channel not found (channel name should include 'verify').");
    }
  } catch (e) {
    console.error("Error initializing verify panel:", e);
  }
});

// === Single centralized interaction handler ===
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isButton()) {
      // handle slash/autocomplete if implemented via commands
      if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd) {
          try { await cmd.execute(interaction); } catch (err) { console.error(err); }
        }
      }
      return;
    }

    const id = interaction.customId;

    // ---------- SUPPORT: create ticket in fixed category "SUPPORT TICKETS" ----------
    if (id === "create_support_ticket") {
      const guild = interaction.guild;
      const user = interaction.user;

      const category = guild.channels.cache.find(
        c => c.type === 4 && c.name.toUpperCase() === "SUPPORT TICKETS"
      );
      if (!category) {
        // reply ephemeral-like using flags to avoid deprecated ephemeral field
        await safeReply(interaction, "❌ Category **SUPPORT TICKETS** not found. Please create it first.", true);
        return;
      }

      // check existing by parent & name pattern
      const existing = guild.channels.cache.find(c =>
        c.parentId === category.id && c.name === `ticket-${user.username.toLowerCase()}`
      );
      if (existing) {
        await safeReply(interaction, `❌ You already have an open ticket: ${existing}`, true);
        return;
      }

      // create ticket channel inside the fixed category
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
        .setDescription(`Hey ${user}, 👋\n\nPlease describe your issue below. A team member will assist you shortly.\n\nClick **🔒 Close Ticket** when you're done.`)
        .setFooter({ text: "V0 | Support", iconURL: FOOTER_ICON });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("close_ticket").setLabel("🔒 Close Ticket").setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({ embeds: [embed], components: [row] }).catch(()=>{});
      await safeReply(interaction, `✅ Your support ticket has been created: ${ticketChannel}`, true);
      return;
    }

    // ---------- SUPPORT: close ticket ----------
    if (id === "close_ticket") {
      // allow this button to work only inside ticket channels named ticket-...
      const ch = interaction.channel;
      if (!ch || !ch.name || !ch.name.startsWith("ticket-")) {
        await safeReply(interaction, "❌ This button can only be used inside a ticket channel.", true);
        return;
      }
      await safeReply(interaction, "🔒 Closing ticket...", true);
      setTimeout(() => ch.delete().catch(()=>{}), 2000);
      return;
    }

    // ---------- VERIFY: give role ----------
    if (id === "verify_user") {
      const guild = interaction.guild;
      const member = await guild.members.fetch(interaction.user.id).catch(()=>null);
      if (!member) return await safeReply(interaction, "❌ Member not found.", true);

      const verifiedRole = guild.roles.cache.find(r => r.name === "💎 Verified");
      if (!verifiedRole) return await safeReply(interaction, "❌ The '💎 Verified' role doesn't exist! Please create it.", true);

      if (member.roles.cache.has(verifiedRole.id)) {
        await safeReply(interaction, "✅ You are already verified!", true);
        return;
      }

      await member.roles.add(verifiedRole).catch(err => console.error("Failed to assign role:", err));
      await safeReply(interaction, "💎 You have been verified successfully! Welcome to **V0 Carries**.", true);
      return;
    }

    // ---------- SLAYER: open ticket via custom id like open_ticket_revenant_5 ----------
    if (id.startsWith("open_ticket_")) {
      const parts = id.split("_"); // ["open", "ticket", "revenant", "5"]
      if (parts.length < 4) {
        await safeReply(interaction, "❌ Invalid ticket request.", true);
        return;
      }
      const slayer = parts[2];
      const tier = parts[3];
      const ticketCategories = {
        revenant: "Revenant Slayer",
        tarantula: "Tarantula Slayer",
        sven: "Sven Slayer",
        enderman: "Enderman Slayer",
        blaze: "Blaze Slayer",
        vampire: "Vampire Slayer",
      };
      const categoryName = ticketCategories[slayer];
      if (!categoryName) return await safeReply(interaction, "❌ Unknown slayer.", true);

      const guild = interaction.guild;
      const user = interaction.user;
      const category = guild.channels.cache.find(c => c.type === 4 && c.name === categoryName);
      if (!category) return await safeReply(interaction, `❌ Category "${categoryName}" not found!`, true);

      const existing = guild.channels.cache.find(
        c => c.parentId === category.id && c.name.includes(`${slayer}-t${tier}-${user.username}`)
      );
      if (existing) return await safeReply(interaction, `❌ You already have an open ${slayer} ticket: ${existing}`, true);

      const visibleRoles = guild.roles.cache.filter(r => r.name.toLowerCase().includes(slayer)).filter(r => {
        const m = r.name.match(/tier\s*(\d+)/i);
        if (!m) return false;
        return parseInt(m[1]) >= parseInt(tier);
      });

      const ch = await guild.channels.create({
        name: `${slayer}-t${tier}-${user.username}`,
        type: 0,
        parent: category.id,
        permissionOverwrites: [
          { id: guild.id, deny: ["ViewChannel"] },
          { id: user.id, allow: ["ViewChannel", "SendMessages", "AttachFiles"] },
          ...visibleRoles.map(r => ({ id: r.id, allow: ["ViewChannel", "SendMessages", "AttachFiles"] })),
        ],
      });

      const embed = new EmbedBuilder()
        .setColor("#FFD700")
        .setTitle(`${capitalize(slayer)} Tier ${tier} Ticket`)
        .setDescription("Please wait for a carrier to claim your ticket.")
        .setFooter({ text: `V0 | ${capitalize(slayer)} Slayer` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`claim_${ch.id}`).setLabel("✅ Claim").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`unclaim_${ch.id}`).setLabel("🔄 Unclaim").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`close_${ch.id}`).setLabel("🔒 Close").setStyle(ButtonStyle.Danger)
      );

      await ch.send({ content: `|| @Tier ${tier} ${capitalize(slayer)} ||\n|| <@${user.id}> ||`, embeds: [embed], components: [row] }).catch(()=>{});
      await safeReply(interaction, `✅ Your ${capitalize(slayer)} Tier ${tier} ticket has been created: ${ch}`, true);
      return;
    }

    // ---------- SLAYER: claim/unclaim/close with id like claim_<channelId> ----------
    if (id.startsWith("claim_") || id.startsWith("unclaim_") || id.startsWith("close_")) {
      const [action, channelId] = id.split("_");
      const guild = interaction.guild;
      const channel = guild.channels.cache.get(channelId);
      if (!channel) return await safeReply(interaction, "❌ Ticket channel not found.", true);

      if (action === "claim") {
        // simple claim: allow claimer to send messages and notify
        const member = await guild.members.fetch(interaction.user.id).catch(()=>null);
        if (!member) return await safeReply(interaction, "❌ Member not found.", true);

        // set permissions: disable send for others except guild and claimer (best-effort)
        try {
          for (const [id, po] of channel.permissionOverwrites.cache) {
            if (po.allow?.has("SendMessages") && id !== interaction.user.id) {
              await channel.permissionOverwrites.edit(id, { SendMessages: false }).catch(()=>{});
            }
          }
          await channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: true }).catch(()=>{});
        } catch (e) { /* ignore errors */ }

        await safeReply(interaction, `✅ Ticket claimed by <@${interaction.user.id}>.`, false);
        return;
      }

      if (action === "unclaim") {
        // restore sending for everyone who had it (we can't know previous state perfectly)
        // do a best-effort: allow roles that have view to send
        try {
          for (const [id, po] of channel.permissionOverwrites.cache) {
            if (po.type === 'role') {
              await channel.permissionOverwrites.edit(id, { SendMessages: true }).catch(()=>{});
            }
          }
        } catch (e) { /* ignore */ }
        await safeReply(interaction, `🔄 Ticket unclaimed by <@${interaction.user.id}>.`, false);
        return;
      }

      if (action === "close") {
        await safeReply(interaction, "🔒 Closing ticket...", true);
        setTimeout(() => channel.delete().catch(()=>{}), 2000);
        return;
      }
    }

    // fallback: unknown button
    await safeReply(interaction, "⚠️ Unknown button interaction.", true);
  } catch (err) {
    // catch everything to avoid crashes
    console.error("Interaction error:", err);
    try { await safeReply(interaction, "❌ An error occurred while processing the interaction.", true); } catch(e){ }
  }
});

// utility: safe reply that uses flags (ephemeral) where possible and avoids double replies
async function safeReply(interaction, content, ephemeral = true) {
  try {
    if (ephemeral) {
      // prefer flags to avoid deprecation warning
      await interaction.reply?.({ content, flags: 64 }).catch(async (err) => {
        // fallback to ephemeral property for older libs or if flags rejected
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content, ephemeral: true }).catch(()=>{});
        }
      });
    } else {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content }).catch(async () => {
          // if reply fails, try followUp
          try { await interaction.followUp({ content }).catch(()=>{}); } catch(e){ }
        });
      } else {
        // already replied — send followUp
        await interaction.followUp?.({ content }).catch(()=>{});
      }
    }
  } catch (e) {
    // if interaction token expired (Unknown interaction), ignore to avoid crash
    // console.error("safeReply failure:", e);
  }
}

// === WELCOME SYSTEM ===
client.on("guildMemberAdd", async (member) => {
  try {
    const welcomeChannel = member.guild.channels.cache.find(
      (c) => c.name === "👋・welcome" && c.type === 0
    );
    if (!welcomeChannel) return;
    const verifyChannel = member.guild.channels.cache.find((c) => c.name.toLowerCase().includes("verify") && c.type === 0);
    const rulesChannel = member.guild.channels.cache.find((c) => c.name.toLowerCase().includes("rules") && c.type === 0);
    const verifyMention = verifyChannel ? `<#${verifyChannel.id}>` : "#verify";
    const rulesMention = rulesChannel ? `<#${rulesChannel.id}>` : "#rules";
    const embed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle("👋 Welcome to V0!")
      .setDescription(
        `Hey ${member}, welcome to **V0**!\n\nPlease make sure to:\n✅ Verify yourself in ${verifyMention}\n📜 Read the rules in ${rulesMention}\n\nWe hope you enjoy our service 💎`
      )
      .setFooter({ text: "V0 | Welcome System", iconURL: FOOTER_ICON });
    await welcomeChannel.send({ embeds: [embed] }).catch(()=>{});
  } catch (err) {
    console.error("❌ Error sending welcome message:", err);
  }
});

// === REACTION ROLE HANDLERS (simple persistent storage + add/remove) ===
client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(()=>{});
    const msg = reaction.message;
    if (!rr[msg.id]) return;
    const pair = rr[msg.id].pairs.find(p => p.emoji === (reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name));
    if (!pair) return;
    const member = await msg.guild.members.fetch(user.id).catch(()=>null);
    if (member) await member.roles.add(pair.roleId).catch(()=>{});
  } catch(e){/* ignore */ }
});
client.on("messageReactionRemove", async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(()=>{});
    const msg = reaction.message;
    if (!rr[msg.id]) return;
    const pair = rr[msg.id].pairs.find(p => p.emoji === (reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name));
    if (!pair) return;
    const member = await msg.guild.members.fetch(user.id).catch(()=>null);
    if (member) await member.roles.remove(pair.roleId).catch(()=>{});
  } catch(e){/* ignore */ }
});

// === Helper functions ===
function capitalize(s) { return s?.charAt(0)?.toUpperCase() + s?.slice(1); }

// === LOGIN ===
client.login(TOKEN).catch(err => console.error("Login failed:", err));
 