// Persistencia simple en archivo JSON. Guarda:
//   - estado ON/OFF del bot
//   - historial breve por chat (para contexto de IA)
//   - cola de pendientes humanos
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const FILE = path.join(DATA_DIR, "state.json");

const DEFAULT = {
  enabled: false,          // bot apagado por defecto
  toggledAt: null,
  conversations: {},       // { chatId: [{role, content, ts}] }
  pending: [],             // [{chatId, name, summary, ts}]
  log: []                  // ultimos eventos (max 200)
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(FILE)) return { ...DEFAULT };
  try {
    return { ...DEFAULT, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    return { ...DEFAULT };
  }
}

function save(state) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

let state = load();

export function getState() {
  return state;
}

export function setEnabled(value) {
  state.enabled = !!value;
  state.toggledAt = new Date().toISOString();
  logEvent(value ? "BOT_ON" : "BOT_OFF");
  save(state);
  return state.enabled;
}

export function pushMessage(chatId, role, content) {
  if (!state.conversations[chatId]) state.conversations[chatId] = [];
  state.conversations[chatId].push({
    role,
    content,
    ts: new Date().toISOString()
  });
  // Mantener solo ultimos 12 mensajes por chat (~6 turnos)
  if (state.conversations[chatId].length > 12) {
    state.conversations[chatId] = state.conversations[chatId].slice(-12);
  }
  save(state);
}

export function getHistory(chatId) {
  return state.conversations[chatId] || [];
}

export function addPending({ chatId, name, summary }) {
  state.pending.unshift({
    chatId,
    name: name || chatId,
    summary,
    ts: new Date().toISOString()
  });
  if (state.pending.length > 50) state.pending.length = 50;
  logEvent(`PENDING ${name || chatId}`);
  save(state);
}

export function removePending(ts) {
  state.pending = state.pending.filter((p) => p.ts !== ts);
  save(state);
}

export function logEvent(text) {
  state.log.unshift({ ts: new Date().toISOString(), text });
  if (state.log.length > 200) state.log.length = 200;
  save(state);
}
