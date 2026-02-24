require("dotenv").config();

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs-node");
const axios = require("axios");

// =======================
// CONFIG GLOBALE
// =======================

const SOURCE_DIRECTORIES = [
  "/opt/monbot/documents"
];

const STORAGE_FILE = "./brain_memory.json"; // embeddings + textes
const STATE_FILE = "./scan_state.json";     // état fichiers (mtime, size)
const MON_NUMERO = "237696875895@c.us";

// =======================
// VECTEUR / INDEX LOCAL
// =======================

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
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".pdf") {
      return "";
    } else {
      return fs.readFileSync(filePath, "utf-8");
    }
  } catch (e) {
    console.error("[Parse] Erreur sur", filePath, e.message);
    return null;
  }
}

function loadState() {
  let memory = [];
  let scan = {};

  if (fs.existsSync(STORAGE_FILE)) {
    try {
      memory = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8"));
    } catch (e) {
      console.log("[IA] Impossible de lire brain_memory.json, on repart vide.");
    }
  }

  if (fs.existsSync(STATE_FILE)) {
    try {
      scan = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    } catch (e) {
      console.log("[Scan] Impossible de lire scan_state.json, on repart de zéro.");
    }
  }

  return { memory, scan };
}

function saveState(memory, scan) {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(memory));
  fs.writeFileSync(STATE_FILE, JSON.stringify(scan));
}

// Embedding simple (moyenne des codes UTF-8)
function embedText(text) {
  const bytes = Buffer.from(text, "utf-8");
  let sum = 0;
  for (const b of bytes) sum += b;
  const avg = sum / Math.max(bytes.length, 1);
  return [avg];
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
  const scored = memory.map(m => ({
    doc: m,
    score: cosineSim(qVec, m.embedding)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

async function reindexIfNeeded() {
  const files = fileListFromDirs();
  const { memory, scan } = loadState();

  const newScan = {};
  const newMemory = [];
  let changed = false;

  console.log("[IA] Fichiers trouvés :", files.length);

  for (const f of files) {
    newScan[f.path] = { mtimeMs: f.mtimeMs, size: f.size };
    const prev = scan[f.path];

    if (!prev || prev.mtimeMs !== f.mtimeMs || prev.size !== f.size) {
      console.log("[Indexation] Mise à jour :", path.basename(f.path));
      const txt = await readFileText(f.path);
      if (!txt) continue;
      const emb = embedText(txt);
      newMemory.push({ path: f.path, text: txt, embedding: emb });
      changed = true;
    } else {
      const old = memory.find(m => m.path === f.path);
      if (old) newMemory.push(old);
    }
  }

  if (changed || Object.keys(scan).length !== Object.keys(newScan).length) {
    console.log("[IA] Indexation terminée.");
    saveState(newMemory, newScan);
    console.log("[IA] Mémoire de travail :", newMemory.length, "documents.");
    return newMemory;
  } else {
    console.log("[Scan] Pas de changement dans les documents.");
    console.log("[IA] Mémoire de travail :", memory.length, "documents.");
    return memory;
  }
}

// =======================
// FILTRE PRO / PERSO
// =======================

function isProfessionalMessage(text) {
  const t = text.toLowerCase();

  const motsPro = [
    "devis", "facture", "bon de commande", "commande", "souscrire", "payer", "acheter",
    "client", "contrat", "offre", "partenariat", "produit",
    "livraison", "paiement", "projet", "restaurant", "terrain",
    "bar", "laverie", "retail", "hotel", "informations",
    "transport", "logistique", "camion", "remorque",
    "internet", "fibre", "connexion", "ittelecom",
    "manovende", "manoverde", "mano verde", "gecotel",
    "foyer", "biomasse", "cuisson", "energie", "énergie",
    "terrasocial", "terrain terrasocial"
  ];

  const motsPerso = [
    "salut", "ça va", "ca va", "sa va", "cc",
    "bonjour mon frère", "mon frere", "ma soeur",
    "bonne année", "joyeux anniversaire",
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

// =======================
// CONTEXTE WEB MANOVENDE
// =======================

async function fetchSiteText(url) {
  try {
    const res = await axios.get(url, { timeout: 10000 });
    const html = res.data || "";
    const text = String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 20000);
  } catch (e) {
    console.error("[Web] Impossible de récupérer", url, e.message);
    return "";
  }
}

// =======================
// APPEL PERPLEXITY + GARDE-FOU
// =======================

async function callPerplexity(question, context, webContexts) {
  try {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      console.error("[IA] PERPLEXITY_API_KEY manquant.");
      return null;
    }

    const webText = webContexts.filter(Boolean).join("\n\n---\n\n").slice(0, 20000);

    const prompt =
      "Tu es un assistant commercial Mano Verde / Manovende. " +
      "Tu dois répondre uniquement à partir des informations suivantes " +
      "et rester dans le contexte des produits et services de l'entreprise.\n\n" +
      "=== CONTEXTE DOCUMENTS INTERNES ===\n" + (context || "") + "\n\n" +
      "=== CONTEXTE SITES WEB ===\n" + webText + "\n\n" +
      "Règles importantes :\n" +
      "- Tu utilises toujours le terme « foyer de cuisson amélioré à biomasse » pour parler du produit, " +
      "jamais « four à pyrolyse ».\n" +
      "- Tu n'expliques pas la chimie de la pyrolyse, mais la manière d'utiliser le foyer au quotidien " +
      "(allumage, ajout de biomasse, réglage de l'air, sécurité, confort).\n" +
      "- Si la question n'a aucun rapport avec ces contextes, dis-le simplement.\n\n" +
      "Question du client :\n" + question;

    const body = {
      model: "sonar",
      messages: [
        { role: "system", content: "Assistant commercial Mano Verde / Manovende." },
        { role: "user", content: prompt }
      ]
    };

    const resp = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      body,
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        timeout: 20000
      }
    );

    const completion =
      resp.data &&
      resp.data.choices &&
      resp.data.choices[0] &&
      resp.data.choices[0].message &&
      resp.data.choices[0].message.content;

    let reply = (completion || "").trim();

    const lower = reply.toLowerCase();
    const isTooGeneric =
      reply.length < 40 ||
      lower.includes("je ne sais pas") ||
      lower.includes("je n'ai pas assez d'informations") ||
      lower.includes("je ne dispose pas des informations nécessaires") ||
      lower.includes("je ne peux pas répondre");

    if (!reply || isTooGeneric) {
      console.log("[IA] Réponse IA jugée non pertinente, aucune réponse envoyée.");
      return null;
    }

    // Vocabulaire produit
    reply = reply.replace(/four(s)? (à|a) pyrolyse/gi, "foyer de cuisson amélioré à biomasse");
    reply = reply.replace(/pyrolyse/gi, "processus de combustion optimisé");
    reply = reply.replace(/foyer amélioré/gi, "foyer de cuisson amélioré à biomasse");
    reply = reply.replace(/four (ecologique|écolo|écologique)/gi, "foyer de cuisson amélioré à biomasse");

    // Limiter la longueur
    if (reply.length > 900) {
      reply = reply.slice(0, 900) + " [...]";
    }

    const intro =
      "Bonjour, je suis l'assistant de Mano Verde / Manovende.\n" +
      "Pouvez-vous préciser en quelques mots votre besoin (terrain Terrasocial, foyer de cuisson amélioré à biomasse, internet, autre) ?\n\n";

    reply = intro + reply;

    return reply;
  } catch (e) {
    console.error("[Perplexity] Erreur:", e.message);
    return null;
  }
}

// =======================
// CLIENT WHATSAPP
// =======================

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "monbot-vps"
  }),
  puppeteer: {
    executablePath: "/root/.cache/puppeteer/chrome/linux-145.0.7632.77/chrome-linux64/chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true
  }
});

client.on("qr", qr => {
  console.log("[WhatsApp] QR code reçu, scanne-le pour connecter le bot :");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  console.log("[WhatsApp] Connecté avec succès.");
  await reindexIfNeeded();
});

client.on("message", async msg => {
  try {
    const chat = await msg.getChat();

    const from = msg.from;
    const to = msg.to;

    console.log("[MSG] Reçu:", from, "->", to, "|", msg.body);

    // 1) Ignorer tous les statuts / diffusions
    if (from === "status@broadcast" || to === "status@broadcast") {
      console.log("[Filtre] Message de statut/broadcast ignoré.");
      return;
    }

    // 2) Ignorer les notes perso / toi vers toi
    if (from === MON_NUMERO && to === MON_NUMERO) {
      console.log("[Filtre] Message perso (toi->toi) ignoré.");
      return;
    }

    // 3) Ignorer les groupes
    if (chat.isGroup) {
      console.log("[Filtre] Message de groupe ignoré.");
      return;
    }

    const texte = (msg.body || "").trim();
    if (!texte) return;

    // 4) Filtre pro/perso
    if (!isProfessionalMessage(texte)) {
      console.log("[Filtre] Message jugé personnel, ignoré.");
      return;
    }

    // 5) Recherche mémoire locale
    const { memory } = loadState();
    if (!memory || memory.length === 0) {
      console.log("[IA] Mémoire vide, aucune réponse.");
      return;
    }

    const bestArr = findBestMatch(memory, texte, 1);
    const best = bestArr[0];

    if (!best || best.score < 0.1) {
      console.log("[IA] Question hors contexte (score:", best ? best.score : "null", "), aucune réponse.");
      return;
    }

    const context = best.doc.text;

    // 6) Contexte web
    const webContexts = [];
    webContexts.push(await fetchSiteText("https://manovende.com"));
    webContexts.push(await fetchSiteText("https://social.manovende.com"));

    // 7) Appel IA
    const answer = await callPerplexity(texte, context, webContexts);

    if (!answer) {
      console.log("[IA] Pas de réponse IA (garde-fou), silence.");
      return;
    }

    console.log("[IA] Réponse envoyée au client.");
    await msg.reply(answer);
  } catch (e) {
    console.error("[Bot] Erreur handler message:", e.message);
    return;
  }
});

client.initialize();
