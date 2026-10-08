// Login do painel admin — POST /api/auth/login { email, senha }.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });

  const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(senha, user.senha_hash)) {
    return res.status(401).json({ erro: 'Credenciais inválidas.' });
  }
  const token = jwt.sign(
    { id: user.id, nome: user.nome, email: user.email, papel: user.papel },
    SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
  res.json({ token, usuario: { nome: user.nome, email: user.email, papel: user.papel } });
});

module.exports = router;
