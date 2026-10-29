/**
 * booking.js — LÓGICA DA ÁREA DO CLIENTE (landing + wizard de 5 passos).
 * ----------------------------------------------------------------------------
 * FLUXO DO WIZARD (controlado por `state` + `irPara(n)`):
 *  Passo 1 → cliente clica num serviço .............. (GET /api/servicos)
 *  Passo 2 → cliente clica num profissional ......... (GET /api/profissionais)
 *  Passo 3 → cliente escolhe dia + horário .......... (GET /api/disponibilidade)
 *  Passo 4 → cliente informa nome + WhatsApp ........ (formulário local)
 *  Passo 5 → confirmação + WhatsApp + .ics .......... (POST /api/agendamentos)
 *
 * ESTADO (`state`): guarda as escolhas entre passos, pois cada etapa vive
 * numa <div data-etapa> diferente mas o POST final precisa de tudo junto.
 */

// Atalho p/ document.querySelector (usado o tempo todo abaixo).
const $ = (s) => document.querySelector(s);

/** Guarda as escolhas do cliente ao longo do wizard + o agendamento criado. */
const state = { servico: null, profissional: null, data: null, hora: null, whatsapp: '', ultimoAg: null };

/** Converte centavos → "R$ 45,00" (banco guarda inteiro; humano lê moeda). */
const BRL = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Exibe (ou limpa) a caixa de erro do wizard (#msgErro).
 * @param {string|null} msg texto do erro, ou null para esconder a caixa
 */
function erro(msg) {
  const el = $('#msgErro');
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false; el.textContent = msg;
}

/**
 * Navega para a etapa N (1–5): esconde as demais <div data-etapa>, acende os
 * N tracinhos da #barraPassos, limpa erros e rola a tela até o wizard.
 */
function irPara(etapa) {
  document.querySelectorAll('[data-etapa]').forEach((d) => { d.hidden = d.dataset.etapa != String(etapa); });
  document.querySelectorAll('#barraPassos .passo').forEach((p, i) => p.classList.toggle('on', i < etapa));
  erro(null);
  document.querySelector('#agendar .card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * fetch() com tratamento padrão da API: envia JSON e, se o status for erro,
 * lança Error com a mensagem { erro } que o backend devolveu (ex.: "Horário
 * indisponível"). Assim cada chamada pode usar try/catch simples.
 */
async function api(path, opts) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({})); // corpo vazio → objeto neutro
  if (!r.ok) throw new Error(data.erro || 'Falha na requisição.');
  return data;
}

/** Pinta de dourado (.sel) o card clicado dentro de um container de opções. */
function marcarSelecionado(container, id) {
  container.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.id == String(id)));
}

/**
 * init() — ponto de partida (roda 1× ao carregar a página):
 *  1. busca o WhatsApp da Barber Code (GET /api/config),
 *  2. busca serviços e monta a VITRINE + as opções do Passo 1,
 *  3. liga os botões "Agendar este" (atalho: já pula p/ o Passo 2),
 *  4. configura a navegação de semanas, botões Voltar, Confirmar, .ics e Novo.
 */
async function init() {
  // 1) WhatsApp da Barber Code (vem do .env via /api/config). Se falhar, o
  //    link final usa wa.me genérico — a página continua funcionando.
  try { state.whatsapp = (await api('/api/config')).whatsapp || ''; } catch {}

  // 2) Serviços: usados em DOIS lugares — cards de venda (#listaServicos) e
  //    opções selecionáveis do Passo 1 (#etapaServicos).
  const servicos = await api('/api/servicos');
  // 2a) Vitrine: cada card tem botão "Agendar este" (atalho p/ o Passo 2).
  $('#listaServicos').innerHTML = servicos.map((s) => `
    <div class="card"><h3>${s.nome}</h3>
      <div class="meta">${s.descricao || ''} • ~${s.duracao_min}min</div>
      <div class="preco">${BRL(s.preco_centavos)}</div>
      <button class="btn gold" data-agendar="${s.id}">Agendar este</button>
    </div>`).join('') || '<div class="card">Nenhum serviço ativo.</div>';

  // 2b) Passo 1: cards clicáveis (delegação de clique logo abaixo).
  $('#etapaServicos').innerHTML = servicos.map((s) => `
    <div class="card" data-id="${s.id}" style="cursor:pointer">
      <h3>${s.nome}</h3><div class="meta">~${s.duracao_min}min</div>
      <div class="preco">${BRL(s.preco_centavos)}</div>
    </div>`).join('');

  // 3) Atalho da vitrine: escolhe o serviço, marca o card e avança ao Passo 2.
  document.querySelectorAll('[data-agendar]').forEach((b) =>
    b.onclick = () => {
      state.servico = servicos.find((s) => s.id == b.dataset.agendar);
      marcarSelecionado($('#etapaServicos'), state.servico.id);
      carregarProfs().then(() => irPara(2));
    });

  // 3b) Clique direto no Passo 1: mesma coisa, com micro-delay p/ ver o (.sel).
  $('#etapaServicos').onclick = (e) => {
    const card = e.target.closest('.card'); if (!card) return; // clicou fora? ignora
    state.servico = servicos.find((s) => s.id == card.dataset.id);
    marcarSelecionado($('#etapaServicos'), state.servico.id);
    setTimeout(async () => { await carregarProfs(); irPara(2); }, 150);
  };

  // 4) Passo 3: navegação entre semanas (o cliente vê 7 dias por vez).
  $('#semanaAnterior').onclick = () => mudarSemana(-7);
  $('#semanaProxima').onclick = () => mudarSemana(7);

  // Botões "Voltar": descobrem a etapa visível e retornam uma casa.
  document.querySelectorAll('[data-voltar]').forEach((b) =>
    b.onclick = () => {
      const atual = Number(document.querySelector('[data-etapa]:not([hidden])').dataset.etapa);
      irPara(Math.max(1, atual - 1));
    });

  // Voltou o foco para a aba no Passo 3? Reconfere as vagas (alguém pode ter
  // reservado enquanto o cliente estava fora) e atualiza os dias na hora.
  document.addEventListener('visibilitychange', () => {
    const etapa3 = document.querySelector('[data-etapa="3"]');
    if (!document.hidden && etapa3 && !etapa3.hidden && state.profissional) {
      carregarSemana().catch(() => {});
    }
  });

  $('#btnConfirmar').onclick = confirmar; // Passo 4 → POST que cria a reserva
  $('#btnNovo').onclick = () => location.reload(); // recomeça o wizard do zero
  $('#btnIcs').onclick = baixarIcs; // baixa o evento p/ o calendário do cliente
}

/**
 * carregarProfs() — monta o Passo 2: busca barbeiros ativos e cria um card
 * por profissional. O clique salva em state.profissional e avança ao Passo 3.
 */
async function carregarProfs() {
  const profs = await api('/api/profissionais');
  $('#etapaProfs').innerHTML = profs.map((p) => `
    <div class="card" data-id="${p.id}" style="cursor:pointer"><h3>${p.apelido || p.nome}</h3>
    <div class="meta">${p.nome}</div></div>`).join('') || '<div class="card">Nenhum profissional.</div>';
  $('#etapaProfs').onclick = (e) => {
    const card = e.target.closest('.card'); if (!card) return;
    state.profissional = profs.find((p) => p.id == card.dataset.id);
    marcarSelecionado($('#etapaProfs'), state.profissional.id);
    // Já busca a semana ANTES de mostrar o Passo 3 (abre com os dias prontos).
    setTimeout(async () => { await carregarSemana(); irPara(3); }, 150);
  };
}

/**
 * =========================  PASSO 3 — SEMANA  ===============================
 * O cliente vê 7 dias de uma vez (sem digitar data) e só pode clicar nos dias
 * com vaga. Um dia fechado, bloqueado ou LOTADO aparece desabilitado — e, como
 * os dados vêm do banco na hora, basta alguém reservar o último horário para
 * o dia "fechar" para os próximos clientes. 🗓️
 * ============================================================================
 */
const DIAS_CURTOS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

/** Data local no formato ISO 'AAAA-MM-DD' (sem erro de fuso do toISOString). */
function dataISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const hojeISO = () => dataISO(new Date());

/** Soma (ou subtrai) dias de uma data ISO. */
function somarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dataISO(d);
}

/** Segunda-feira da semana da data informada (semana = seg … dom). */
function segundaDaSemana(iso) {
  const d = new Date(iso + 'T12:00:00');
  const dw = d.getDay(); // 0=dom … 6=sáb
  d.setDate(d.getDate() + (dw === 0 ? -6 : 1 - dw));
  return dataISO(d);
}

/** '2026-11-02' → '02/11' (só para exibir). */
const diaMes = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

/** Busca a semana visível no backend e desenha os 7 dias. */
async function carregarSemana() {
  if (!state.semanaInicio) state.semanaInicio = segundaDaSemana(hojeISO());
  const box = $('#semanaDias');
  box.innerHTML = '<span class="meta">Carregando dias…</span>';
  try {
    const r = await api(`/api/disponibilidade-semana?data_inicio=${state.semanaInicio}` +
      `&profissional_id=${state.profissional.id}&servico_id=${state.servico.id}`);
    state.diasSemana = r.dias; // [{data, dia_semana, aberto, total, horarios}]
    renderSemana();
  } catch (e) {
    box.innerHTML = `<span class="meta">${e.message}</span>`;
  }
}

/** Desenha os 7 botões de dia com o estado de cada um. */
function renderSemana() {
  const dias = state.diasSemana || [];
  if (!dias.length) return;
  const hoje = hojeISO();

  $('#semanaTitulo').textContent = `semana de ${diaMes(dias[0].data)} a ${diaMes(dias[6].data)}`;
  // Não deixa voltar para antes da semana atual.
  $('#semanaAnterior').disabled = dias[0].data <= segundaDaSemana(hoje);

  const box = $('#semanaDias');
  box.innerHTML = dias.map((d) => {
    const passou = d.data < hoje;
    const lotado = d.total === 0;
    const sel = state.data === d.data;
    // Rótulo embaixo do número: passou / fechado / lotado / N vagas.
    const rotulo = passou ? 'passou' : !d.aberto ? 'fechado' : lotado ? 'lotado' : `${d.total} vagas`;
    const classes = ['semana-dia', passou && 'passado', lotado && 'cheio', sel && 'sel', d.data === hoje && 'hoje']
      .filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-data="${d.data}" ${passou || lotado ? 'disabled' : ''}>
      <span class="sem">${DIAS_CURTOS[d.dia_semana]}</span>
      <span class="num">${Number(d.data.slice(8, 10))}</span>
      <span class="vagas">${rotulo}</span>
    </button>`;
  }).join('');

  // Só dias realmente clicáveis ganham ação.
  box.querySelectorAll('.semana-dia:not([disabled])').forEach((b) => {
    b.onclick = () => escolherDia(b.dataset.data);
  });

  // Nenhum dia livre na semana? Avisa e sugere a próxima.
  if (!dias.some((d) => d.data >= hoje && d.total > 0)) {
    box.insertAdjacentHTML('beforeend',
      '<div class="meta" style="grid-column:1/-1;margin-top:6px">Nenhum dia com vaga nesta semana — use → para ver a próxima.</div>');
  }
}

/** Clique num dia: guarda a data e mostra os horários que já vieram da API. */
function escolherDia(data) {
  state.data = data;
  state.hora = null; // trocou o dia → zera o horário escolhido
  document.querySelectorAll('.semana-dia').forEach((b) => b.classList.toggle('sel', b.dataset.data === data));
  const dia = (state.diasSemana || []).find((d) => d.data === data);
  renderHoras(dia ? dia.horarios : []);
}

/** Desenha os botões de horário; clicar num deles vai ao Passo 4. */
function renderHoras(horarios) {
  const box = $('#listaHoras');
  if (!state.data) { box.innerHTML = '<span class="meta">Escolha um dia acima.</span>'; return; }
  box.innerHTML = horarios.length
    ? horarios.map((h) => `<button type="button" class="hora" data-h="${h}">${h}</button>`).join('')
    : '<span class="meta">Sem horários vagos neste dia. Escolha outro dia.</span>';
  box.querySelectorAll('.hora').forEach((b) => {
    b.onclick = () => {
      state.hora = b.dataset.h;
      box.querySelectorAll('.hora').forEach((x) => x.classList.toggle('sel', x === b));
      setTimeout(() => irPara(4), 200);
    };
  });
}

/** Navega entre semanas (7 dias), sem permitir ir para o passado. */
function mudarSemana(delta) {
  const atual = state.semanaInicio || segundaDaSemana(hojeISO());
  const destino = somarDias(atual, delta);
  if (destino < segundaDaSemana(hojeISO())) return; // não volta ao passado
  state.semanaInicio = destino;
  state.data = null;
  state.hora = null;
  $('#listaHoras').innerHTML = '<span class="meta">Escolha um dia acima.</span>';
  carregarSemana();
}

/**
 * confirmar() — Passo 4: valida nome + telefone, desabilita o botão (evita
 * clique duplo) e faz POST /api/agendamentos. Em caso de 409 (horário ocupado
 * por outra pessoa nesse meio-tempo), mostra o erro sem perder os dados.
 * No sucesso, monta o Passo 5: mensagem, resumo e link do WhatsApp
 * (wa.me/<numero>?text=<mensagem pronta e codificada>).
 */
async function confirmar() {
  const nome = $('#cliNome').value.trim();
  const fone = $('#cliFone').value.trim();
  const email = $('#cliEmail').value.trim(); // opcional: pode ir vazio
  if (!nome || !fone) return erro('Informe nome e telefone/WhatsApp.');
  $('#btnConfirmar').disabled = true; // trava contra duplo clique
  try {
    const ag = await api('/api/agendamentos', { method: 'POST', body: JSON.stringify({
      servico_id: state.servico.id, profissional_id: state.profissional.id,
      data: state.data, hora: state.hora, cliente_nome: nome, cliente_telefone: fone, cliente_email: email,
    })});
    state.ultimoAg = ag; // guardado p/ gerar o .ics depois
    const dataBR = ag.data.split('-').reverse().join('/'); // AAAA-MM-DD → DD/MM/AAAA
    $('#confirmBox').textContent = `Agendado para ${dataBR} às ${ag.hora} com ${ag.profissional_nome}.`;
    $('#resumoFinal').innerHTML =
      `<b>${ag.servico_nome}</b> • ${BRL(ag.preco_centavos)} • ~${ag.duracao_min}min<br>` +
      `Cliente: ${ag.cliente_nome} (${ag.cliente_telefone})`;
    // Monta mensagem pronta p/ a Barber Code receber no WhatsApp com 1 clique.
    const texto = encodeURIComponent(`Olá, Barber Code! Agendei ${ag.servico_nome} dia ${dataBR} às ${ag.hora} com ${ag.profissional_nome}. Nome: ${ag.cliente_nome}`);
    $('#btnWhats').href = state.whatsapp
      ? `https://wa.me/${state.whatsapp}?text=${texto}`
      : `https://wa.me/?text=${texto}`;
    irPara(5);
  } catch (e) {
    erro(e.message);
    // 409 = alguém pegou o horário nesse meio-tempo: volta ao Passo 3 com a
    // semana recarregada (o dia pode ter ficado "lotado" na hora).
    if (/indispon|ocupad/i.test(e.message)) {
      state.semanaInicio = segundaDaSemana(state.data);
      await carregarSemana();
      irPara(3);
    }
  } finally { $('#btnConfirmar').disabled = false; }
}

/**
 * baixarIcs() — gera um arquivo .ics (formato universal de calendário) com
 * os dados do agendamento e força o download. Funciona com Google Agenda,
 * Apple Calendar e Outlook: o cliente importa em 2 cliques.
 */
function baixarIcs() {
  const ag = state.ultimoAg; if (!ag) return;
  // .ics usa data/hora compacta: 20261008T093000 (sem traços nem dois-pontos).
  const dt = ag.data.replaceAll('-', '') + 'T' + ag.hora.replace(':', '') + '00';
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
    `DTSTART:${dt}`, `SUMMARY:Barber Code — ${ag.servico_nome}`,
    `DESCRIPTION:Com ${ag.profissional_nome}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a'); // link temporário invisível…
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); // …apontando p/ o texto
  a.download = 'agendamento-barbercode.ics'; a.click(); // …clicado via código = download
}

// Dispara tudo. Se a API estiver fora do ar, mostra o erro na vitrine.
init().catch((e) => { $('#listaServicos').innerHTML = `<div class="card">${e.message}</div>`; });
