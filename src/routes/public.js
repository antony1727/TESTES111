/**
 * routes/public.js — API pública (SEM login), usada pelo site do cliente.
 * ----------------------------------------------------------------------------
 * ROTAS (montadas em server.js sob o prefixo /api):
 *
 *  GET  /api/servicos          → catálogo p/ vitrine e Passo 1 (só ativos)
 *  GET  /api/profissionais     → barbeiros p/ o Passo 2 (só ativos)
 *  GET  /api/disponibilidade?data=AAAA-MM-DD&profissional_id=1&servico_id=2
 *                              → horários livres p/ o Passo 3
 *  POST /api/agendamentos      → cria a reserva (Passo 4 → 5)
 *
 * ANTICHOQUE NA CRIAÇÃO (dupla proteção, ver também schema.sql):
 *  a) Revalida o horário com horariosVagos() ANTES de inserir (409 se ocupado).
 *  b) UNIQUE(profissional_id, data, hora) no banco barra a condição de corrida
 *     (2 cliques simultâneos): o 2º INSERT falha e vira 409 amigável.
 */
const express = require('express');
const db = require('../db'); // consultas (async) às tabelas
const { horariosVagos } = require('../lib/disponibilidade'); // cérebro da grade
const emissor = require('../lib/eventos'); // avisa o painel em tempo real

const router = express.Router();

// Envolve um handler async e converte exceções em resposta 500 (sem derrubar o app).
const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * GET /api/servicos — lista serviços ativos ordenados do mais barato ao
 * mais caro (ordem que converte bem na vitrine). Usado 2×: cards da landing
 * e opções clicáveis do Passo 1.
 */
router.get('/servicos', rota(async (req, res) => {
  res.json(await db.all('SELECT * FROM servicos WHERE ativo = 1 ORDER BY preco_centavos'));
}));

/**
 * GET /api/profissionais — lista barbeiros ativos em ordem alfabética
 * para o Passo 2 ("com quem você quer ser atendido?").
 */
router.get('/profissionais', rota(async (req, res) => {
  res.json(await db.all('SELECT * FROM profissionais WHERE ativo = 1 ORDER BY nome'));
}));

/**
 * GET /api/disponibilidade — coração do Passo 3.
 * Query obrigatória: data + profissional_id + servico_id (a duração do
 * serviço muda o resultado: combo de 50min tem menos slots que corte de 30).
 * Resposta: { data, horarios: ['09:00', '09:30', ...] }.
 */
router.get('/disponibilidade', rota(async (req, res) => {
  const { data, profissional_id, servico_id } = req.query;
  // Valida presença dos 3 parâmetros antes de qualquer consulta.
  if (!data || !profissional_id || !servico_id) {
    return res.status(400).json({ erro: 'Informe data, profissional_id e servico_id.' });
  }
  // Precisamos da duração do serviço para calcular os slots.
  const serv = await db.get('SELECT * FROM servicos WHERE id = ?', [servico_id]);
  if (!serv) return res.status(404).json({ erro: 'Serviço não encontrado.' });
  res.json({ data, horarios: await horariosVagos(data, Number(profissional_id), serv.duracao_min) });
}));

/**
 * POST /api/agendamentos — cria a reserva (botão "Confirmar agendamento").
 * BODY: { servico_id, profissional_id, data:'AAAA-MM-DD', hora:'HH:MM',
 *         cliente_nome, cliente_telefone, cliente_email? }
 * SUCESSO (201): o agendamento completo com nomes de serviço/profissional
 *   (JOIN) — o frontend usa isso para montar resumo + WhatsApp + .ics.
 * ERROS: 400 (dados inválidos) | 404 (serviço/profissional inexistente ou
 *   inativo) | 409 (horário ocupado — devolve a grade atualizada p/ o cliente
 *   escolher outro sem precisar recarregar a página).
 */
router.post('/agendamentos', rota(async (req, res) => {
  const { servico_id, profissional_id, data, hora, cliente_nome, cliente_telefone, cliente_email } = req.body || {};

  // 1) Campos obrigatórios: sem eles nem consultamos o banco.
  if (!servico_id || !profissional_id || !data || !hora || !cliente_nome || !cliente_telefone) {
    return res.status(400).json({ erro: 'Preencha serviço, profissional, data, hora, nome e telefone.' });
  }
  // 2) Formato rígido evita sujeira no banco e protege as comparações de grade.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) {
    return res.status(400).json({ erro: 'Data ou hora em formato inválido.' });
  }
  // 3) Serviço/profissional precisam existir E estar ativos (não some com
  //    item pausado só mudando o id no DevTools).
  const serv = await db.get('SELECT * FROM servicos WHERE id = ? AND ativo = 1', [servico_id]);
  const prof = await db.get('SELECT * FROM profissionais WHERE id = ? AND ativo = 1', [profissional_id]);
  if (!serv || !prof) return res.status(404).json({ erro: 'Serviço ou profissional inválido.' });

  // 4) Revalidação antichoque: o slot ainda está livre AGORA? Se outro cliente
  //    reservou segundos atrás, recusamos com 409 + grade fresca.
  const livres = await horariosVagos(data, Number(profissional_id), serv.duracao_min);
  if (!livres.includes(hora)) {
    return res.status(409).json({ erro: 'Horário indisponível. Escolha outro.', horarios: livres });
  }

  // 5) Tudo certo: insere. O try/catch cobre a 2ª camada antichoque (UNIQUE):
  //    se 2 INSERTs idênticos colidirem, o perdedor cai aqui com 409 amigável.
  let criado;
  try {
    criado = await db.get(`
      INSERT INTO agendamentos (servico_id, profissional_id, data, hora, cliente_nome, cliente_telefone, cliente_email)
      VALUES (?,?,?,?,?,?,?)
      RETURNING id
    `, [servico_id, profissional_id, data, hora, cliente_nome.trim(), cliente_telefone.trim(), (cliente_email || '').trim()]);
  } catch (e) {
    // 23505 = unique_violation (Postgres): alguém pegou o horário no meio do caminho.
    if (e.code === '23505') {
      return res.status(409).json({ erro: 'Horário acabou de ser ocupado. Tente outro.' });
    }
    throw e; // erro inesperado → 500 (o handler genérico loga)
  }

  // 6) Releitura com JOIN para devolver nomes/preço/duração (frontend exibe).
  const ag = await db.get(`
    SELECT a.*, s.nome AS servico_nome, s.preco_centavos, s.duracao_min, p.nome AS profissional_nome
    FROM agendamentos a JOIN servicos s ON s.id=a.servico_id JOIN profissionais p ON p.id=a.profissional_id
    WHERE a.id = ?
  `, [criado.id]);

  // 7) Avisa o painel do barbeiro EM TEMPO REAL (SSE em routes/admin.js).
  //    O painel recebe e mostra cliente, serviço, dia e hora sem recarregar.
  emissor.emit('novo', ag);

  res.status(201).json(ag);
}));

module.exports = router;
