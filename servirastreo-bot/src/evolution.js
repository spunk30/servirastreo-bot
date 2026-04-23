// Cliente minimo para Evolution API v2
import axios from "axios";

const BASE = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
const API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE;

function client() {
  if (!BASE || !API_KEY || !INSTANCE) {
    throw new Error(
      "Faltan variables EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE"
    );
  }
  return axios.create({
    baseURL: BASE,
    headers: { apikey: API_KEY, "Content-Type": "application/json" },
    timeout: 15000
  });
}

// Enviar mensaje de texto
// Nota: Evolution API v2 usa la ruta correcta /message/sendText/{instance}
// (eso explica el 404 anterior que tenias con /api/sendText)
export async function sendText(toNumber, text) {
  const cli = client();
  const body = {
    number: toNumber,
    text
  };
  const { data } = await cli.post(`/message/sendText/${INSTANCE}`, body);
  return data;
}

// Estado de la instancia (para mostrar en el panel)
export async function connectionState() {
  const cli = client();
  try {
    const { data } = await cli.get(`/instance/connectionState/${INSTANCE}`);
    return data;
  } catch (err) {
    return { error: err.response?.status || err.message };
  }
}
