const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db/db");
const { signToken } = require("../services/auth");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  await db.read();
  const user = db.data.users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
});

module.exports = router;
