// Empire clip server: serves the game, receives clips, converts them to 1080x1920, uploads to YouTube.
// Secrets come ONLY from environment variables (.env locally, Render "Environment" tab in production).
require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const ffmpeg = require("ffmpeg-static");
const { google } = require("googleapis");
const cron = require("node-cron");

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy; needed for the real client IP

const RAW = path.join(__dirname, "clips", "raw");
const READY = path.join(__dirname, "clips", "ready");
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(READY, { recursive: true });

// Only the /public folder is exposed. Never serve the project root (it contains .env and this file).
app.use(express.static(path.join(__dirname, "public")));

// ---------- 1. Receive a clip from the browser ----------
const lastHit = new Map();
setInterval(() => lastHit.clear(), 3600 * 1000);

const clean = (s) => String(s || "").replace(/[^\w \-]/g, "").slice(0, 40).trim();

// The game lives on a different address (your Static Site), so the browser needs CORS permission to post clips here.
// Allowed sites: SITE_URL plus anything in ALLOWED_ORIGINS (comma separated) plus localhost for testing.
const origin = (u) => { try { return new URL(u.trim()).origin; } catch (_) { return null; } };
const ALLOWED = [process.env.SITE_URL, ...(process.env.ALLOWED_ORIGINS || "").split(","), "http://localhost:3000"]
  .filter(Boolean).map(origin).filter(Boolean);
app.use("/api/clip", (req, res, next) => {
  const o = req.headers.origin;
  if (o && ALLOWED.includes(o)) {
    res.set({ "Access-Control-Allow-Origin": o, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" });
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.post("/api/clip", express.raw({ type: "video/*", limit: "25mb" }), (req, res) => {
  const now = Date.now();
  if (now - (lastHit.get(req.ip) || 0) < 60000) return res.sendStatus(429); // 1 clip / minute / IP
  if (!Buffer.isBuffer(req.body) || req.body.length < 20000) return res.sendStatus(400);
  if (fs.readdirSync(READY).length > 200) return res.sendStatus(503); // queue full
  lastHit.set(req.ip, now);

  const id = now + "-" + Math.random().toString(36).slice(2, 8);
  const inFile = path.join(RAW, id + (req.is("video/mp4") ? ".mp4" : ".webm"));
  const outFile = path.join(READY, id + ".mp4");
  fs.writeFileSync(inFile, req.body);

  // Upscale 360x640 -> 1080x1920 with nearest-neighbour so the pixel-art map stays crisp
  const args = [
    "-y", "-i", inFile, "-t", "10",
    "-vf", "scale=1080:1920:flags=neighbor,fps=30,format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-movflags", "+faststart", "-an", outFile,
  ];
  execFile(ffmpeg, args, { timeout: 120000 }, (err) => {
    fs.unlink(inFile, () => {});
    if (err) return console.error("ffmpeg failed:", err.message);
    fs.writeFileSync(
      path.join(READY, id + ".json"),
      JSON.stringify({ empire: clean(req.query.empire), level: clean(req.query.level) })
    );
    console.log("clip ready:", id);
  });
  res.sendStatus(202);
});

// ---------- 2. Upload one queued clip to YouTube ----------
function youtube() {
  const auth = new google.auth.OAuth2(process.env.YT_CLIENT_ID, process.env.YT_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });
  return google.youtube({ version: "v3", auth });
}

let busy = false;
async function uploadNext() {
  if (!process.env.YT_CLIENT_ID || !process.env.YT_CLIENT_SECRET || !process.env.YT_REFRESH_TOKEN) {
    return "YouTube env vars missing";
  }
  if (busy) return "busy";
  const metas = fs.readdirSync(READY).filter((f) => f.endsWith(".json")).sort();
  if (!metas.length) return "queue empty";

  busy = true;
  const base = metas[0].slice(0, -5);
  const mp4 = path.join(READY, base + ".mp4");
  const jsonFile = path.join(READY, base + ".json");
  try {
    const meta = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    const who = meta.empire || "an empire";
    const site = process.env.SITE_URL || "";
    const r = await youtube().videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: `Conquering the world as ${who} (${meta.level || "normal"}) #Shorts`.slice(0, 100),
          description: `Play Empire free: ${site}\n\n#Shorts #strategy #games`,
          categoryId: "20", // Gaming
        },
        status: {
          privacyStatus: process.env.YT_PRIVACY || "private", // set YT_PRIVACY=public once your project is audited
          selfDeclaredMadeForKids: false,
        },
      },
      media: { body: fs.createReadStream(mp4) },
    });
    fs.unlinkSync(mp4);
    fs.unlinkSync(jsonFile);
    return "uploaded https://youtube.com/shorts/" + r.data.id;
  } catch (e) {
    console.error("upload failed:", e.message);
    return "error: " + e.message; // clip stays in the queue for the next try
  } finally {
    busy = false;
  }
}

// Every 4 hours (only works if your server is awake; see CRON_KEY below for free hosts that sleep)
cron.schedule("0 */4 * * *", async () => console.log("cron:", await uploadNext()));

// Manual / external trigger, e.g. from cron-job.org:  POST /api/upload-next?key=YOUR_CRON_KEY
app.post("/api/upload-next", async (req, res) => {
  if (!process.env.CRON_KEY || req.query.key !== process.env.CRON_KEY) return res.sendStatus(403);
  res.send(await uploadNext());
});

app.listen(process.env.PORT || 3000, () => console.log("Empire server running"));