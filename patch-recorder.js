// Run from your project folder:  node patch-recorder.js
// Adds the gameplay clip recorder to public/index.html (backs up the original first).
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "public", "index.html");
const backup = path.join(__dirname, "public", "index.backup.html");

if (!fs.existsSync(file)) { console.log("FAILED: public/index.html not found"); process.exit(1); }
let t = fs.readFileSync(file, "utf8");
if (t.includes("recordClip")) { console.log("Already patched"); process.exit(0); }

const fn = `
  var CLIP_URL = "/api/clip";
  var clipSent = false;
  function recordClip(empireName, level) {
    if (clipSent || !window.MediaRecorder) return;
    clipSent = true;
    var out = document.createElement("canvas");
    out.width = 360; out.height = 640;
    var ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    var running = true;
    (function paint() {
      if (!running) return;
      ctx.fillStyle = "#090e13";
      ctx.fillRect(0, 0, 360, 640);
      ctx.drawImage(cv, 0, 50, 360, 540);
      ctx.fillStyle = "#fff"; ctx.font = "bold 20px system-ui"; ctx.textAlign = "center";
      ctx.fillText(empireName, 180, 32);
      requestAnimationFrame(paint);
    })();
    var mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find(function (m) { return MediaRecorder.isTypeSupported(m); });
    var rec = new MediaRecorder(out.captureStream(30), { mimeType: mime, videoBitsPerSecond: 1500000 });
    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      running = false;
      var blob = new Blob(chunks, { type: "video/webm" });
      fetch(CLIP_URL + "?empire=" + encodeURIComponent(empireName) + "&level=" + encodeURIComponent(level),
        { method: "POST", headers: { "Content-Type": "video/webm" }, body: blob }).catch(function () {});
    };
    rec.start();
    setTimeout(function () { if (rec.state === "recording") rec.stop(); }, 10000);
  }
`;

const hook = ` clipSent = false; setTimeout(function () { if (!over && P) recordClip(E.n, lvKey()); }, 20000);`;

const r1 = /function track\(n, p\)[^\r\n]*/;
const r2 = /track\("game_started"[^\r\n]*\);/;

if (!r1.test(t)) { console.log("FAILED: track() line not found"); process.exit(1); }
if (!r2.test(t)) { console.log("FAILED: game_started line not found"); process.exit(1); }

fs.copyFileSync(file, backup);
t = t.replace(r1, (m) => m + fn);
t = t.replace(r2, (m) => m + hook);
fs.writeFileSync(file, t, "utf8");
console.log("Patched OK. Backup saved as public/index.backup.html");
