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
import {
  generateReply,
  classifyEmergency,
  generateEmergencyReply
} from "./ai.js";
import { isBusinessHours, BUSINESS_HOURS_TEXT } from "./hours.js";
import {
  isAudioMessage,
  isNonAudioMedia,
  transcribeVoiceNote
} from "./voice.js";

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
    if (!chatId) return;

    // Filtrar todo lo que NO sea una conversacion 1-a-1 con una persona.
    // Esto evita que el bot responda (y termine publicando) en:
    //   - Grupos:                      *@g.us
    //   - Estados / historias / lists: status@broadcast, *@broadcast
    //   - Canales / newsletters:       *@newsletter
    if (
      chatId.endsWith("@g.us") ||
      chatId.endsWith("@broadcast") ||
      chatId.endsWith("@newsletter") ||
      chatId.includes("status@")
    ) return;

    // Defensa extra: WAHA a veces marca explicitamente los estados con
    // estos flags en el payload. Si vienen, ignorar.
    if (data.broadcast === true) return;
    if (data._data?.isStatusV3 === true) return;
    if (data._data?.broadcast === true) return;

    const pushName = data.notifyName || data._data?.notifyName || "Cliente";

    // ----- Resolver el TEXTO del mensaje -----
    // El cliente puede mandar:
    //   a) Texto puro                        -> data.body trae el texto
    //   b) Imagen/video/audio con caption    -> data.body trae el caption
    //   c) Nota de voz / audio sin caption   -> transcribimos con Whisper
    //   d) Imagen/video/doc sin caption      -> respondemos pidiendo texto
    let text = data.body || "";
    let wasVoiceNote = false;

    if (!text && isAudioMessage(data)) {
      logEvent(`AUDIO recibido de ${pushName}, transcribiendo...`);
      try {
        text = await transcribeVoiceNote(data);
      } catch (err) {
        console.error("transcribe error:", err.message);
        text = "";
      }
      wasVoiceNote = true;

      if (text) {
        logEvent(`AUDIO transcrito ${pushName}: ${text.slice(0, 80)}`);
      } else {
        // Fallback: no se pudo transcribir el audio
        const fallback =
          `Hola ${pushName}, recibimos su mensaje de voz pero no logramos ` +
          `entenderlo bien. ¿Puede escribirnos su consulta en un mensaje ` +
          `de texto, por favor? Si es una EMERGENCIA (robo o bloqueo ` +
          `urgente del vehiculo), por favor descibala por escrito para ` +
          `atenderla de inmediato.`;
        try {
          await sendText(chatId, fallback);
          pushMessage(chatId, "user", "[nota de voz no transcrita]");
          pushMessage(chatId, "assistant", fallback);
          logEvent(`OUT ${pushName}: [audio fallback]`);
        } catch (e) {
          logEvent(`ERROR fallback audio: ${e.message}`);
        }
        return;
      }
    } else if (!text && isNonAudioMedia(data)) {
      // Imagen, video, documento o sticker sin caption: el bot no los
      // procesa hoy, responder educadamente pidiendo texto.
      const mediaFallback =
        `Hola ${pushName}, recibimos su archivo pero por ahora solo ` +
        `podemos atender mensajes de texto o notas de voz. ¿Puede ` +
        `describirnos su consulta? Si es una EMERGENCIA, por favor ` +
        `cuentenos brevemente que sucedio.`;
      try {
        await sendText(chatId, mediaFallback);
        pushMessage(chatId, "user", "[archivo multimedia sin texto]");
        pushMessage(chatId, "assistant", mediaFallback);
        logEvent(`OUT ${pushName}: [media fallback]`);
      } catch (e) {
        logEvent(`ERROR fallback media: ${e.message}`);
      }
      return;
    }

    if (!text) return;

    // Marcar en el log si vino por voz
    const inLabel = wasVoiceNote ? "IN-VOZ" : "IN";
    logEvent(`${inLabel} ${pushName}: ${text.slice(0, 80)}`);
    pushMessage(chatId, "user", text);

    if (!getState().enabled) {
      // Bot apagado: no respondemos, solo guardamos historial
      return;
    }

    // Bot encendido: decidir flujo segun horario de atencion
    const history = getHistory(chatId).slice(0, -1); // excluir el que acabamos de agregar
    let reply = "";
    let escalate = false;

    if (isBusinessHours()) {
      // ----- HORARIO LABORAL (8am-7pm) -----
      const r = await generateReply(history, text);
      reply = r.reply;
      escalate = r.escalate;
    } else {
      // ----- FUERA DE HORARIO (7pm-8am) -----
      const isEmergency = await classifyEmergency(text);

      if (isEmergency) {
        // Emergencia real: atender con protocolo de urgencia
        logEvent(`EMERGENCIA ${pushName}: ${text.slice(0, 80)}`);
        const r = await generateEmergencyReply(history, text);
        reply = r.reply;
        escalate = true;
      } else {
        // No urgente: avisar horario y agendar para la manhana
        reply =
          `Hola ${pushName}, gracias por escribir a Servirastreo GPS.\n\n` +
          `Nuestro horario de atencion es ${BUSINESS_HOURS_TEXT}. ` +
          `Tomo nota de su consulta y un asesor se comunicara con usted ` +
          `manhana a partir de las 8:00 am.\n\n` +
          `Si se trata de una EMERGENCIA (robo/hurto del vehiculo o ` +
          `bloqueo remoto urgente), por favor indiquelo en su proximo ` +
          `mensaje para atenderlo de inmediato.`;
        escalate = true; // queda pendiente para que Deivis lo vea en la manhana
      }
    }

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
