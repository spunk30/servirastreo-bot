// Horario de atencion de Servirastreo GPS
// Lunes a Domingo: 8:00 am - 7:00 pm, zona horaria America/Bogota
//
// Si en el futuro quieres cambiar el horario (ej: fines de semana diferente),
// editas OPEN_HOUR / CLOSE_HOUR, o adaptas isBusinessHours() para evaluar dia.

const OPEN_HOUR = 8;    // 8 am
const CLOSE_HOUR = 19;  // 7 pm (formato 24h)
const TZ = "America/Bogota";

// Retorna la hora actual (0-23) en zona horaria Bogota.
function bogotaHour(date = new Date()) {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hour12: false
  }).format(date);
  // En algunos runtimes "24" se usa para medianoche; normalizamos a 0
  const h = parseInt(hourStr, 10);
  return Number.isFinite(h) ? (h % 24) : 0;
}

// True si estamos dentro del horario de atencion.
export function isBusinessHours(date = new Date()) {
  const h = bogotaHour(date);
  return h >= OPEN_HOUR && h < CLOSE_HOUR;
}

// String legible de la hora actual en Bogota, para logs.
export function bogotaNowString(date = new Date()) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

// Texto del horario para mostrarlo al cliente.
export const BUSINESS_HOURS_TEXT = "lunes a domingo, de 8:00 am a 7:00 pm";
