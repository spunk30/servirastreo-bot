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

// ----------- Webhook de WAHA -----------
// WAHA envia eventos tipo "message". Configurado en docker-compose.yml via
// WHATSAPP_HOOK_URL=http://servirastreo-bot:3000/webhook?token=EL_TOKEN
//
// Payload de WAHA:
// {
//   event: "message",
//   session: "default",
//   payload: {
//     id: "false_573001234567@c.us_ABC123",
//     from: "573001234567@c.us",
//     fromMe: false,
//     body: "Hola",
//     notifyName: "Juan",
//     hasMedia: false,
//     timestamp: 1719...
//   }
// }
app.post("/webhook", async (req, res) => {
  try {
    if (WEBHOOK_TOKEN && req.query.token !== WEBHOOK_TOKEN) {
      return res.status(401).json({ error: "token invalido" });
    }

    const payload = req.body || {};
    const event = payload.event;
    res.json({ ok: true }); // responder rapido a WAHA

    // Solo procesamos mensajes entrantes nuevos
    if (event !== "message") return;

    const data = payload.payload || {};
    if (data.fromMe) return; // no responder a uno mismo

    const chatId = data.from;
    if (!chatId || chatId.endsWith("@g.us")) return; // ignorar grupos

    const text = data.body || "";
    if (!text) return;

    const pushName = data.notifyName || data._data?.notifyName || "Cliente";

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
      await sendText(chatId, reply);
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
