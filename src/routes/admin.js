/**
 * routes/admin.js — API privada do painel do barbeiro (EXIGE login JWT).
 * ----------------------------------------------------------------------------
 * PROTEÇÃO: `router.use(authObrigatorio)` no topo aplica o porteiro JWT a
 * TODAS as rotas deste arquivo. Sem token válido → 401 automático.
 *
 * ROTAS:
 *  GET    /api/admin/resumo?data=AAAA-MM-DD        → KPIs do dia (cards do topo)
 *  GET    /api/admin/agendamentos?data=&status=&profissional_id=
 *                                                  → agenda filtrada (tabela)
 *  PATCH  /api/admin/agendamentos/:id  {status}    → conclui/cancela/reabre
 *  DELETE /api/admin/agendamentos/:id              → exclui definitivo
 *  GET    /api/admin/funcionamento                 → lê expediente semanal
 *  PUT    /api/admin/funcionamento    {dias:[...]} → salva expediente semanal
 *  GET    /api/admin/bloqueios                     → lista folgas/feriados
 *  POST   /api/admin/bloqueios        {data,...}   → cria bloqueio
 *  DELETE /api/admin/bloqueios/:id                 → libera bloqueio
 */
const express = require('express');
const jwt = require('jsonwebtoken'); // valida o token recebido por query (?token=) no SSE
const db = require('../db');
const { authObrigatorio, SECRET } = require('../middleware/auth'); // porteiro JWT
const emissor = require('../lib/eventos'); // barramento de eventos (tempo real)

const router = express.Router();

// ============================================================================
// TEMPO REAL (SSE) — precisa vir ANTES do router.use(authObrigatorio), porque
// o EventSource do navegador NÃO consegue enviar headers: o token chega pela
// query string (?token=...). A validação é feita aqui manualmente.
//
// GET /api/admin/eventos?token=<JWT>
//   → mantém a conexão aberta e envia um evento "novo" a cada agendamento.
// ============================================================================
router.get('/eventos', (req, res) => {
  // 1) Autenticação manual (mesmo segredo do middleware).
  let usuario;
  try {
    usuario = jwt.verify(String(req.query.token || ''), SECRET);
  } catch {
    return res.status(401).end('Token inválido');
  }

  // 2) Cabeçalhos de Server-Sent Events: conexão fica aberta e sem buffer.
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // evita buffer em proxies (Render, Nginx, túneis)
  });
  res.flushHeaders?.();
  res.write(`event: pronto\ndata: ${JSON.stringify({ ok: true, usuario: usuario.email })}\n\n`);

  // 3) Cada agendamento novo é enviado como um evento "novo".
  const aoCriar = (ag) => {
    res.write(`event: novo\ndata: ${JSON.stringify(ag)}\n\n`);
  };
  emissor.on('novo', aoCriar);

  // 4) Comentário periódico (ping) mantém a conexão viva entre proxies.
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  // 5) Limpeza quando o barbeiro fecha a aba/navegador.
  req.on('close', () => {
    clearInterval(ping);
    emissor.off('novo', aoCriar);
  });
});

router.use(authObrigatorio); // ← a partir daqui, tudo exige login

/**
 * GET /api/admin/ultimos?desde=<id> — usado pelo "verificador automático" do
 * painel (polling). Devolve os agendamentos com id MAIOR que `desde`, de
 * QUALQUER data (inclusive futuras), para o barbeiro ver na hora o que o
 * cliente acabou de marcar — mesmo sem SSE (redes/proxies que bufferizam).
 */
router.get('/ultimos', (req, res) => {
  const desde = Number(req.query.desde || 0) || 0;
  const lista = db.prepare(`
    SELECT a.*, s.nome AS servico_nome, s.preco_centavos, s.duracao_min, p.nome AS profissional_nome
    FROM agendamentos a
    JOIN servicos s ON s.id = a.servico_id
    JOIN profissionais p ON p.id = a.profissional_id
    WHERE a.id > ? ORDER BY a.id ASC LIMIT 50
  `).all(desde);
  res.json(lista);
});

/**
 * GET /api/admin/resumo — alimenta os 3 cards "Visão geral".
 * Retorna: total de clientes do dia, faturamento ESTIMADO em centavos
 * (soma dos NÃO-cancelados: confirmado conta como receita prevista) e os
 * próximos 5 confirmados futuros + contagem por status.
 */
router.get('/resumo', (req, res) => {
  // ?data= opcional; sem ele, usa hoje (ISO YYYY-MM-DD).
  const data = req.query.data || new Date().toISOString().slice(0, 10);

  // Busca tudo do dia com JOIN (nomes e preços), ordenado por hora (agenda).
  const lista = db.prepare(`
    SELECT a.*, s.nome AS servico_nome, s.preco_centavos, p.nome AS profissional_nome
    FROM agendamentos a
    JOIN servicos s ON s.id = a.servico_id
    JOIN profissionais p ON p.id = a.profissional_id
    WHERE a.data = ? ORDER BY a.hora
  `).all(data);

  // Faturamento estimado: soma preços de tudo que NÃO foi cancelado.
  const validos = lista.filter((a) => a.status !== 'cancelado');
  const faturamento = validos.reduce((t, a) => t + (a.preco_centavos || 0), 0);

  // "Próximos": confirmados cuja hora ainda não passou (ou dias futuros).
  const agora = new Date().toTimeString().slice(0, 5); // 'HH:MM' atual
  const proximos = lista.filter((a) => a.status === 'confirmado' && (data > new Date().toISOString().slice(0, 10) || a.hora >= agora)).slice(0, 5);

  res.json({ data, total: lista.length, faturamento_centavos: faturamento, proximos, por_status: {
    confirmado: lista.filter((a) => a.status === 'confirmado').length,
    concluido: lista.filter((a) => a.status === 'concluido').length,
    cancelado: lista.filter((a) => a.status === 'cancelado').length,
  }});
});

/**
 * GET /api/admin/agendamentos — tabela da agenda com filtros opcionais.
 * Filtros combináveis: ?data=AAAA-MM-DD, ?status=confirmado|concluido|cancelado,
 * ?profissional_id=N. Truque `WHERE 1=1`: permite empilhar ANDs sem se
 * preocupar com qual filtro veio primeiro. LIMIT 300 = trava de segurança
 * para a tabela nunca travar o navegador.
 */
router.get('/agendamentos', (req, res) => {
  const { data, status, profissional_id } = req.query;
  let sql = `
    SELECT a.*, s.nome AS servico_nome, s.preco_centavos, s.duracao_min, p.nome AS profissional_nome
    FROM agendamentos a
    JOIN servicos s ON s.id = a.servico_id
    JOIN profissionais p ON p.id = a.profissional_id WHERE 1=1`;
  const params = []; // parâmetros na MESMA ordem dos ANDs (evita SQL injection)
  if (data) { sql += ' AND a.data = ?'; params.push(data); }
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  if (profissional_id) { sql += ' AND a.profissional_id = ?'; params.push(profissional_id); }
  sql += ' ORDER BY a.data DESC, a.hora ASC LIMIT 300';
  res.json(db.prepare(sql).all(...params));
});

/**
 * PATCH /api/admin/agendamentos/:id — troca o status (botões ✓ / ✕ da tabela).
 * BODY: { status: 'confirmado' | 'concluido' | 'cancelado' }.
 * A whitelist abaixo impede valores inventados. 404 se o id não existir.
 */
router.patch('/agendamentos/:id', (req, res) => {
  const { status } = req.body || {};
  if (!['confirmado', 'concluido', 'cancelado'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido.' });
  }
  const r = db.prepare('UPDATE agendamentos SET status = ? WHERE id = ?').run(status, req.params.id);
  if (!r.changes) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  res.json({ ok: true });
});

/**
 * DELETE /api/admin/agendamentos/:id — exclusão DEFINITIVA (frontend pede
 * confirmação antes). Para "cancelar sem apagar o histórico", prefira o
 * PATCH com status=cancelado. 404 se o id não existir.
 */
router.delete('/agendamentos/:id', (req, res) => {
  const r = db.prepare('DELETE FROM agendamentos WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  res.json({ ok: true });
});

// ---- EXPEDIENTE SEMANAL (tabela horarios_funcionamento) --------------------

/** GET /api/admin/funcionamento — devolve as 7 linhas (dom=0 … sáb=6). */
router.get('/funcionamento', (req, res) => {
  res.json(db.prepare('SELECT * FROM horarios_funcionamento ORDER BY dia_semana').all());
});

/**
 * PUT /api/admin/funcionamento — salva o expediente da semana inteira.
 * BODY: { dias: [{ dia_semana, aberto, abertura, fechamento,
 *                   almoco_inicio, almoco_fim }, ...] }
 * Usa UPSERT (INSERT … ON CONFLICT DO UPDATE) dentro de UMA transação:
 * ou salva os 7 dias, ou não salva nenhum (nunca fica "meio salvo").
 */
router.put('/funcionamento', (req, res) => {
  const dias = req.body?.dias;
  if (!Array.isArray(dias)) return res.status(400).json({ erro: 'Envie { dias: [...] }.' });
  const up = db.prepare(`
    INSERT INTO horarios_funcionamento (dia_semana, aberto, abertura, fechamento, almoco_inicio, almoco_fim)
    VALUES (@dia_semana, @aberto, @abertura, @fechamento, @almoco_inicio, @almoco_fim)
    ON CONFLICT(dia_semana) DO UPDATE SET aberto=excluded.aberto, abertura=excluded.abertura,
      fechamento=excluded.fechamento, almoco_inicio=excluded.almoco_inicio, almoco_fim=excluded.almoco_fim
  `);
  // transaction() = tudo-ou-nada: se um dia falhar, desfaz os anteriores.
  const tx = db.transaction((lista) => { for (const d of lista) up.run(d); });
  tx(dias);
  res.json({ ok: true });
});

// ---- BLOQUEIOS: folgas, feriados e pausas pontuais --------------------------

/** GET /api/admin/bloqueios — últimos 200, do mais recente ao mais antigo. */
router.get('/bloqueios', (req, res) => {
  res.json(db.prepare('SELECT * FROM bloqueios ORDER BY data DESC LIMIT 200').all());
});

/**
 * POST /api/admin/bloqueios — cria um bloqueio.
 * BODY: { data:'AAAA-MM-DD', hora_inicio?:'HH:MM', hora_fim?:'HH:MM', motivo? }
 * Sem horas = DIA TODO bloqueado. Com horas = só a FAIXA. Resposta 201 + id.
 */
router.post('/bloqueios', (req, res) => {
  const { data, hora_inicio, hora_fim, motivo } = req.body || {};
  if (!data) return res.status(400).json({ erro: 'Informe a data.' });
  const r = db.prepare('INSERT INTO bloqueios (data, hora_inicio, hora_fim, motivo) VALUES (?,?,?,?)')
    .run(data, hora_inicio || null, hora_fim || null, motivo || '');
  res.status(201).json({ id: r.lastInsertRowid });
});

/** DELETE /api/admin/bloqueios/:id — "liberar": apaga o bloqueio. */
router.delete('/bloqueios/:id', (req, res) => {
  db.prepare('DELETE FROM bloqueios WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
