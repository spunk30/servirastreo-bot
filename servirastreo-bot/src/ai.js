import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./knowledge.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Adendum que se concatena al system prompt cuando estamos fuera de horario
// laboral pero NO es una emergencia. El objetivo es que el bot siga siendo
// util (respondiendo precios referenciales, info de planes, FAQ, soporte
// basico) y solo escale a humano cuando realmente no pueda resolver.
const OFF_HOURS_ADDENDUM = `
# CONTEXTO ADICIONAL - FUERA DE HORARIO
El mensaje del cliente esta llegando FUERA del horario de atencion humana
(antes de las 8:00 am o despues de las 7:00 pm, hora Colombia).

# Politica a esta hora (MUY IMPORTANTE)
Fuera del horario laboral SOLO atendemos EMERGENCIAS: robo o hurto de
vehiculo y bloqueo remoto urgente del motor. Cualquier otro tipo de
soporte tecnico, cotizacion, cobro, renovacion o cambio en plataforma
se atiende al dia siguiente a partir de las 8:00 am.

Tu tarea:
1. Responde con normalidad cualquier cosa que puedas resolver tu solo
   sin necesidad de un humano:
   - Informacion general de la empresa y los servicios
   - Explicacion de planes (basico vs completo con app + alertas)
   - FAQ: como instalar la app, como ver el vehiculo, como funciona el GPS
   - Pasos de autoservicio (descargar Servirastreo Pro, restablecer clave)
   - Cualquier consulta puramente informativa
2. Si la consulta NO es algo que tu puedas resolver solo (requiere
   revisar la cuenta del cliente, soporte tecnico con acceso a la
   plataforma, cotizacion exacta segun modelo, cobros/renovaciones,
   cambios en el plan o cualquier cosa que necesite un asesor humano):
   a) Explicale al cliente de forma amable y clara POR QUE no se puede
      atender ahora: "A esta hora solo atendemos emergencias como robo
      o bloqueo urgente del vehiculo; el resto de consultas las atendemos
      manana desde las 8:00 am."
   b) Confirma que tomaste nota y que un asesor lo contactara manana a
      partir de las 8:00 am.
   c) Si el cliente insiste en que es urgente pero NO describe una
      emergencia real (robo o bloqueo urgente), repite con calma la
      politica sin ser tajante: SOLO robo/hurto o bloqueo urgente entran
      como emergencia fuera de horario.
   d) Si el cliente aclara que SI se trata de robo/hurto o bloqueo
      urgente, pidele que lo describa brevemente en su proximo mensaje
      para activar el protocolo de emergencia.
3. Solo incluye [[ESCALAR]] al final si la consulta DE VERDAD requiere
   que un humano la toque manana. Si resolviste tu la consulta, NO
   escales.
4. NO digas que "un asesor lo llamara en X minutos" — la atencion humana
   es solo en la manhana.
5. Evita repetir el mismo mensaje dos veces seguidas. Si el cliente
   insiste, varia la redaccion y mantente firme pero empatico.

Las emergencias reales (robo/hurto o bloqueo urgente) se manejan en otro
flujo, aqui NO las vas a ver.
`.trim();

// ---------- Respuesta normal ----------
// history: [{role:"user"|"assistant", content}]
// options: { offHours: boolean } - si true, agrega contexto de fuera de horario
// returns { reply, escalate }
export async function generateReply(history, userMessage, options = {}) {
  const { offHours = false } = options;
  const systemContent = offHours
    ? `${SYSTEM_PROMPT}\n\n${OFF_HOURS_ADDENDUM}`
    : SYSTEM_PROMPT;

  const messages = [
    { role: "system", content: systemContent },
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
