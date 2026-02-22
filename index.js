require("dotenv").config();

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs-node");
const axios = require("axios");

// Dossier sources à indexer (documents déjà copiés ici)
const SOURCE_DIRECTORIES = [
  "/Users/all/Documents/Mano_Verde_SA/MonBot/documents"
];

const STORAGE_FILE = "./brain_memory.json"; // embeddings + textes
const STATE_FILE = "./scan_state.json";     // état fichiers (mtime, size)
const MON_NUMERO = "237696875895@c.us";

// Formulaires PDF publics
const FORMULAIRES = {
  souscription_transport:
    "/Users/all/Documents/Mano_Verde_SA/MonBot/documents/Formulaire_Publique/formulaire_souscription_transport.pdf",
  souscription_restaurant:
    "/Users/all/Documents/Mano_Verde_SA/MonBot/documents/Formulaire_Publique/formulaire_souscription_restaurant.pdf",
  prospectus_mano_verde:
    "/Users/all/Documents/Mano_Verde_SA/MonBot/documents/Formulaire_Publique/prospectus_mano_verde.pdf"
};

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
    // On ne gère plus les PDF côté serveur pour éviter les problèmes de pdf-parse
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
    "manovende", "manoverde", "mano verde", "gecotel"
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
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
    return text.slice(0, 4000);
  } catch (e) {
    console.error("[Web] Erreur pour", url, e.message);
    return "";
  }
}

// =======================
// DÉTECTION DEMANDE FORMULAIRE
// =======================

function detectFormRequest(text) {
  const t = text.toLowerCase();

  if (t.includes("formulaire") || t.includes("fiche") || t.includes("souscription")) {
    if (t.includes("transport") || t.includes("camion") || t.includes("logistique")) {
      return FORMULAIRES.souscription_transport;
    }
    if (t.includes("restaurant") || t.includes("restauration") || t.includes("bar")) {
      return FORMULAIRES.souscription_restaurant;
    }
    if (t.includes("prospectus") || t.includes("présentation") || t.includes("presentation")) {
      return FORMULAIRES.prospectus_mano_verde;
    }
    return FORMULAIRES.souscription_transport;
  }

  return null;
}

// =======================
// INDEXATION
// =======================

async function reindexIfNeeded() {
  let { memory, scan } = loadState();

  const files = fileListFromDirs();
  console.log(`[IA] Fichiers trouvés : ${files.length}`);

  const currentPaths = new Set(files.map(f => f.path));
  memory = memory.filter(m => currentPaths.has(m.path));

  for (const f of files) {
    const prev = scan[f.path];
    if (prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) {
      continue;
    }

    const text = await readFileText(f.path);
    if (!text || text.trim().length < 50) continue;

    console.log(`[Indexation] Mise à jour : ${path.basename(f.path)}`);

    memory = memory.filter(m => m.path !== f.path);

    const emb = embedText(text);
    memory.push({
      path: f.path,
      embedding: emb,
      content: text.slice(0, 5000)
    });

    scan[f.path] = { mtimeMs: f.mtimeMs, size: f.size };
    saveState(memory, scan);
  }

  console.log("[IA] Indexation terminée.");
  return memory;
}

// =======================
// APPEL PERPLEXITY (MANOVENDE)
// =======================

async function callPerplexity(contextText, userMessage) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return "❌ PERPLEXITY_API_KEY manquante dans .env";
  }

  const webContexts = [];
  webContexts.push(await fetchSiteText("https://manovende.com"));
  webContexts.push(await fetchSiteText("https://social.manovende.com"));
  const extraWeb = webContexts.filter(Boolean).join("\n\n");

  const body = {
    model: "sonar",
    messages: [
      {
        role: "system",
        content:
          "Tu es un assistant commercial francophone. " +
          "Tu ne mentionnes pas les noms des entreprises internes (Manovende, GECOTEL, Ittelecom, etc.) " +
          "sauf si le client les mentionne lui-même. " +
          "Tu réponds simplement en tant qu'« assistant commercial ». " +
          "Tu utilises le contexte documentaire pour comprendre les produits, services et conditions, " +
          "mais tu NE DONNES JAMAIS la structure détaillée des dossiers ou des fichiers. " +
          "Tu NE DIVULGUES PAS d'informations explicitement internes, confidentielles ou sensibles " +
          "(contrats détaillés, montants précis, coordonnées personnelles, numéros de documents, etc.). " +
          "Si une question demande quelque chose de confidentiel, tu restes général ou tu expliques poliment " +
          "que ces informations ne peuvent pas être partagées."
      },
      {
        role: "user",
        content:
          "Contexte documentaire interne (extraits, uniquement pour toi, ne pas lister ces documents au client) :\n" +
          contextText +
          "\n\nContexte web Manovende (site officiel, réseaux sociaux) :\n" +
          extraWeb +
          "\n\nQuestion du client (réponds-lui directement, sans parler du 'contexte', des fichiers ou du site) :\n" +
          userMessage
      }
    ]
  };

  try {
    const resp = await axios.post("https://api.perplexity.ai/chat/completions", body, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      timeout: 60000
    });

    const choice = (resp.data.choices || [])[0] || {};
    const msg = choice.message || {};
    return msg.content || JSON.stringify(resp.data);
  } catch (e) {
    console.error("[Perplexity] Erreur:", e.message);
    return "❌ Erreur lors de l'appel à l'IA.";
  }
}

// =======================
// WHATSAPP
// =======================

async function start() {
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true
    }
  });

  client.on("qr", qr => qrcode.generate(qr, { small: true }));

  client.on("ready", async () => {
    console.log("[WhatsApp] Connecté avec succès.");

    const memory = await reindexIfNeeded();
    console.log(`[IA] Mémoire de travail : ${memory.length} documents.`);

    // IMPORTANT : ne pas envoyer de message automatique vers ton propre numéro
    // pour ne pas ouvrir la conversation "Notes / Statut" :
    // await client.sendMessage(MON_NUMERO, "✅ Assistant commercial IA prêt sur WhatsApp.");

    client.on("message", async msg => {
      const chat = await msg.getChat();

      // 1) Ignorer les groupes
      if (chat.isGroup) return;

      // 2) Récupérer les IDs
      const from = msg.from;
      const to = msg.to;

      // 3) Bloquer TOUT échange où ton numéro parle à ton numéro
      //    (c'est la conversation "Notes / Story / Statut")
      if (from === MON_NUMERO && to === MON_NUMERO) {
        return;
      }

      // 4) Filtre pro/perso sur le contenu
      if (!isProfessionalMessage(msg.body)) {
        return;
      }

      try {
        const best = findBestMatch(memory, msg.body, 1);
        if (!best.length) {
          return;
        }

        const doc = best[0].doc;
        await chat.sendStateTyping();

        const reply = await callPerplexity(doc.content, msg.body);

        // Envoi éventuel d'un formulaire PDF
        const pdfPath = detectFormRequest(msg.body);
        if (pdfPath && fs.existsSync(pdfPath)) {
          try {
            await chat.sendStateTyping();
            await msg.reply("Je vous envoie le formulaire en pièce jointe.");
            await msg.reply(fs.createReadStream(pdfPath));
          } catch (e) {
            console.error("[WhatsApp] Erreur envoi PDF:", e);
          }
        }

        // Latence 2–5s par ligne puis réponse texte
        const lines = String(reply).split("\n").filter(l => l.trim().length > 0);
        let delay = 0;
        for (const line of lines) {
          const extra = Math.min(5, Math.max(2, Math.floor(line.length / 40)));
          delay += extra;
        }
        await new Promise(r => setTimeout(r, delay * 1000));

        await msg.reply(reply);
      } catch (e) {
        console.error("[WhatsApp] Erreur message:", e);
      }
    });
  });

  client.initialize();
}

start();
