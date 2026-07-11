// Minimal Express + EJS starter. The engineering agent customizes the views/routes.
// Ships with the analytics beacon + a Postgres-ready shape (DATABASE_URL).
const express = require("express");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// Analytics beacon — INFRASTRUCTURE, injected into every HTML response (not app code, so the
// agent can rewrite all views and tracking still works). Reads POLSIA_ANALYTICS_SLUG +
// POLSIA_BEACON_URL from env; fires a 1x1 pixel with a localStorage visitor id.
app.use((req, res, next) => {
  const slug = process.env.POLSIA_ANALYTICS_SLUG;
  const beacon = process.env.POLSIA_BEACON_URL;
  if (slug && beacon) {
    const send = res.send.bind(res);
    res.send = (body) => {
      if (typeof body === "string" && body.includes("</body>")) {
        const tag =
          "<script>(function(){try{var v=localStorage.getItem('_pv');" +
          "if(!v){v=(self.crypto&&crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());localStorage.setItem('_pv',v);}" +
          "new Image().src=" + JSON.stringify(beacon) + "+\"/api/beacon/pixel?s=\"+encodeURIComponent(" + JSON.stringify(slug) +
          ")+\"&v=\"+v+\"&p=\"+encodeURIComponent(location.pathname);}catch(e){}})();</script>";
        body = body.replace("</body>", tag + "</body>");
      }
      return send(body);
    };
  }
  next();
});

app.get("/health", (_req, res) => res.json({ status: "healthy" }));
app.get("/", (_req, res) => res.render("layout"));

app.listen(port, () => console.log(`Server running on port ${port}`));
