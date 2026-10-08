// Rotas privadas do painel — todas exigem JWT (authObrigatorio).
const express = require('express');
const db = require('../db');
const { authObrigatorio } = require('../middleware/auth');

const router = express.Router();
router.use(authObrigatorio);

// Resumo do dia: total, faturamento estimado (não-cancelados) e próximos.
router.get('/resumo', (req, res) => {
  const data = req.query.data || new Date().toISOString().slice(0, 10);
  const lista = db.prepare(`
    SELECT a.*, s.nome AS servico_nome, s.preco_centavos, p.nome AS profissional_nome
    FROM agendamentos a
    JOIN servicos s ON s.id = a.servico_id
    JOIN profissionais p ON p.id = a.profissional_id
    WHERE a.data = ? ORDER BY a.hora
  `).all(data);
  const validos = lista.filter((a) => a.status !== 'cancelado');
  const faturamento = validos.reduce((t, a) => t + (a.preco_centavos || 0), 0);
  const agora = new Date().toTimeString().slice(0, 5);
  const proximos = lista.filter((a) => a.status === 'confirmado' && (data > new Date().toISOString().slice(0, 10) || a.hora >= agora)).slice(0, 5);
  res.json({ data, total: lista.length, faturamento_centavos: faturamento, proximos, por_status: {
    confirmado: lista.filter((a) => a.status === 'confirmado').length,
    concluido: lista.filter((a) => a.status === 'concluido').length,
    cancelado: lista.filter((a) => a.status === 'cancelado').length,
  }});
});

// Lista agenda com filtros ?data=&status=&profissional_id=
router.get('/agendamentos', (req, res) => {
  const { data, status, profissional_id } = req.query;
  let sql = `
    SELECT a.*, s.nome AS servico_nome, s.preco_centavos, s.duracao_min, p.nome AS profissional_nome
    FROM agendamentos a
    JOIN servicos s ON s.id = a.servico_id
    JOIN profissionais p ON p.id = a.profissional_id WHERE 1=1`;
  const params = [];
  if (data) { sql += ' AND a.data = ?'; params.push(data); }
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  if (profissional_id) { sql += ' AND a.profissional_id = ?'; params.push(profissional_id); }
  sql += ' ORDER BY a.data DESC, a.hora ASC LIMIT 300';
  res.json(db.prepare(sql).all(...params));
});

// Troca de status: confirmado | concluido | cancelado
router.patch('/agendamentos/:id', (req, res) => {
  const { status } = req.body || {};
  if (!['confirmado', 'concluido', 'cancelado'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido.' });
  }
  const r = db.prepare('UPDATE agendamentos SET status = ? WHERE id = ?').run(status, req.params.id);
  if (!r.changes) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  res.json({ ok: true });
});

router.delete('/agendamentos/:id', (req, res) => {
  const r = db.prepare('DELETE FROM agendamentos WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  res.json({ ok: true });
});

// ---- Configurações: expediente ----
router.get('/funcionamento', (req, res) => {
  res.json(db.prepare('SELECT * FROM horarios_funcionamento ORDER BY dia_semana').all());
});

router.put('/funcionamento', (req, res) => {
  const dias = req.body?.dias;
  if (!Array.isArray(dias)) return res.status(400).json({ erro: 'Envie { dias: [...] }.' });
  const up = db.prepare(`
    INSERT INTO horarios_funcionamento (dia_semana, aberto, abertura, fechamento, almoco_inicio, almoco_fim)
    VALUES (@dia_semana, @aberto, @abertura, @fechamento, @almoco_inicio, @almoco_fim)
    ON CONFLICT(dia_semana) DO UPDATE SET aberto=excluded.aberto, abertura=excluded.abertura,
      fechamento=excluded.fechamento, almoco_inicio=excluded.almoco_inicio, almoco_fim=excluded.almoco_fim
  `);
  const tx = db.transaction((lista) => { for (const d of lista) up.run(d); });
  tx(dias);
  res.json({ ok: true });
});

// ---- Bloqueios (folgas / feriados / faixas) ----
router.get('/bloqueios', (req, res) => {
  res.json(db.prepare('SELECT * FROM bloqueios ORDER BY data DESC LIMIT 200').all());
});

router.post('/bloqueios', (req, res) => {
  const { data, hora_inicio, hora_fim, motivo } = req.body || {};
  if (!data) return res.status(400).json({ erro: 'Informe a data.' });
  const r = db.prepare('INSERT INTO bloqueios (data, hora_inicio, hora_fim, motivo) VALUES (?,?,?,?)')
    .run(data, hora_inicio || null, hora_fim || null, motivo || '');
  res.status(201).json({ id: r.lastInsertRowid });
});

router.delete('/bloqueios/:id', (req, res) => {
  db.prepare('DELETE FROM bloqueios WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
