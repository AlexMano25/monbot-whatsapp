require("dotenv").config();

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs-node");
const axios = require("axios");

// ======================= CONFIG GLOBALE =======================

const SOURCE_DIRECTORIES = ["/opt/monbot/documents"];
const STORAGE_FILE = "./brain_memory.json";
const STATE_FILE = "./scan_state.json";
const CRM_FILE = "./carnet_clients.json";
const MON_NUMERO = "237696875895@c.us";
const NUMERO_SUIVI = "237651982878@c.us";

const SCAN_INTERVAL_MS = 60 * 1000;
const WEB_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const DAILY_REPORT_HOUR = 8; // 8h du matin

// ======================= CACHE GLOBAL =======================

let globalMemory = [];
let webCache = { texts: [], lastFetch: 0 };
let clientWhatsApp = null; // référence globale

// ======================= CRM : CARNET CLIENTS =======================

function loadCRM() {
  if (!fs.existsSync(CRM_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CRM_FILE, "utf-8"));
  } catch (e) {
    console.error("[CRM] Erreur lecture carnet_clients.json:", e.message);
    return {};
  }
}

function saveCRM(carnet) {
  try {
    fs.writeFileSync(CRM_FILE, JSON.stringify(carnet, null, 2));
  } catch (e) {
    console.error("[CRM] Erreur sauvegarde:", e.message);
  }
}

function updateClient(phoneNumber, name, interest) {
  const carnet = loadCRM();
  if (!carnet[phoneNumber]) {
    carnet[phoneNumber] = {
      nom: name || "Inconnu",
      interets: [],
      premiere_interaction: new Date().toISOString(),
      derniere_interaction: new Date().toISOString(),
      nb_messages: 0
    };
  }
  const client = carnet[phoneNumber];
  client.nom = name || client.nom;
  client.derniere_interaction = new Date().toISOString();
  client.nb_messages = (client.nb_messages || 0) + 1;

  if (interest && !client.interets.includes(interest)) {
    client.interets.push(interest);
  }

  saveCRM(carnet);
  console.log(`[CRM] Client mis à jour : ${name} (${phoneNumber})`);
}

function extractInterestFromMessage(text) {
  const t = text.toLowerCase();
  const keywords = {
    "Logistique & Transport": ["transport", "camion", "remorque", "logistique", "livraison"],
    "Internet & Télécom": ["internet", "fibre", "connexion", "ittelecom", "débit"],
    "Terrasocial (Terrains)": ["terrain", "terrasocial", "parcelle", "lotissement", "acheter terrain"],
    "Restaurant & Bar": ["restaurant", "bar", "menu", "boisson", "manger"],
    "Laverie": ["laverie", "laver", "pressing", "nettoyage vêtements"],
    "Retail": ["retail", "boutique", "commerce", "vente"],
    "Paie & RH": ["paie", "salaire", "ressources humaines", "rh", "gestion personnel"],
    "Informations Générales": ["informations", "renseignement", "savoir plus", "détails"],
    "Devis & Commandes": ["devis", "commande", "bon de commande", "facture", "acheter", "payer"]
  };

  for (const [category, words] of Object.entries(keywords)) {
    for (const w of words) {
      if (t.includes(w)) return category;
    }
  }
  return "Non spécifié";
}

// ======================= RAPPORT QUOTIDIEN =======================

function generateDailyReport() {
  const carnet = loadCRM();
  const clients = Object.entries(carnet);

  if (clients.length === 0) {
    return "📊 *Rapport Quotidien - Mano Verde CRM*\n\n🔹 Aucun client dans le carnet.\n\n_Généré le " + new Date().toLocaleDateString("fr-FR") + " à " + new Date().toLocaleTimeString("fr-FR") + "_";
  }

  let report = "📊 *RAPPORT QUOTIDIEN - MANO VERDE CRM*\n";
  report += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
  report += `📅 *Date* : ${new Date().toLocaleDateString("fr-FR")}\n`;
  report += `👥 *Total Clients* : ${clients.length}\n\n`;
  report += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";

  // Grouper par centres d'intérêt
  const interestGroups = {};
  clients.forEach(([phone, data]) => {
    const interests = data.interets.length > 0 ? data.interets : ["Non spécifié"];
    interests.forEach(interest => {
      if (!interestGroups[interest]) interestGroups[interest] = [];
      interestGroups[interest].push({ phone, ...data });
    });
  });

  report += "🎯 *CENTRES D'INTÉRÊT*\n\n";
  Object.entries(interestGroups).forEach(([interest, clientsList]) => {
    report += `▫️ *${interest}* (${clientsList.length} client${clientsList.length > 1 ? "s" : ""})\n`;
    clientsList.forEach(c => {
      const phoneDisplay = c.phone.replace("@c.us", "").replace("237", "+237 ");
      report += `   • ${c.nom} — ${phoneDisplay}\n`;
      report += `     💬 ${c.nb_messages} msg | 📆 Dernière interaction : ${new Date(c.derniere_interaction).toLocaleDateString("fr-FR")}\n`;
    });
    report += "\n";
  });

  report += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
  report += "🔔 *ACTIVITÉ RÉCENTE (24H)*\n\n";

  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  const recentClients = clients.filter(([_, data]) =>
    new Date(data.derniere_interaction).getTime() > yesterday
  );

  if (recentClients.length === 0) {
    report += "Aucune interaction dans les dernières 24h.\n\n";
  } else {
    recentClients.forEach(([phone, data]) => {
      const phoneDisplay = phone.replace("@c.us", "").replace("237", "+237 ");
      report += `✅ *${data.nom}* — ${phoneDisplay}\n`;
      report += `   🎯 Intérêts : ${data.interets.join(", ") || "Non spécifié"}\n`;
      report += `   💬 ${data.nb_messages} messages\n\n`;
    });
  }

  report += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
  report += "_Rapport généré automatiquement par Idal - Mano Verde Bot_\n";
  report += "🤖 Pour toute information : +237 696 87 58 95";

  return report;
}

async function sendDailyReport() {
  try {
    if (!clientWhatsApp) {
      console.log("[CRM] Client WhatsApp non prêt, rapport non envoyé.");
      return;
    }
    const report = generateDailyReport();
    await clientWhatsApp.sendMessage(NUMERO_SUIVI, report);
    console.log("[CRM] ✅ Rapport quotidien envoyé à", NUMERO_SUIVI);
  } catch (e) {
    console.error("[CRM] ❌ Erreur envoi rapport:", e.message);
  }
}

function scheduleDailyReport() {
  const now = new Date();
  const nextRun = new Date();
  nextRun.setHours(DAILY_REPORT_HOUR, 0, 0, 0);

  if (now >= nextRun) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  const delay = nextRun.getTime() - now.getTime();
  console.log(`[CRM] 📅 Prochain rapport quotidien prévu le ${nextRun.toLocaleString("fr-FR")}`);

  setTimeout(() => {
    sendDailyReport();
    setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
  }, delay);
}

// ======================= INDEX LOCAL =======================

function fileListFromDirs() {
  const results = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith(".") || ["node_modules", "venv"].includes(entry)) continue;
      const full = path.join(dir, entry);
      try {
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          walk(full);
        } else {
          const ext = path.extname(entry).toLowerCase();
          if ([".txt", ".md"].includes(ext)) {
            results.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
          }
        }
      } catch (e) {
        console.error("[Scan] Erreur sur", full, e.message);
      }
    }
  }
  for (const d of SOURCE_DIRECTORIES) walk(d);
  return results;
}

async function readFileText(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".pdf") return "";
    return fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    console.error("[Parse] Erreur sur", filePath, e.message);
    return null;
  }
}

function loadState() {
  let memory = [];
  let scan = {};
  if (fs.existsSync(STORAGE_FILE)) {
    try { memory = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")); }
    catch { console.log("[IA] Impossible de lire brain_memory.json, on repart vide."); }
  }
  if (fs.existsSync(STATE_FILE)) {
    try { scan = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")); }
    catch { console.log("[Scan] Impossible de lire scan_state.json, on repart de zéro."); }
  }
  return { memory, scan };
}

function saveState(memory, scan) {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(memory));
  fs.writeFileSync(STATE_FILE, JSON.stringify(scan));
}

function embedText(text) {
  const bytes = Buffer.from(text, "utf-8");
  let sum = 0;
  for (const b of bytes) sum += b;
  return [sum / Math.max(bytes.length, 1)];
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function findBestMatch(memory, query, k = 1) {
  const qVec = embedText(query);
  const scored = memory.map(m => ({ doc: m, score: cosineSim(qVec, m.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

async function reindexIfNeeded() {
  const files = fileListFromDirs();
  const { memory, scan } = loadState();
  let changed = false;
  const newScan = {};
  const newMemory = [];

  console.log("[IA] Fichiers trouvés :", files.length);

  for (const f of files) {
    newScan[f.path] = { mtimeMs: f.mtimeMs, size: f.size };
    const prev = scan[f.path];
    if (!prev || prev.mtimeMs !== f.mtimeMs || prev.size !== f.size) {
      console.log("[Indexation] Mise à jour :", path.basename(f.path));
      const txt = await readFileText(f.path);
      if (!txt) continue;
      newMemory.push({ path: f.path, text: txt, embedding: embedText(txt) });
      changed = true;
    } else {
      const old = memory.find(m => m.path === f.path);
      if (old) newMemory.push(old);
    }
  }

  if (changed || Object.keys(scan).length !== Object.keys(newScan).length) {
    console.log("[IA] Changement détecté → réindexation complète.");
    fs.writeFileSync(STORAGE_FILE, JSON.stringify([]));
    fs.writeFileSync(STATE_FILE, JSON.stringify({}));
    saveState(newMemory, newScan);
    globalMemory = newMemory;
    console.log("[IA] Mémoire reconstruite :", newMemory.length, "documents.");
  } else {
    if (globalMemory.length === 0) globalMemory = memory;
    console.log("[Scan] Aucun changement. Mémoire :", globalMemory.length, "documents.");
  }
}

function startDocumentWatcher() {
  console.log("[Watcher] Surveillance des documents activée (interval: 60s).");
  setInterval(async () => {
    try {
      await reindexIfNeeded();
    } catch (e) {
      console.error("[Watcher] Erreur scan auto:", e.message);
    }
  }, SCAN_INTERVAL_MS);
}

// ======================= CACHE WEB =======================

async function fetchSiteText(url) {
  try {
    const res = await axios.get(url, { timeout: 10000 });
    const html = res.data || "";
    let text = String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    text = text.replace(/en pratique[^.]*foyer de cuisson[^.]*/gi, "");
    text = text.replace(/foyer de cuisson[^.]*/gi, "");
    text = text.replace(/biomasse[^.]*/gi, "");
    text = text.replace(/pyrolys[ea][^.]*/gi, "");

    return text.slice(0, 20000);
  } catch (e) {
    console.error("[Web] Impossible de récupérer", url, e.message);
    return "";
  }
}

async function refreshWebCache() {
  console.log("[Web] Rafraîchissement du cache web...");
  try {
    const t1 = await fetchSiteText("https://manovende.com");
    const t2 = await fetchSiteText("https://social.manovende.com");
    webCache.texts = [t1, t2];
    webCache.lastFetch = Date.now();
    console.log("[Web] Cache web mis à jour.");
  } catch (e) {
    console.error("[Web] Erreur refreshWebCache:", e.message);
  }
}

async function getWebContexts() {
  const age = Date.now() - webCache.lastFetch;
  if (!webCache.lastFetch || age > WEB_CACHE_TTL_MS) {
    await refreshWebCache();
  }
  return webCache.texts;
}

function startWebCacheRefresher() {
  console.log("[WebCache] Auto-refresh web activé (interval: 4h).");
  setInterval(async () => {
    try {
      await refreshWebCache();
    } catch (e) {
      console.error("[WebCache] Erreur refresh auto:", e.message);
    }
  }, WEB_CACHE_TTL_MS);
}

// ======================= FILTRE =======================

function isProfessionalMessage(text) {
  const t = text.toLowerCase();
  const motsPro = [
    "devis", "facture", "bon de commande", "commande", "souscrire", "payer", "acheter",
    "client", "contrat", "offre", "partenariat", "produit",
    "livraison", "paiement", "projet", "restaurant", "terrain",
    "bar", "laverie", "retail", "paie", "informations", "combien",
    "transport", "logistique", "camion", "remorque",
    "internet", "fibre", "connexion", "ittelecom",
    "manovende", "manoverde", "mano verde", "gecotel",
    "terrasocial", "terrain terrasocial", "bonjour"
  ];
  const motsPerso = [
    "salut", "ça va", "ca va", "sa va", "cc", "papa",
    "bonjour mon frère", "mon frere", "ma soeur", "le père",
    "bonne année", "joyeux anniversaire", "frère", "Alex", "Jonadab",
    "lol", "mdr", "😊", "😂", "❤️",
    "comment tu vas", "ma famille", "mon fils", "ma fille"
  ];
  let scorePro = 0;
  for (const m of motsPro) if (t.includes(m)) scorePro++;
  let scorePerso = 0;
  for (const m of motsPerso) if (t.includes(m)) scorePerso++;
  if (scorePerso > 0 && scorePro === 0) return false;
  return true;
}

// ======================= CONVERSION TABLEAU =======================

function convertMarkdownTableToWhatsApp(text) {
  const lines = text.split("\n");
  const output = [];
  let headers = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed.split("|").slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:\s]+$/.test(c))) continue;
      if (!inTable) {
        headers = cells;
        inTable = true;
        continue;
      }
      const name = cells[0] || "";
      const rest = cells.slice(1).map((cell, idx) => {
        const h = (headers[idx + 1] || "").replace(/\*/g, "").trim();
        return h ? `${h} : ${cell}` : cell;
      });
      output.push(`▪ *${name}* — ${rest.join(" | ")}`);
    } else {
      if (inTable) { inTable = false; headers = []; output.push(""); }
      output.push(line);
    }
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ======================= HISTORIQUE CONVERSATION =======================

async function getConversationSummary(msg, maxMessages = 5) {
  try {
    const chat = await msg.getChat();
    const messages = await chat.fetchMessages({ limit: maxMessages });
    return messages
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(m => `${m.fromMe ? "Moi" : "Client"}: ${m.body}`)
      .join("\n");
  } catch (e) {
    console.error("[Chat] Impossible de récupérer l'historique:", e.message);
    return "";
  }
}

// ======================= PERPLEXITY =======================

async function callPerplexity(question, context, webContexts, convSummary) {
  try {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) { console.error("[IA] PERPLEXITY_API_KEY manquant."); return null; }

    const webText = webContexts.filter(Boolean).join("\n\n---\n\n").slice(0, 20000);

    const prompt =
      "Tu es un assistant commercial Mano Verde / Manovende. " +
      "Tu dois répondre uniquement à partir des informations suivantes et rester dans le contexte des produits et services de l'entreprise.\n\n" +
      "INTERDICTION ABSOLUE : ne parle jamais de foyers de cuisson, de biomasse, de pyrolyse, ni d'utilisation pratique d'un foyer. " +
      "Si ces sujets sont évoqués dans les sources, tu dois les ignorer complètement.\n\n" +
      "=== CONTEXTE DOCUMENTS INTERNES ===\n" + (context || "") + "\n\n" +
      "=== CONTEXTE SITES WEB ===\n" + webText + "\n\n" +
      "=== CONTEXTE CONVERSATION ===\n" + (convSummary || "") + "\n\n" +
      "Règles importantes :\n" +
      "- Tu te limites à Mano Verde / Manovende et Terrasocial.\n" +
      "- Pour Terrasocial, les terrains et offres sont sur https://social.manovende.com.\n" +
      "- Contact uniquement : +237 696 87 58 95, direction@manovende.com, infos@manovende.com.\n" +
      "- Tu écris de façon chaleureuse, brève et claire.\n" +
      "- Pour plusieurs offres/lots : utilise une liste avec tirets ou puces, PAS un tableau Markdown.\n" +
      "- Si hors contexte, explique gentiment que ce n'est pas ton domaine.\n\n" +
      "Question du client :\n" + question;

    const resp = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      {
        model: "sonar",
        messages: [
          { role: "system", content: "Assistant commercial Mano Verde. Interdit : foyers de cuisson, biomasse, pyrolyse, tableaux Markdown." },
          { role: "user", content: prompt }
        ]
      },
      {
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        timeout: 20000
      }
    );

    let reply = (
      resp.data?.choices?.[0]?.message?.content || ""
    ).trim();

    console.log("[IA] Réponse BRUTE:", reply.substring(0, 400));

    const lower = reply.toLowerCase();
    if (
      reply.length < 40 ||
      lower.includes("je ne sais pas") ||
      lower.includes("je n'ai pas assez d'informations") ||
      lower.includes("je ne dispose pas") ||
      lower.includes("je ne peux pas répondre")
    ) {
      console.log("[IA] Réponse non pertinente, silence.");
      return null;
    }

    [
      /en pratique, vous l'utilisez comme un foyer de cuisson[^.\n]*/gi,
      /foyer de cuisson[^.\n]*/gi,
      /biomasse[^.\n]*/gi,
      /pyrolys[ea][^.\n]*/gi
    ].forEach(pat => { reply = reply.replace(pat, ""); });

    if (/foyer|biomasse/gi.test(reply)) {
      const idx = Math.min(
        ...[reply.toLowerCase().indexOf("foyer"), reply.toLowerCase().indexOf("biomasse")].filter(i => i >= 0)
      );
      reply = reply.slice(0, idx).trim();
    }

    reply = reply.replace(/(\+?237)?\s?6[0-9 ]{7,}/gi, "+237 696 87 58 95");
    reply = reply.replace(/direction@[a-z0-9.\-]+/gi, "direction@manovende.com");
    reply = reply.replace(/infos?@[a-z0-9.\-]+/gi, "infos@manovende.com");
    reply = reply.replace(/https?:\/\/[^\s]+/gi, "https://social.manovende.com");
    reply = reply.replace(/\n{3,}/g, "\n\n");

    if (reply.length > 700) reply = reply.slice(0, 700) + " [...]";

    console.log("[IA] Réponse FILTRÉE:", reply.substring(0, 400));
    return reply.trim();
  } catch (e) {
    console.error("[Perplexity] Erreur:", e.message);
    return null;
  }
}

// ======================= CLIENT WHATSAPP =======================

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "monbot-vps" }),
  puppeteer: {
    executablePath: "/root/.cache/puppeteer/chrome/linux-145.0.7632.77/chrome-linux64/chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true
  }
});

client.on("qr", qr => {
  console.log("[WhatsApp] QR code reçu :");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  console.log("[WhatsApp] ✅ Connecté avec succès.");
  clientWhatsApp = client;
  await reindexIfNeeded();
  await refreshWebCache();
  startDocumentWatcher();
  startWebCacheRefresher();
  scheduleDailyReport();
});

client.on("message", async msg => {
  try {
    if (msg.fromMe) { console.log("[Filtre] fromMe ignoré."); return; }

    const chat = await msg.getChat();
    const from = msg.from;
    const to = msg.to;

    console.log("[MSG] Reçu:", from, "->", to, "|", msg.body);

    if (from === "status@broadcast" || to === "status@broadcast") { return; }
    if (from === MON_NUMERO && to === MON_NUMERO) { return; }
    if (chat.isGroup) { console.log("[Filtre] Groupe ignoré."); return; }

    const texte = (msg.body || "").trim();
    if (!texte) return;

    if (!isProfessionalMessage(texte)) {
      console.log("[Filtre] Message personnel ignoré.");
      return;
    }

    if (!globalMemory || globalMemory.length === 0) {
      console.log("[IA] Mémoire vide, aucune réponse.");
      return;
    }

    const best = findBestMatch(globalMemory, texte, 1)[0];
    if (!best || best.score < 0.1) {
      console.log("[IA] Hors contexte (score:", best?.score ?? "null", "), silence.");
      return;
    }

    const webContexts = await getWebContexts();
    const convSummary = await getConversationSummary(msg, 6);
    const contact = await msg.getContact();

    const hasName =
      (contact.pushname && contact.pushname.trim().length > 0) ||
      (contact.name && contact.name.trim().length > 0);

    const history = await chat.fetchMessages({ limit: 10 });
    const today = new Date().toDateString();
    const alreadyGreetedToday = history.some(m => {
      const d = new Date(m.timestamp * 1000);
      return m.fromMe && d.toDateString() === today &&
        m.body.toLowerCase().includes("je suis idal de mano verde");
    });

    if (!hasName) {
      await msg.reply(
        "Bonsoir 😊, je suis Idal de Mano Verde.\n" +
        "Pour mieux vous accompagner, comment dois-je vous appeler ?"
      );
      return;
    }

    // ✅ Mise à jour CRM
    const clientName = contact.pushname || contact.name || "Inconnu";
    const interest = extractInterestFromMessage(texte);
    updateClient(from, clientName, interest);

    let answer = await callPerplexity(texte, best.doc.text, webContexts, convSummary);
    if (!answer) { console.log("[IA] Silence (garde-fou)."); return; }

    answer = answer.replace(
      /en pratique, vous l'utilisez comme un foyer de cuisson[^.]*\./gi, ""
    );
    const idxF = answer.toLowerCase().indexOf("foyer de cuisson");
    const idxB = answer.toLowerCase().indexOf("biomasse");
    const cut = [idxF, idxB].filter(i => i >= 0);
    if (cut.length) answer = answer.slice(0, Math.min(...cut)).trim();

    answer = convertMarkdownTableToWhatsApp(answer);

    const displayName = contact.pushname || contact.name || "";
    const politeIntro = !alreadyGreetedToday
      ? (displayName ? `Bonsoir ${displayName} 😊, je suis Idal de Mano Verde.\n` : "Bonsoir 😊, je suis Idal de Mano Verde.\n")
      : (displayName ? `Merci ${displayName} pour votre message.\n` : "Merci pour votre message.\n");

    const sentences = answer.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    const chunks = [];
    let current = "";
    for (const s of sentences) {
      const future = current ? current + " " + s : s;
      const count = (future.match(/[.!?]/g) || []).length;
      if (count > 4 || future.length > 350) {
        if (current) chunks.push(current);
        current = s;
      } else {
        current = future;
      }
    }
    if (current) chunks.push(current);

    if (chunks.length > 0) {
      await msg.reply(
        politeIntro + chunks[0] +
        "\n\nPour nous joindre : +237 696 87 58 95, direction@manovende.com ou infos@manovende.com."
      );
    }
    for (let i = 1; i < chunks.length; i++) await msg.reply(chunks[i]);

    console.log("[IA] Réponse envoyée en", chunks.length, "message(s).");
  } catch (e) {
    console.error("[Bot] Erreur:", e.message);
  }
});

client.initialize();
