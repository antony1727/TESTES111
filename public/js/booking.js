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
 *  4. configura data mínima (= hoje), botões Voltar, Confirmar, .ics e Novo.
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

  // 4) Passo 3: o calendário não aceita passado (min = hoje, formato ISO).
  $('#campoData').min = new Date().toISOString().slice(0, 10);
  $('#campoData').onchange = carregarHoras; // trocou o dia → recarrega horários

  // Botões "Voltar": descobrem a etapa visível e retornam uma casa.
  document.querySelectorAll('[data-voltar]').forEach((b) =>
    b.onclick = () => {
      const atual = Number(document.querySelector('[data-etapa]:not([hidden])').dataset.etapa);
      irPara(Math.max(1, atual - 1));
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
    setTimeout(() => irPara(3), 150);
  };
}

/**
 * carregarHoras() — monta o Passo 3: com (data + profissional + serviço),
 * pede os slots livres ao backend e renderiza um botão por horário. Clicar
 * num horário salva em state.hora e avança ao Passo 4 (dados do cliente).
 */
async function carregarHoras() {
  state.data = $('#campoData').value; state.hora = null; // trocou o dia? reseta a hora
  const box = $('#listaHoras');
  if (!state.data) { box.innerHTML = '<span class="meta">Escolha uma data.</span>'; return; }
  box.innerHTML = '<span class="meta">Buscando horários…</span>'; // feedback de loading
  try {
    const r = await api(`/api/disponibilidade?data=${state.data}&profissional_id=${state.profissional.id}&servico_id=${state.servico.id}`);
    box.innerHTML = r.horarios.length
      ? r.horarios.map((h) => `<button class="hora" data-h="${h}">${h}</button>`).join('')
      : '<span class="meta">Sem horários vagos neste dia. Tente outra data.</span>';
    box.querySelectorAll('.hora').forEach((b) => b.onclick = () => {
      state.hora = b.dataset.h;
      box.querySelectorAll('.hora').forEach((x) => x.classList.toggle('sel', x === b));
      setTimeout(() => irPara(4), 200);
    });
  } catch (e) { box.innerHTML = `<span class="meta">${e.message}</span>`; }
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
  } catch (e) { erro(e.message); } finally { $('#btnConfirmar').disabled = false; }
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
