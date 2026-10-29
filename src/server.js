/**
 * server.js — Ponto de entrada: sobe o backend + serve o frontend. 🚀
 * ----------------------------------------------------------------------------
 * ARQUITETURA (monolito simples, ideal para começar e hospedar barato):
 *
 *   Navegador (public/)  ──fetch──►  Express (este arquivo)
 *        │                                ├── /api/*      → rotas JSON
 *        │                                └── /*          → arquivos estáticos
 *        ▼
 *   SQLite (barbercode.db + better-sqlite3)
 *
 * ORDEM DE BOOT (importa a ordem!):
 *  1. dotenv      → carrega .env (PORT, JWT_SECRET, ADMIN_*, BARBER_WHATSAPP)
 *  2. ./db        → cria/abre o banco e aplica o schema
 *  3. ./seed()    → garante dados iniciais (idempotente, ver seed.js)
 *  4. rotas       → registra /api/auth, /api (públicas) e /api/admin (JWT)
 *  5. estáticos   → serve public/ (o site) + atalho /admin (o painel)
 *  6. listen      → começa a ouvir na porta
 *
 * EXECUÇÃO: `npm start` (ou `npm run dev` com auto-reload via --watch).
 */
require('dotenv').config(); // 1) lê o arquivo .env para process.env.*
const path = require('path'); // monta caminhos de arquivo multi-plataforma
const express = require('express'); // framework HTTP (rotas + middlewares)
const cors = require('cors'); // libera chamadas de outras origens (ex.: front separado)

const db = require('./db'); // 2) acesso ao Postgres (init() aplica o schema)
const seed = require('./seed'); // 3a) importa a função de carga inicial

// 4) Importa os 3 grupos de rotas (cada um é um express.Router).
const authRoutes = require('./routes/auth'); // POST /api/auth/login
const publicRoutes = require('./routes/public'); // GET serviços/profs/disponibilidade + POST agendar
const adminRoutes = require('./routes/admin'); // tudo do painel (protegido por JWT)

const app = express();
app.use(cors()); // permite o frontend chamar a API mesmo hospedado em outro domínio
app.use(express.json()); // entende BODY em JSON (req.body) nas rotas POST/PUT/PATCH

// ---- APIs (JSON) ------------------------------------------------------------
// Cada use() monta um grupo de rotas sob um prefixo:
app.use('/api/auth', authRoutes); // → /api/auth/login
app.use('/api', publicRoutes); // → /api/servicos, /api/disponibilidade, /api/agendamentos
app.use('/api/admin', adminRoutes); // → /api/admin/* (todas exigem Authorization: Bearer)

// Configuração pública e SEGURA de expor: só o número do WhatsApp, que o
// frontend usa para montar o link "Abrir no WhatsApp" (wa.me). NADA secreto
// (senhas, JWT_SECRET) sai por aqui.
app.get('/api/config', (req, res) => {
  res.json({ whatsapp: process.env.BARBER_WHATSAPP || '' });
});

// Sonda de saúde (health check): usada pelo Render/monitoramentos p/ saber
// se o app está vivo. Leve de propósito: não toca no banco.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'barbercode', hora: new Date().toISOString() });
});

// ---- Frontend (arquivos estáticos) ------------------------------------------
// Serve tudo de public/ direto: / → index.html, /css/*.css, /js/*.js…
app.use(express.static(path.join(__dirname, '..', 'public')));
// Atalho amigável: /admin entrega o painel (mesmo arquivo que /admin.html).
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

// ---- Tratador de erros (nunca deixa o app cair por causa de 1 requisição) ---
app.use((err, req, res, next) => {
  console.error('[erro]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
});

// ---- Sobe o servidor (depois de preparar o banco) ----------------------------
const PORT = process.env.PORT || 3000;
(async () => {
  await db.init(); // cria/atualiza tabelas (idempotente, não apaga dados)
  await seed(); // garante dados iniciais (idempotente, ver seed.js)
  app.listen(PORT, () => console.log(`💈 Barber Code no ar: http://localhost:${PORT} | painel: http://localhost:${PORT}/admin`));
})().catch((erro) => {
  console.error('[boot] falha ao iniciar:', erro);
  process.exit(1);
});
