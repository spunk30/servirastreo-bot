// Cliente minimo para WAHA (WhatsApp HTTP API)
// Mantengo el nombre del archivo (evolution.js) por compatibilidad con los
// imports, pero internamente todo es WAHA.
import axios from "axios";

const BASE = process.env.WAHA_API_URL?.replace(/\/$/, "");
const API_KEY = process.env.WAHA_API_KEY;
const SESSION = process.env.WAHA_SESSION || "default";

function client() {
  if (!BASE) {
    throw new Error("Falta la variable WAHA_API_URL");
  }
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-Api-Key"] = API_KEY;
  return axios.create({
    baseURL: BASE,
    headers,
    timeout: 15000
  });
}

// Convierte un numero plano en chatId de WAHA.
// Ej: "573001234567" -> "573001234567@c.us"
// Si ya viene con @ se deja tal cual.
function toChatId(numberOrJid) {
  if (!numberOrJid) return numberOrJid;
  if (String(numberOrJid).includes("@")) return numberOrJid;
  return `${numberOrJid}@c.us`;
}

// Enviar mensaje de texto.
// Acepta tanto "573001234567" como "573001234567@c.us".
export async function sendText(toNumberOrChatId, text) {
  const cli = client();
  const body = {
    chatId: toChatId(toNumberOrChatId),
    text,
    session: SESSION
  };
  const { data } = await cli.post("/api/sendText", body);
  return data;
}

// Estado de la sesion (para mostrar en el panel).
// WAHA status puede ser: STARTING, SCAN_QR_CODE, WORKING, FAILED, STOPPED
export async function connectionState() {
  const cli = client();
  try {
    const { data } = await cli.get(`/api/sessions/${SESSION}`);
    return {
      state: data.status || data.state,
      session: data.name,
      engine: data.engine?.engine,
      me: data.me
    };
  } catch (err) {
    return { error: err.response?.status || err.message };
  }
}
