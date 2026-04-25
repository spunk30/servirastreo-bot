import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./knowledge.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ---------- Respuesta normal (horario de atencion) ----------
// history: [{role:"user"|"assistant", content}]
// returns { reply, escalate }
export async function generateReply(history, userMessage) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: "user", content: userMessage }
  ];

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.4,
    max_tokens: 400
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || "";
  const escalate = /\[\[ESCALAR\]\]/i.test(raw);
  const reply = raw.replace(/\[\[ESCALAR\]\]/gi, "").trim();
  return { reply, escalate };
}

// ---------- Clasificador de emergencia (fuera de horario) ----------
// Determina si un mensaje es una EMERGENCIA real que amerita atencion
// despues de las 7pm. Para Servirastreo solo son emergencias:
//   - Robo / hurto de vehiculo
//   - Necesidad URGENTE de bloquear o apagar el motor remotamente
export async function classifyEmergency(userMessage) {
  const prompt = `Eres un clasificador de mensajes para Servirastreo GPS, empresa de rastreo satelital.
Determina si el siguiente mensaje del cliente es una EMERGENCIA que requiere
atencion inmediata fuera de horario laboral (despues de las 7 pm).

SOLO cuentan como emergencia:
- Robo o hurto de vehiculo (ej: "me robaron la moto", "se llevaron el carro", "hurto en curso")
- Necesidad urgente de bloquear o apagar el motor del vehiculo remotamente
  (ej: "necesito bloquear el vehiculo ya", "apaguenme el motor es urgente")

NO son emergencias (responder NO):
- Consultas de precios, planes, cotizaciones
- Soporte de la app, login, cuentas
- Facturacion, renovaciones, vencimientos
- "El GPS no marca", "no veo la ubicacion en la app" (es soporte normal)
- Saludos, preguntas generales, informacion

Mensaje del cliente: """${userMessage}"""

Responde UNICAMENTE con una palabra: SI o NO. Nada mas.`.trim();

  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 5
    });
    const raw = (resp.choices?.[0]?.message?.content || "").trim().toUpperCase();
    return raw.startsWith("SI") || raw.startsWith("SÍ") || raw === "S";
  } catch (err) {
    console.error("classifyEmergency error:", err.message);
    // En caso de duda, tratar como NO emergencia y que lo revise el asesor
    return false;
  }
}

// ---------- Respuesta de emergencia (fuera de horario) ----------
// Toma los datos minimos al cliente y escala siempre a humano.
export async function generateEmergencyReply(history, userMessage) {
  const emergencyPrompt = `${SYSTEM_PROMPT}

# MODO EMERGENCIA (fuera de horario)
El cliente esta escribiendo DESPUES del horario laboral (8am-7pm) y
reporta una EMERGENCIA real (robo/hurto de vehiculo o necesidad urgente
de bloqueo remoto).

Tu respuesta debe:
1. Mostrar empatia y calma.
2. Pedir los datos clave para actuar rapido:
   - Placa del vehiculo
   - Lugar y hora aproximada del hecho
   - Si ya puso la denuncia ante la policia (solo en caso de robo)
3. Confirmar que se va a contactar URGENTE al tecnico de turno.
4. NO confirmar acciones tecnicas que no puedes ejecutar (no digas
   "ya bloquee el motor" ni "ya estoy rastreando"). Solo recoge datos.

Respuesta CORTA, calmada, directa. Maximo 5 lineas.`.trim();

  const messages = [
    { role: "system", content: emergencyPrompt },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: "user", content: userMessage }
  ];

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.3,
    max_tokens: 300
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || "";
  // Limpiamos cualquier marca de escalar que haya quedado
  const reply = raw.replace(/\[\[ESCALAR\]\]/gi, "").trim();
  // Siempre escalar en emergencia (para que Deivis vea el pendiente al abrir panel)
  return { reply, escalate: true };
}
