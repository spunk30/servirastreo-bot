import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getState,
  setEnabled,
  pushMessage,
  getHistory,
  addPending,
  removePending,
  logEvent
} from "./state.js";
import { sendText, connectionState } from "./evolution.js";
import { generateReply } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ----------- Auth basica para el panel -----------
function basicAuth(req, res, next) {
  const user = process.env.PANEL_USER;
  const pass = process.env.PANEL_PASSWORD;
  if (!user || !pass) return next();
  const hdr = req.headers.authorization || "";
  if (!hdr.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Servirastreo Bot"');
    return res.status(401).send("Auth required");
  }
  const [u, p] = Buffer.from(hdr.slice(6), "base64").toString().split(":");
  if (u === user && p === pass) return next();
  res.setHeader("WWW-Authenticate", 'Basic realm="Servirastreo Bot"');
  return res.status(401).send("Credenciales invalidas");
}

// ----------- Panel web -----------
app.use("/panel", basicAuth, express.static(path.join(__dirname, "..", "public")));

app.get("/api/status", basicAuth, async (req, res) => {
  const s = getState();
  const conn = await connectionState();
  res.json({
    enabled: s.enabled,
    toggledAt: s.toggledAt,
    pending: s.pending,
    log: s.log.slice(0, 30),
    evolution: conn
  });
});

app.post("/api/toggle", basicAuth, (req, res) => {
  const next = !getState().enabled;
  setEnabled(next);
  res.json({ enabled: next });
});

app.post("/api/pending/:ts/resolve", basicAuth, (req, res) => {
  removePending(req.params.ts);
  res.json({ ok: true });
});

// ----------- Webhook de Evolution API -----------
// Evolution envia eventos tipo messages.upsert. Configura el webhook apuntando
// a: https://TU_DOMINIO/webhook?token=EL_TOKEN
app.post("/webhook", async (req, res) => {
  try {
    if (WEBHOOK_TOKEN && req.query.token !== WEBHOOK_TOKEN) {
      return res.status(401).json({ error: "token invalido" });
    }

    const payload = req.body || {};
    const event = payload.event || payload.Event;
    res.json({ ok: true }); // responder rapido a Evolution

    // Solo procesamos mensajes entrantes nuevos
    if (event !== "messages.upsert") return;

    const data = payload.data || {};
    if (data.key?.fromMe) return; // no responder a uno mismo

    const chatId = data.key?.remoteJid;
    if (!chatId || chatId.endsWith("@g.us")) return; // ignorar grupos

    // Extraer texto del mensaje (Evolution usa varios campos segun tipo)
    const msg = data.message || {};
    const text =
      msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.imageMessage?.caption ||
      msg.videoMessage?.caption ||
      "";
    if (!text) return;

    const pushName = data.pushName || "Cliente";
    const toNumber = chatId.split("@")[0];

    logEvent(`IN ${pushName}: ${text.slice(0, 80)}`);
    pushMessage(chatId, "user", text);

    if (!getState().enabled) {
      // Bot apagado: no respondemos, solo guardamos historial
      return;
    }

    // Bot encendido: generar respuesta con IA
    const history = getHistory(chatId).slice(0, -1); // excluir el que acabamos de agregar
    const { reply, escalate } = await generateReply(history, text);

    if (reply) {
      await sendText(toNumber, reply);
      pushMessage(chatId, "assistant", reply);
      logEvent(`OUT ${pushName}: ${reply.slice(0, 80)}`);
    }

    if (escalate) {
      addPending({
        chatId,
        name: pushName,
        summary: text.slice(0, 200)
      });
    }
  } catch (err) {
    console.error("webhook error:", err?.response?.data || err.message);
    logEvent(`ERROR webhook: ${err.message}`);
  }
});

// Redirect root -> panel
app.get("/", (_req, res) => res.redirect("/panel/"));

app.listen(PORT, () => {
  console.log(`Servirastreo bot escuchando en puerto ${PORT}`);
  console.log(`Panel:   http://localhost:${PORT}/panel/`);
  console.log(`Webhook: http://localhost:${PORT}/webhook?token=${WEBHOOK_TOKEN}`);
});
