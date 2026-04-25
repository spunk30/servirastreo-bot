// Transcripcion de notas de voz / audio usando OpenAI Whisper.
// Cuando llega un mensaje WhatsApp con audio, este modulo:
//   1) Verifica si es realmente audio
//   2) Descarga el archivo desde WAHA
//   3) Lo manda a Whisper (modelo whisper-1) con idioma "es"
//   4) Devuelve el texto transcrito (string vacio si algo falla)

import OpenAI from "openai";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const WAHA_BASE = process.env.WAHA_API_URL?.replace(/\/$/, "") || "";
const WAHA_API_KEY = process.env.WAHA_API_KEY;

// True si el payload de WAHA representa un mensaje de audio / nota de voz.
export function isAudioMessage(data) {
  if (!data?.hasMedia) return false;
  const mt =
    data.media?.mimetype ||
    data._data?.mimetype ||
    data.mimetype ||
    "";
  return typeof mt === "string" && mt.toLowerCase().startsWith("audio/");
}

// True si trae media pero NO es audio (imagen, video, documento, etc.)
export function isNonAudioMedia(data) {
  if (!data?.hasMedia) return false;
  return !isAudioMessage(data);
}

// La URL que WAHA pone en el payload puede usar el hostname interno
// "waha" que no resuelve desde el contenedor del bot. La reescribimos
// para que use WAHA_API_URL (ej: http://157.173.205.33:3002).
function fixWahaUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  if (!WAHA_BASE) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const externalBase = new URL(WAHA_BASE);
    u.protocol = externalBase.protocol;
    u.host = externalBase.host;
    return u.toString();
  } catch {
    return rawUrl;
  }
}

async function downloadAudioBuffer(mediaUrl) {
  const url = fixWahaUrl(mediaUrl);
  const headers = {};
  if (WAHA_API_KEY) headers["X-Api-Key"] = WAHA_API_KEY;

  const resp = await axios.get(url, {
    headers,
    responseType: "arraybuffer",
    timeout: 30000
  });
  return Buffer.from(resp.data);
}

// Extension de archivo segun mimetype, para que Whisper lo acepte.
function pickExtension(mimetype = "") {
  const m = mimetype.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  if (m.includes("wav")) return ".wav";
  if (m.includes("m4a") || m.includes("mp4")) return ".m4a";
  if (m.includes("webm")) return ".webm";
  // Por defecto, WhatsApp usa Opus en contenedor OGG
  return ".ogg";
}

// Transcribe el audio del mensaje. Devuelve "" si no es audio,
// no se pudo descargar, o Whisper fallo.
export async function transcribeVoiceNote(data) {
  if (!isAudioMessage(data)) return "";

  const mediaUrl =
    data.media?.url ||
    data._data?.mediaUrl ||
    data.mediaUrl;
  if (!mediaUrl) {
    console.error("transcribeVoiceNote: no hay mediaUrl en payload");
    return "";
  }

  let tmpFile = null;
  try {
    const audioBuffer = await downloadAudioBuffer(mediaUrl);

    const mimetype = data.media?.mimetype || data._data?.mimetype || "audio/ogg";
    const ext = pickExtension(mimetype);
    tmpFile = path.join(os.tmpdir(), `voice-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    fs.writeFileSync(tmpFile, audioBuffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
      language: "es",
      // Prompt opcional para mejorar palabras especificas del dominio
      prompt: "Servirastreo, GPS, rastreo, vehiculo, placa, moto, robo, hurto, bloqueo."
    });

    const text = (transcription.text || "").trim();
    return text;
  } catch (err) {
    console.error("transcribeVoiceNote error:", err?.response?.data || err.message);
    return "";
  } finally {
    if (tmpFile && fs.existsSync(tmpFile)) {
      try {
        fs.unlinkSync(tmpFile);
      } catch (e) {
        // ignorar fallo al borrar archivo temporal
      }
    }
  }
}
