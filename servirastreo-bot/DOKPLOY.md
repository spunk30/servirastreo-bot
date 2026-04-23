# Despliegue en Dokploy

Guia paso a paso para levantar el stack completo (Postgres + Evolution API
+ Bot Servirastreo) usando Dokploy en tu VPS.

---

## 1. Instalar Dokploy en el VPS

Conectate a tu VPS por SSH y corre:

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

Al terminar, Dokploy queda corriendo en el puerto **3000** del servidor.
Abre en tu navegador:

```
http://IP_DE_TU_VPS:3000
```

Crea la cuenta de admin (usuario + clave).

**Nota:** si tu VPS tiene firewall (UFW, iptables, o el de Oracle/AWS),
abre los puertos **80**, **443** y **3000** en las reglas.

---

## 2. Configurar el dominio (opcional pero recomendado)

Si tienes un dominio, apunta dos subdominios a la IP del VPS:

```
evolution.tu-dominio.com  -> IP_VPS
bot.tu-dominio.com        -> IP_VPS
```

Dokploy + Traefik se encargan de los certificados SSL automaticamente
despues. Si no tienes dominio todavia, puedes usar el IP directo con
puertos, pero el QR de WhatsApp funciona mejor con HTTPS.

---

## 3. Crear el proyecto en Dokploy

1. En Dokploy: **Projects -> Create Project** -> nombre: `servirastreo`.
2. Dentro del proyecto: **+ Create Service -> Compose**.
3. Nombre del compose: `servirastreo-stack`.
4. En **Source** elige una de dos opciones:

### Opcion A: pegar el compose directo

- Source type: **Raw**.
- Pega el contenido de `docker-compose.yml` de este repo.

### Opcion B: desde Git

- Source type: **Github / Gitlab / Git**.
- URL del repo donde subiste el proyecto.
- Compose Path: `docker-compose.yml`.
- Build Path: `.` (para que construya el Dockerfile del bot).

### 3.1 Editar las variables

Antes de desplegar, reemplaza en el compose los siguientes valores
marcados `CAMBIAME` (o usa la seccion de Environment de Dokploy):

| Variable                          | Valor recomendado                               |
|-----------------------------------|-------------------------------------------------|
| `POSTGRES_PASSWORD`               | genera una clave larga (ej. `openssl rand -hex 16`) |
| `AUTHENTICATION_API_KEY`          | otra clave larga para Evolution API             |
| `DATABASE_CONNECTION_URI`         | debe usar la MISMA `POSTGRES_PASSWORD` de arriba |
| `EVOLUTION_API_KEY`               | la MISMA `AUTHENTICATION_API_KEY` de arriba     |
| `SERVER_URL`                      | `https://evolution.tu-dominio.com`              |
| `OPENAI_API_KEY`                  | tu llave de platform.openai.com                 |
| `PANEL_PASSWORD`                  | la clave para entrar al panel del bot           |
| `WEBHOOK_TOKEN`                   | otra clave larga aleatoria                      |

---

## 4. Publicar los servicios (Domains)

Dentro del compose, en Dokploy abre la pestaña **Domains** y agrega:

### Para Evolution API

- Service: `evolution-api`
- Host: `evolution.tu-dominio.com`
- Path: `/`
- Port: `8080`
- HTTPS: ON (let's encrypt)

### Para el bot

- Service: `servirastreo-bot`
- Host: `bot.tu-dominio.com`
- Path: `/`
- Port: `3000`
- HTTPS: ON (let's encrypt)

---

## 5. Deploy

Click en **Deploy**. Dokploy va a:

1. Construir la imagen del bot desde el `Dockerfile`.
2. Descargar la imagen oficial de Evolution API y Postgres.
3. Levantar los tres servicios en la misma red interna.

Ve los logs en tiempo real desde la pestaña **Logs** de cada servicio.

---

## 6. Vincular tu WhatsApp con Evolution API

Con Evolution corriendo, crea la instancia:

```bash
curl -X POST \
  "https://evolution.tu-dominio.com/instance/create" \
  -H "apikey: TU_AUTHENTICATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "servirastreo",
    "integration": "WHATSAPP-BAILEYS",
    "qrcode": true
  }'
```

Luego pide el QR para escanearlo con tu celular:

```bash
curl "https://evolution.tu-dominio.com/instance/connect/servirastreo" \
  -H "apikey: TU_AUTHENTICATION_API_KEY"
```

Te devuelve un JSON con un campo `base64` (el QR como imagen).
Pegalo en un decodificador base64 -> imagen (hay decenas online) o
simplemente abre en el navegador:

```
https://evolution.tu-dominio.com/instance/connect/servirastreo
```

Escanea el QR desde WhatsApp -> **Dispositivos vinculados** -> **Vincular
un dispositivo**.

---

## 7. Conectar el webhook al bot

```bash
curl -X POST \
  "https://evolution.tu-dominio.com/webhook/set/servirastreo" \
  -H "apikey: TU_AUTHENTICATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "url": "http://servirastreo-bot:3000/webhook?token=TU_WEBHOOK_TOKEN",
    "events": ["MESSAGES_UPSERT"],
    "webhookByEvents": false
  }'
```

**Importante:** la URL usa `http://servirastreo-bot:3000` (el nombre
interno del servicio en Docker). No necesita salir a internet: ambos
servicios hablan por la red interna de Docker.

---

## 8. Probar

1. Abre `https://bot.tu-dominio.com/panel/` con `PANEL_USER` y
   `PANEL_PASSWORD`.
2. Deberias ver: **BOT APAGADO** y estado WhatsApp **open** (verde).
3. Pide que alguien te escriba (o escribete desde otro numero).
4. Ves en el log del panel: `IN NombreCliente: mensaje...`.
5. Como esta apagado, el mensaje te llega normal al celular.
6. Prende el bot con el boton verde.
7. Que te vuelva a escribir -> la IA responde.

---

## 9. Operacion diaria

- **De dia:** panel en OFF. Tu respondes normal desde el celular.
- **En la noche / cuando te vas a descansar:** entras al panel, prendes
  el bot, y a dormir. La IA contesta por ti usando el contexto de
  Servirastreo. Los casos complejos se acumulan en "Pendientes".
- **En la manhana:** apagas el bot, abres los pendientes en el panel, y
  respondes tu manualmente los que quedaron marcados.

---

## 10. Tips de seguridad

- Cambia todos los `CAMBIAME` con valores largos y aleatorios.
  `openssl rand -hex 24` te genera uno bien random.
- El puerto 8080 (Evolution) expuesto publicamente es ok porque pide
  `apikey` en cada request. Aun asi, si no lo necesitas publico (el
  bot ya lo usa por red interna), puedes quitar el dominio publico de
  Evolution y solo dejar el del bot.
- Hazle backup periodico a los volumenes `postgres_data` y
  `evolution_instances` — ahi vive tu sesion de WhatsApp.

---

## 11. Problemas comunes

**El QR expira antes de escanearlo.** Vuelve a pedirlo con el endpoint
`/instance/connect/servirastreo`. Tienes 30 segundos cada vez.

**El webhook no dispara.** Confirma con `GET /webhook/find/servirastreo`
que la URL quedo guardada. Y mira los logs de Evolution API.

**La IA no responde y el bot esta ON.** Mira los logs del servicio
`servirastreo-bot` en Dokploy. Lo mas comun es `OPENAI_API_KEY` invalida.

**WhatsApp me desconecta.** Puede pasar si le das mucho uso y Meta te
marca. No sobre-espamees y limita las respuestas automaticas a noches.
Si se cae la sesion tienes que re-escanear el QR.
