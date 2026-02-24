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
const MON_NUMERO = "237696875895@c.us";

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
  const ext = path.extname(filePath).toLowerCase();
  try {
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
    try {
      memory = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8"));
    } catch {
      console.log("[IA] Impossible de lire brain_memory.json, on repart vide.");
    }
  }
  if (fs.existsSync(STATE_FILE)) {
    try {
      scan = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    } catch {
      console.log("[Scan] Impossible de lire scan_state.json, on repart de zéro.");
    }
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

// ======================= FILTRE PRO / PERSO =======================

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
    "terrasocial", "terrain terrasocial", "mano verde"
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

// ======================= CONTEXTE WEB =======================

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

// ======================= HISTORIQUE CONVERSATION =======================

async function getConversationSummary(msg, maxMessages = 5) {
  try {
    const chat = await msg.getChat();
    const messages = await chat.fetchMessages({ limit: maxMessages });
    const parts = messages
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(m => `${m.fromMe ? "Moi" : "Client"}: ${m.body}`)
      .join("\n");
    return parts;
  } catch (e) {
    console.error("[Chat] Impossible de récupérer l'historique:", e.message);
    return "";
  }
}

// ======================= APPEL PERPLEXITY =======================

async function callPerplexity(question, context, webContexts, convSummary) {
  try {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      console.error("[IA] PERPLEXITY_API_KEY manquant.");
      return null;
    }

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
      "- Pour Terrasocial, rappelle que les terrains et les offres sont détaillés sur https://social.manovende.com.\n" +
      "- Pour tout besoin de contact, tu donnes uniquement : téléphone +237 696 87 58 95, emails direction@manovende.com et infos@manovende.com.\n" +
      "- Tu écris de façon chaleureuse, brève et claire, comme un humain poli.\n" +
      "- Si la question n'a aucun rapport avec ces contextes, tu expliques gentiment que ce n'est pas ton domaine.\n\n" +
      "Question du client :\n" + question;

    const body = {
      model: "sonar",
      messages: [
        { role: "system", content: "Assistant commercial Mano Verde / Manovende. Ne jamais parler de foyers de cuisson, biomasse ou pyrolyse." },
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
    console.log("[IA] Réponse BRUTE (500 chars):", reply.substring(0, 500));

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

    // Nettoyage agressif de tout ce qui parle de foyer / biomasse (niveau IA)
    const forbiddenPatterns = [
      /en pratique, vous l'utilisez comme un foyer de cuisson[^.\n]*/gi,
      /foyer de cuisson[^.\n]*/gi,
      /biomasse[^.\n]*/gi,
      /pyrolys[ea][^.\n]*/gi
    ];
    for (const pat of forbiddenPatterns) {
      reply = reply.replace(pat, "");
    }
    if (/foyer/gi.test(reply) || /biomasse/gi.test(reply)) {
      const idxF = reply.toLowerCase().indexOf("foyer");
      const idxB = reply.toLowerCase().indexOf("biomasse");
      const idxList = [idxF, idxB].filter(i => i >= 0);
      const cutIndex = idxList.length ? Math.min(...idxList) : reply.length;
      reply = reply.slice(0, cutIndex).trim();
    }

    // normaliser les contacts et liens
    reply = reply.replace(/(\+?237)?\s?6[0-9 ]{7,}/gi, "+237 696 87 58 95");
    reply = reply.replace(/direction@[a-z0-9.\-]+/gi, "direction@manovende.com");
    reply = reply.replace(/infos?@[a-z0-9.\-]+/gi, "infos@manovende.com");
    reply = reply.replace(/https?:\/\/[^\s]+/gi, "https://social.manovende.com");

    reply = reply.replace(/\n\s*\n\s*\n+/g, "\n\n");

    if (reply.length > 700) reply = reply.slice(0, 700) + " [...]";
    console.log("[IA] Réponse FILTRÉE (500 chars):", reply.substring(0, 500));
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

    if (from === "status@broadcast" || to === "status@broadcast") {
      console.log("[Filtre] Message de statut/broadcast ignoré.");
      return;
    }
    if (from === MON_NUMERO && to === MON_NUMERO) {
      console.log("[Filtre] Message perso (toi->toi) ignoré.");
      return;
    }
    if (chat.isGroup) {
      console.log("[Filtre] Message de groupe ignoré.");
      return;
    }

    const texte = (msg.body || "").trim();
    if (!texte) return;

    if (!isProfessionalMessage(texte)) {
      console.log("[Filtre] Message jugé personnel, ignoré.");
      return;
    }

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

    const webContexts = [];
    webContexts.push(await fetchSiteText("https://manovende.com"));
    webContexts.push(await fetchSiteText("https://social.manovende.com"));

    const convSummary = await getConversationSummary(msg, 6);

    const contact = await msg.getContact();
    const hasName =
      (contact.pushname && contact.pushname.trim().length > 0) ||
      (contact.name && contact.name.trim().length > 0);

    const history = await chat.fetchMessages({ limit: 10 });
    const today = new Date().toDateString();
    const alreadyGreetedToday = history.some(m => {
      const d = new Date(m.timestamp * 1000);
      return m.fromMe && d.toDateString() === today && m.body.includes("Je suis Idal de Mano Verde");
    });
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

    // Supprimer la phrase foyer/biomasse dans le contenu web AVANT d'envoyer à l'IA
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

    if (!hasName) {
      await msg.reply(
        "Bonsoir 😊, je suis Idal de Mano Verde.\n" +
        "Pour mieux vous accompagner, comment dois-je vous appeler ?"
      );
      console.log("[IA] Demande du nom envoyée, pas de réponse IA principale.");
      return;
    }

    let answer = await callPerplexity(texte, context, webContexts, convSummary);
    if (!answer) {
      console.log("[IA] Pas de réponse IA (garde-fou), silence.");
      return;
    }

    // Filet de sécurité final : on enlève encore la phrase exacte si elle traîne
    const forbiddenSentence =
      "En pratique, vous l'utilisez comme un foyer de cuisson classique : vous allumez le feu avec un petit allume-feu, ajoutez progressivement la biomasse bien sèche et réglez l'arrivée d'air pour obtenir une flamme stable et propre.";
    answer = answer.replace(forbiddenSentence, "");
    const idxF = answer.toLowerCase().indexOf("foyer de cuisson");
    const idxB = answer.toLowerCase().indexOf("biomasse");
    const cutIdxCandidates = [idxF, idxB].filter(i => i >= 0);
    if (cutIdxCandidates.length > 0) {
      const cutAt = Math.min(...cutIdxCandidates);
      answer = answer.slice(0, cutAt).trim();
    }

    const displayName = contact.pushname || contact.name || "";
    const politeIntro = !alreadyGreetedToday
      ? (displayName
          ? `Bonsoir ${displayName} 😊, je suis Idal de Mano Verde.\n`
          : "Bonsoir 😊, je suis Idal de Mano Verde.\n")
      : (displayName ? `Merci ${displayName} pour votre message.\n` : "Merci pour votre message.\n");

    const sentences = answer
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(Boolean);

    const chunks = [];
    let current = "";
    for (const s of sentences) {
      const future = current ? current + " " + s : s;
      const sentenceCount = (future.match(/[.!?]/g) || []).length;
      if (sentenceCount > 4 || future.length > 350) {
        if (current) chunks.push(current);
        current = s;
      } else {
        current = future;
      }
    }
    if (current) chunks.push(current);

    if (chunks.length > 0) {
      const firstMessage =
        politeIntro +
        chunks[0] +
        "\n\nPour nous joindre directement : +237 696 87 58 95, " +
        "direction@manovende.com ou infos@manovende.com.";
      await msg.reply(firstMessage);
    }

    for (let i = 1; i < chunks.length; i++) {
      await msg.reply(chunks[i]);
    }

    console.log("[IA] Réponse envoyée au client en", chunks.length, "message(s).");
  } catch (e) {
    console.error("[Bot] Erreur handler message:", e.message);
    return;
  }
});

client.initialize();
