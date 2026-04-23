# Servirastreo Bot

Bot de WhatsApp para Servirastreo GPS que se conecta a tu Evolution API
existente, responde con IA (OpenAI) cuando tu lo activas, y tiene un panel
web con boton ON/OFF y cola de casos pendientes.

---

## 1. Arreglar el 404 de tu Evolution API

El error que tenias era por la ruta. En Evolution API **v2** las rutas son:

| Que querias hacer             | Ruta CORRECTA                               |
|-------------------------------|----------------------------------------------|
| Enviar texto                  | `POST /message/sendText/{instance}`          |
| Ver estado de la conexion     | `GET  /instance/connectionState/{instance}`  |
| Listar instancias             | `GET  /instance/fetchInstances`              |
| Crear instancia               | `POST /instance/create`                      |
| QR para vincular el telefono  | `GET  /instance/connect/{instance}`          |

Y el cuerpo de sendText cambio: `number` en lugar de `to`, y el nombre
de instancia ya NO va en el body sino en la URL.

**Prueba rapida (cambia los tres valores en mayuscula):**

```bash
curl -X POST \
  "https://evolutionapi-evolution-api.4ctmyh.easypanel.host/message/sendText/TU_INSTANCIA" \
  -H "apikey: TU_APIKEY" \
  -H "Content-Type: application/json" \
  -d '{"number":"573012229034","text":"Hola desde Servirastreo"}'
```

Si te responde un JSON con `key` y `status: "PENDING"` o `SERVER_ACK`, todo
bien: tu instancia esta conectada y puedes enviar mensajes. Si te da 401
es tema de `apikey`. Si te da 404 todavia, es que el nombre de instancia
esta mal escrito; listas las instancias con:

```bash
curl "https://evolutionapi-evolution-api.4ctmyh.easypanel.host/instance/fetchInstances" \
  -H "apikey: TU_APIKEY"
```

---

## 2. Como funciona este bot

Flujo:

1. Alguien te escribe al WhatsApp.
2. Evolution API (ya desplegado) recibe el mensaje y lo reenvia por
   webhook a este bot.
3. El bot consulta su estado:
   - Si esta **OFF**: solo lo registra y no hace nada (tu contestas desde el
     celular normalmente).
   - Si esta **ON**: manda el mensaje a GPT-4o-mini con el contexto de
     Servirastreo y devuelve la respuesta al cliente por Evolution API.
4. Si la IA detecta que hay que escalar a humano (cliente pide hablar con
   alguien, esta molesto, pide precio exacto, etc.) agrega la conversacion
   a la lista de *Pendientes* del panel para que tu la revises manhana.

Tu controlas el ON/OFF desde el panel web con un boton grande.

---

## 3. Despliegue

Elige el panel con el que te sientas mas comodo:

- **[EASYPANEL.md](./EASYPANEL.md)** — guia con Easypanel (recomendada si
  prefieres una interfaz mas simple).
- **[DOKPLOY.md](./DOKPLOY.md)** — guia con Dokploy (alternativa open source).

El mismo `docker-compose.yml` funciona en ambos paneles sin cambios.

---

## 4. Correr en local (para pruebas)

```bash
cd servirastreo-bot
cp .env.example .env
# edita .env con tus claves reales
npm install
npm start
```

Para que Evolution API llegue al bot local desde internet, usa
[ngrok](https://ngrok.com) o [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/):

```bash
ngrok http 3000
# copia la URL https que te de y usala como webhook url en Evolution
```

---

## 5. Personalizar las respuestas

Toda la "personalidad" del bot esta en **`src/knowledge.js`**. Edita ese
archivo (tono, reglas, precios guia, politica de escalamiento) y reinicia
el servicio. No necesitas tocar mas nada.

---

## 6. Costo estimado de OpenAI

Con `gpt-4o-mini` (el modelo configurado), cada mensaje cuesta ~0.0001
USD. Si te escriben 50 clientes por noche durante un mes completo
(~1500 mensajes), el total mensual ronda **USD 1 a 3**.

Para bajarlo a cero puedes cambiar `OPENAI_MODEL` en `.env` a otro
modelo mas barato o reemplazar el cliente por Groq/Gemini (ver
comentarios en `src/ai.js`).

---

## 7. Archivos del proyecto

```
servirastreo-bot/
├── Dockerfile
├── README.md
├── package.json
├── .env.example
├── .gitignore
├── public/
│   └── index.html          # Panel ON/OFF
└── src/
    ├── server.js           # Express + webhook + API panel
    ├── state.js            # Persistencia (data/state.json)
    ├── evolution.js        # Cliente Evolution API
    ├── ai.js               # Cliente OpenAI
    └── knowledge.js        # Prompt/contexto de Servirastreo  <-- EDITA AQUI
```

---

## 8. Proximos pasos opcionales

- Agregar **horarios automaticos** (ej. bot ON 8pm-8am de lunes a viernes).
- Conectar la info real de vehiculos consultando Traccar/GPS Wox cuando
  el cliente de la placa.
- Guardar historial en Postgres si el volumen crece.
- Enviar notificacion push a tu celular cuando haya un pendiente.

Avisame cual quieres y lo agregamos.
