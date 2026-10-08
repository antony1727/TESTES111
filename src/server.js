// Servidor Express: APIs + arquivos estáticos do frontend.
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

require('./db');       // garante criação do banco/schema
require('./seed');     // garante seed — com require.main check ele só loga via função? chamamos direto:
try { require('./seed')(); } catch {} // idempotente

const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(cors());
app.use(express.json());

// APIs
app.use('/api/auth', authRoutes);
app.use('/api', publicRoutes);          // /api/servicos, /api/disponibilidade, /api/agendamentos
app.use('/api/admin', adminRoutes);     // protegidas por JWT

// Config pública (ex: whatsapp da barbearia p/ o frontend montar o link)
app.get('/api/config', (req, res) => {
  res.json({ whatsapp: process.env.BARBER_WHATSAPP || '' });
});

// Frontend estático
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`💈 Barbearia no ar: http://localhost:${PORT} | painel: http://localhost:${PORT}/admin`));
