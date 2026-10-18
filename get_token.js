// Run ONCE on your own computer:  node get-token.js
// It prints your YT_REFRESH_TOKEN. Needs YT_CLIENT_ID and YT_CLIENT_SECRET in .env first.
require("dotenv").config();
const http = require("http");
const { google } = require("googleapis");

const PORT = 5555;
const redirect = `http://localhost:${PORT}/oauth2callback`;
const auth = new google.auth.OAuth2(process.env.YT_CLIENT_ID, process.env.YT_CLIENT_SECRET, redirect);

const url = auth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // forces Google to hand out a refresh token
  scope: ["https://www.googleapis.com/auth/youtube.upload"],
});
console.log("\nOpen this link in your browser and approve access:\n\n" + url + "\n");

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, redirect);
    if (u.pathname !== "/oauth2callback") return res.end();
    try {
      const { tokens } = await auth.getToken(u.searchParams.get("code"));
      res.end("Done! Go back to your terminal. You can close this tab.");
      console.log("\nPut this line in your .env (and in Render's Environment tab):\n");
      console.log("YT_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
    } catch (e) {
      res.end("Error: " + e.message);
      console.error(e.message);
    }
    setTimeout(() => process.exit(0), 500);
  })
  .listen(PORT);