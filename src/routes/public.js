// Rotas públicas (sem login): serviços, profissionais e agendamento.
const express = require('express');
const db = require('../db');
const { horariosVagos } = require('../lib/disponibilidade');

const router = express.Router();

router.get('/servicos', (req, res) => {
  res.json(db.prepare("SELECT * FROM servicos WHERE ativo = 1 ORDER BY preco_centavos").all());
});

router.get('/profissionais', (req, res) => {
  res.json(db.prepare('SELECT * FROM profissionais WHERE ativo = 1 ORDER BY nome').all());
});

// GET /api/disponibilidade?data=YYYY-MM-DD&profissional_id=1&servico_id=2
router.get('/disponibilidade', (req, res) => {
  const { data, profissional_id, servico_id } = req.query;
  if (!data || !profissional_id || !servico_id) {
    return res.status(400).json({ erro: 'Informe data, profissional_id e servico_id.' });
  }
  const serv = db.prepare('SELECT * FROM servicos WHERE id = ?').get(servico_id);
  if (!serv) return res.status(404).json({ erro: 'Serviço não encontrado.' });
  res.json({ data, horarios: horariosVagos(data, Number(profissional_id), serv.duracao_min) });
});

// POST /api/agendamentos { servico_id, profissional_id, data, hora, cliente_nome, cliente_telefone, cliente_email }
router.post('/agendamentos', (req, res) => {
  const { servico_id, profissional_id, data, hora, cliente_nome, cliente_telefone, cliente_email } = req.body || {};
  if (!servico_id || !profissional_id || !data || !hora || !cliente_nome || !cliente_telefone) {
    return res.status(400).json({ erro: 'Preencha serviço, profissional, data, hora, nome e telefone.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) {
    return res.status(400).json({ erro: 'Data ou hora em formato inválido.' });
  }
  const serv = db.prepare('SELECT * FROM servicos WHERE id = ? AND ativo = 1').get(servico_id);
  const prof = db.prepare('SELECT * FROM profissionais WHERE id = ? AND ativo = 1').get(profissional_id);
  if (!serv || !prof) return res.status(404).json({ erro: 'Serviço ou profissional inválido.' });

  const livres = horariosVagos(data, Number(profissional_id), serv.duracao_min);
  if (!livres.includes(hora)) {
    return res.status(409).json({ erro: 'Horário indisponível. Escolha outro.', horarios: livres });
  }
  try {
    const r = db.prepare(`
      INSERT INTO agendamentos (servico_id, profissional_id, data, hora, cliente_nome, cliente_telefone, cliente_email)
      VALUES (?,?,?,?,?,?,?)
    `).run(servico_id, profissional_id, data, hora, cliente_nome.trim(), cliente_telefone.trim(), (cliente_email || '').trim());
    const ag = db.prepare(`
      SELECT a.*, s.nome AS servico_nome, s.preco_centavos, s.duracao_min, p.nome AS profissional_nome
      FROM agendamentos a JOIN servicos s ON s.id=a.servico_id JOIN profissionais p ON p.id=a.profissional_id
      WHERE a.id = ?
    `).get(r.lastInsertRowid);
    res.status(201).json(ag);
  } catch (e) {
    return res.status(409).json({ erro: 'Horário acabou de ser ocupado. Tente outro.' });
  }
});

module.exports = router;
