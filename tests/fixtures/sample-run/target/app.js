const express = require("express");
const app = express();
app.get("/u", (req, res) => res.send(`SELECT * FROM users WHERE id=${req.query.id}`));
app.get("/safe", (req, res) => res.send("ok"));
app.get("/run", (req, res) => res.send(require("node:child_process").execSync(req.query.c)));
module.exports = app;
