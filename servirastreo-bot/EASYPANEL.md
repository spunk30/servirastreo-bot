# Despliegue en Easypanel

Guia paso a paso para levantar Postgres + Evolution API + Bot Servirastreo
con Easypanel en tu VPS (157.173.205.33).

---

## 1. Quitar Dokploy primero (si sigue corriendo)

Dokploy y Easypanel ambos usan el puerto 3000, asi que hay que sacarlo
antes. Conectate por SSH al VPS y corre:

```bash
# Ver que contenedores de Dokploy hay
docker ps -a | grep -i dokploy

# Detener y borrar contenedores + volumenes de Dokploy
docker rm -f $(docker ps -aq --filter "name=dokploy") 2>/dev/null
docker volume rm $(docker volume ls -q --filter "name=dokploy") 2>/dev/null

# Eliminar el directorio de datos
sudo rm -rf /etc/dokploy

# Verificar que el puerto 3000 quede libre
sudo ss -ltnp | grep :3000
```

Si el ultimo comando no devuelve nada, listo, puerto libre.

---

## 2. Instalar Easypanel

```bash
curl -sSL https://get.easypanel.io | sh
```

Tarda 2-3 minutos. Al terminar te muestra la URL para entrar:

```
http://157.173.205.33:3000
```

La primera vez crea la cuenta admin (usuario + clave).

**Firewall:** si UFW esta activo, abre puertos 80, 443 y 3000:

```bash
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 3000
```

---

## 3. Crear el proyecto y servicio Compose

1. En Easypanel: **+ Project** -> nombre: `servirastreo`.
2. Dentro del proyecto: **+ Service** -> **Compose**.
3. Nombre del servicio: `servirastreo-stack`.

### 3.1 Source del compose

Easypanel te pide donde esta el docker-compose.yml. Dos opciones:

**Opcion A (recomendada): Git**
- Provider: **Git**
- Repository URL: `https://github.com/TU_USUARIO/servirastreo-bot.git`
- Branch: `main`
- Compose file: `docker-compose.yml`

Primero debes subir el proyecto a GitHub (instrucciones en la seccion 7).

**Opcion B: Contenido directo**
- Provider: **GitHub/Git** con la URL del repo igual que arriba.

Easypanel necesita el repo para poder construir la imagen del bot
(porque el compose tiene `build: .`).

---

## 4. Variables de entorno

Pestaña **Environment** del servicio. Pega esto y reemplaza cada
`CAMBIAME` con un valor real:

```
POSTGRES_PASSWORD=GENERA_CLAVE_LARGA
EVOLUTION_API_KEY=GENERA_OTRA_CLAVE_LARGA
EVOLUTION_SERVER_URL=https://evolution.tu-dominio.com
OPENAI_API_KEY=sk-proj-TU_LLAVE_DE_OPENAI
PANEL_USER=deivis
PANEL_PASSWORD=CLAVE_PARA_EL_PANEL
WEBHOOK_TOKEN=GENERA_OTRA_CLAVE_LARGA
```

Para generar claves largas abre un terminal en el VPS y corre:

```bash
openssl rand -hex 24
```

---

## 5. Dominios

En Easypanel, pestaña **Domains** del servicio.

Easypanel maneja cada contenedor del compose como un sub-servicio.
Vas a ver los tres: `postgres`, `evolution-api`, `servirastreo-bot`.

### Para evolution-api
- Host: `evolution.tu-dominio.com` (o usa el dominio gratis que de Easypanel)
- Port: `8080`
- HTTPS: ON

### Para servirastreo-bot
- Host: `bot.tu-dominio.com`
- Port: `3000`
- HTTPS: ON

**Postgres no necesita dominio** (solo red interna).

Despues de guardar los dominios, vuelve a la pestaña Environment y
actualiza `EVOLUTION_SERVER_URL` con el dominio real que quedo.

---

## 6. Deploy

Click en **Deploy**. Easypanel:

1. Clona el repo de GitHub.
2. Construye la imagen del bot desde `Dockerfile`.
3. Descarga Postgres 16 y Evolution API v2.2.3.
4. Levanta los tres servicios en la red interna del proyecto.

Revisa los logs en la pestaña **Logs** de cada servicio.

---

## 7. Subir el codigo a GitHub (si aun no lo hiciste)

La forma mas rapida sin usar git desde terminal:

1. Ve a [github.com/new](https://github.com/new).
2. Repository name: `servirastreo-bot`.
3. Marca **Public** (no hay secretos en el codigo gracias a `${VAR}`).
4. Clic **Create repository**.
5. En la pagina vacia, clic en **"uploading an existing file"**.
6. Arrastra TODO el contenido de la carpeta `servirastreo-bot`
   (archivos sueltos, no la carpeta envuelta).
7. Clic **Commit changes**.

---

## 8. Vincular tu WhatsApp a Evolution API

Con Evolution corriendo y con su dominio activo, en Easypanel abre una
terminal (hay un boton **Terminal** en cada servicio) o usa tu PC con
estos tres curls:

### 8.1 Crear la instancia

```bash
curl -X POST \
  "https://evolution.tu-dominio.com/instance/create" \
  -H "apikey: TU_EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "servirastreo",
    "integration": "WHATSAPP-BAILEYS",
    "qrcode": true
  }'
```

### 8.2 Pedir el QR

Abre en el navegador:

```
https://evolution.tu-dominio.com/instance/connect/servirastreo
```

Te devuelve un JSON con el QR en base64. La forma mas facil es copiar el
string base64 (sin el prefijo `data:image/png;base64,`) y pegarlo en
[base64.guru/converter/decode/image](https://base64.guru/converter/decode/image)
para verlo como imagen.

Escanealo desde WhatsApp del celular:
**Ajustes -> Dispositivos vinculados -> Vincular un dispositivo**.

### 8.3 Configurar el webhook hacia el bot

```bash
curl -X POST \
  "https://evolution.tu-dominio.com/webhook/set/servirastreo" \
  -H "apikey: TU_EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "url": "http://servirastreo-bot:3000/webhook?token=TU_WEBHOOK_TOKEN",
    "events": ["MESSAGES_UPSERT"],
    "webhookByEvents": false
  }'
```

La URL del webhook usa el nombre interno `servirastreo-bot` porque
ambos contenedores estan en la red del mismo proyecto de Easypanel.

---

## 9. Probar

1. Abre `https://bot.tu-dominio.com/panel/` con `PANEL_USER` y `PANEL_PASSWORD`.
2. Debe decir **BOT APAGADO** y estado WhatsApp **open** (verde).
3. Pide a alguien que te escriba al numero vinculado.
4. En el panel ves en el log: `IN NombreCliente: mensaje...`
5. Como esta apagado, el mensaje te llega al celular normal.
6. Prende el bot con el boton verde.
7. Que te vuelvan a escribir -> la IA responde con el tono de Servirastreo.

---

## 10. Dia a dia

- **De dia:** panel en OFF. Atiendes tu desde el celular.
- **En la noche / fin de semana:** entras al panel, prendes el bot.
- **Casos complejos:** la IA los deja marcados en "Pendientes" para que
  los revises tu en la manhana.

---

## Problemas comunes

**"Connection refused" entre bot y Evolution.**
Los dos servicios deben estar en la misma red del compose. Mira que en
la pestaña Network del proyecto de Easypanel se vean los 3.

**"apikey invalid" al llamar Evolution.**
La `EVOLUTION_API_KEY` del bot (env) debe ser IDENTICA al
`AUTHENTICATION_API_KEY` de Evolution. Copia la misma en ambos.

**El QR expira.** Tienes 30 segundos por intento. Vuelve a pedir.

**WhatsApp se desconecta.** Re-escanear. No es frecuente si no abusas
del volumen de respuestas.
