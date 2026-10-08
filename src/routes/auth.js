/**
 * routes/auth.js — Login do painel admin.
 * ----------------------------------------------------------------------------
 * ROTA: POST /api/auth/login
 * BODY (JSON): { "email": "...", "senha": "..." }
 * SUCESSO (200): { token, usuario: { nome, email, papel } }
 * FALHA: 400 (faltou campo) | 401 (credenciais inválidas)
 *
 * SEGURANÇA:
 *  • A senha NUNCA trafega de volta nem é salva pura: comparamos com
 *    bcrypt.compareSync() contra o hash criado no seed.
 *  • A resposta de erro é GENÉRICA de propósito ("Credenciais inválidas"):
 *    não revelamos se o e-mail existe ou não (dificulta enumeração de contas).
 *  • O token carrega só dados não-sensíveis e expira (JWT_EXPIRES_IN, padrão 12h).
 */
const express = require('express');
const bcrypt = require('bcryptjs'); // compara senha digitada × hash salvo
const jwt = require('jsonwebtoken'); // assina o "crachá" de acesso
const db = require('../db'); // consulta o usuário na tabela `usuarios`
const { SECRET } = require('../middleware/auth'); // mesmo segredo da validação

const router = express.Router();

router.post('/login', (req, res) => {
  // 1) Validação básica: os dois campos são obrigatórios.
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });

  // 2) Busca o usuário pelo e-mail. Se não existir, cai no mesmo erro genérico.
  const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(senha, user.senha_hash)) {
    return res.status(401).json({ erro: 'Credenciais inválidas.' });
  }

  // 3) Login OK: assina o token com os dados do usuário (sem a senha!).
  const token = jwt.sign(
    { id: user.id, nome: user.nome, email: user.email, papel: user.papel },
    SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );

  // 4) Devolve token + perfil. O frontend guarda o token no localStorage.
  res.json({ token, usuario: { nome: user.nome, email: user.email, papel: user.papel } });
});

module.exports = router;
