/**
 * admin.js — LÓGICA DO PAINEL DO BARBEIRO (/admin).
 * ----------------------------------------------------------------------------
 * 1. Utilidades .......... $, $$, BRL, DIAS, token, datas
 * 2. api() ............... fetch com JWT + logout em 401
 * 3. Login / Sair ........ formLogin grava o token
 * 4. boot() .............. abre o painel e liga abas, filtros e ações
 * 5. carregarTudo() ...... KPIs + cliente em destaque + listas + faturamento
 * 6. Ações ............... concluir, cancelar, reabrir, excluir
 * 7. Tempo real .......... SSE + verificador de 5s + toast
 * 8. Configurações ....... expediente semanal e bloqueios
 */

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const BRL = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const token = () => localStorage.getItem('bb_token');

/** Escapa texto vindo do banco/cliente antes de entrar em innerHTML. */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ---------------- datas ---------------- */
function dataISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const isoHoje = () => dataISO(new Date());
function somarDiasISO(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dataISO(d);
}
const dataBR = (iso) => String(iso || '').split('-').reverse().join('/');
function dataLonga(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
  });
}
function horaAgora() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function somarMin(hora, min) {
  const [h, m] = String(hora).split(':').map(Number);
  const t = h * 60 + m + Number(min || 0);
  return String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}
function minutosDesde(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  const d = new Date();
  return Math.max(0, d.getHours() * 60 + d.getMinutes() - (h * 60 + m));
}
const iniciais = (nome) => String(nome || '?').trim().split(/\s+/).slice(0, 2)
  .map((p) => p[0]).join('').toUpperCase();
const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';

/** Link do WhatsApp com mensagem pronta para o cliente do agendamento. */
function linkWhats(a) {
  let fone = String(a.cliente_telefone || '').replace(/\D/g, '');
  if (fone.length <= 11) fone = '55' + fone;
  const texto = encodeURIComponent(
    `Olá, ${a.cliente_nome}! Aqui é da Barber Code. ` +
    `Confirmando seu ${a.servico_nome} em ${dataBR(a.data)} às ${a.hora} com ${a.profissional_nome}.`
  );
  return fone ? `https://wa.me/${fone}?text=${texto}` : `https://wa.me/?text=${texto}`;
}

/* ---------------- estado local ---------------- */
const state = {
  data: isoHoje(),      // dia exibido na agenda/faturamento
  status: '',           // filtro de status (aba Comandas)
  view: 'agenda',
  lista: [],            // agendamentos do dia (sem filtro)
  resumo: null,
  pill: 'hoje',
};

/**
 * fetch do painel: JSON + Authorization automáticos.
 * 401 → sessão inválida: apaga o token e volta ao login.
 */
async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: 'Bearer ' + token() } : {}),
      ...opts.headers,
    },
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(); throw new Error('Sessão expirada. Faça login.'); }
  if (!r.ok) throw new Error(data.erro || 'Falha na requisição.');
  return data;
}

function logout() {
  localStorage.removeItem('bb_token');
  location.reload();
}

/* ---------------- login ---------------- */
$('#formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = $('#loginErro');
  box.hidden = true;
  const btn = $('#btnLogin');
  btn.disabled = true;
  try {
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('#loginEmail').value, senha: $('#loginSenha').value }),
    });
    localStorage.setItem('bb_token', r.token);
    localStorage.setItem('bb_email', $('#loginEmail').value.trim());
    await boot();
  } catch (err) {
    box.hidden = false;
    box.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
$('#btnSair').onclick = logout;

/* ---------------- navegação entre abas ---------------- */
function irParaView(view, opts = {}) {
  state.view = view;
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.viewBtn === view));
  if (!opts.semScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('.nav-item').forEach((b) => {
  b.onclick = () => {
    irParaView(b.dataset.viewBtn);
    if (b.dataset.viewBtn === 'comandas') sincronizarFiltros();
    if (b.dataset.viewBtn === 'faturamento') sincronizarFiltros();
  };
});
$('#btnPerfilTopo').onclick = () => irParaView('perfil');

$$('#pillsDia .seg').forEach((b) => {
  b.onclick = () => selecionarPill(b.dataset.pill);
});

function selecionarPill(pill) {
  if (pill === 'historico') { irParaView('comandas'); return; }
  state.pill = pill;
  state.data = pill === 'amanha' ? somarDiasISO(isoHoje(), 1) : isoHoje();
  sincronizarFiltros();
  atualizarPills();
  carregarTudo();
}
function atualizarPills() {
  const hoje = isoHoje();
  const amanha = somarDiasISO(hoje, 1);
  $$('#pillsDia .seg').forEach((b) => {
    const ativo = (b.dataset.pill === 'hoje' && state.data === hoje) ||
      (b.dataset.pill === 'amanha' && state.data === amanha);
    b.classList.toggle('active', ativo);
  });
}
function sincronizarFiltros() {
  $('#filtroData').value = state.data;
  $('#fatData').value = state.data;
}
$('#filtroData').onchange = () => {
  state.data = $('#filtroData').value || isoHoje();
  atualizarPills();
  carregarTudo();
};
$('#fatData').onchange = () => {
  state.data = $('#fatData').value || isoHoje();
  sincronizarFiltros();
  atualizarPills();
  carregarTudo();
};
$('#filtroStatus').onchange = () => {
  state.status = $('#filtroStatus').value;
  renderComandas();
};
$('#btnRecarregar').onclick = () => carregarTudo();
$('#btnAtualizarTopo').onclick = () => { carregarTudo(); toast('Agenda atualizada.', 'ok'); };
$('#btnNotif').onclick = () => {
  $('#notifDot').hidden = true;
  carregarTudo();
  toast('Agenda atualizada.', 'ok');
};
$$('[data-atalho]').forEach((b) => {
  b.onclick = () => {
    irParaView('perfil');
    if (b.dataset.atalho === 'bloqueios') {
      setTimeout(() => {
        $('#bloqData').value = state.data;
        $('#bloqData').focus();
        $('#bloqData').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    }
  };
});

/* ---------------- boot ---------------- */
async function boot() {
  if (!token()) return; // sem token = continua no login
  $('#telaLogin').hidden = true;
  $('#painel').hidden = false;

  const email = localStorage.getItem('bb_email') || 'admin@barbercode.app';
  const ini = email.slice(0, 2).toUpperCase();
  $('#perfilEmail').textContent = email;
  $('#avatarPerfil').textContent = ini;
  $('#btnPerfilTopo').textContent = ini;

  state.data = isoHoje();
  sincronizarFiltros();
  atualizarPills();
  renderSaudacao();
  $('#bloqData').value = state.data;

  $('#btnSalvarFunc').onclick = salvarFunc;
  $('#btnBloquear').onclick = criarBloqueio;

  await carregarTudo();
  await carregarConfig().catch(() => {});
  await definirBase().catch(() => {});
  conectarTempoReal();
  iniciarVerificador();
}

function renderSaudacao() {
  const nome = new Date().toLocaleDateString('pt-BR', { weekday: 'long' });
  $('#saudacaoData').textContent = `Atelier Barber Code • ${nome}`;
}

/* ============================================================================
   CARREGAMENTO PRINCIPAL
   ============================================================================ */
async function carregarTudo() {
  try {
    const data = state.data;
    const [resumo, lista] = await Promise.all([
      api('/api/admin/resumo?data=' + data),
      api('/api/admin/agendamentos?data=' + data),
    ]);
    state.resumo = resumo;
    state.lista = lista;
    renderKPIs();
    renderAtual();
    renderAgenda();
    renderComandas();
    renderFaturamento();
  } catch (e) {
    toast(e.message, 'erro');
  }
}

const ordenada = () => state.lista.slice().sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
const somaValores = (lista) => lista.reduce((t, a) => t + Number(a.preco_centavos || 0), 0);
const vazio = (icone, titulo, texto) =>
  `<div class="empty"><span class="material-symbols-outlined">${icone}</span><b>${titulo}</b><span>${texto}</span></div>`;

/** Próximo confirmado: hoje usa a hora atual; dias futuros usam o primeiro. */
function proximoConfirmado() {
  const confirmados = ordenada().filter((a) => a.status === 'confirmado');
  if (!confirmados.length) return null;
  if (state.data === isoHoje()) return confirmados.find((a) => a.hora >= horaAgora()) || null;
  if (state.data > isoHoje()) return confirmados[0];
  return null;
}

/** Cliente que está na cadeira agora (só faz sentido para o dia de hoje). */
function atualEmAndamento() {
  if (state.data !== isoHoje()) return null;
  const agora = horaAgora();
  return ordenada().find((a) =>
    a.status === 'confirmado' && a.hora <= agora && somarMin(a.hora, a.duracao_min) > agora
  ) || null;
}

function renderKPIs() {
  const r = state.resumo || { total: 0, faturamento_centavos: 0 };
  const concluidos = state.lista.filter((a) => a.status === 'concluido');
  const confirmados = state.lista.filter((a) => a.status === 'confirmado');
  const recebido = somaValores(concluidos);
  const totalFat = Number(r.faturamento_centavos || 0);

  $('#kpiFat').textContent = BRL(totalFat);
  $('#kpiFatFoot').textContent = `${concluidos.length} de ${r.total} concluídos`;
  const hoje = isoHoje();
  $('#kpiFatLabel').textContent = state.data === hoje ? 'Hoje'
    : state.data === somarDiasISO(hoje, 1) ? 'Amanhã' : dataBR(state.data);
  $('#barFat').style.width = totalFat ? Math.round((recebido / totalFat) * 100) + '%' : '0%';

  $('#kpiTotal').textContent = r.total;
  $('#kpiTotalFoot').textContent = `${confirmados.length} a fazer`;
  $('#barTotal').style.width = r.total ? Math.round((concluidos.length / r.total) * 100) + '%' : '0%';

  const prox = proximoConfirmado();
  $('#kpiProx').textContent = prox ? prox.hora : '—';
  $('#kpiProxFoot').textContent = prox ? primeiroNome(prox.cliente_nome) : 'sem próximo';
  $('#barProx').style.width = prox ? '100%' : '0%';
}

function renderAtual() {
  const atual = atualEmAndamento();
  const prox = proximoConfirmado();
  const destaque = atual || prox || null;

  // Status do topo é derivado da agenda real (sem botão fictício).
  $('#statusTexto').textContent = atual ? 'Em atendimento' : 'Disponível';
  $('#statusChip').textContent = atual ? 'Na cadeira' : 'Livre agora';
  const cor = atual ? 'var(--green)' : 'var(--primary)';
  $('#statusDot').style.background = cor;
  $('#chipStatus .dot').style.background = cor;

  if (atual) {
    $('#proximoResumo').textContent =
      `${atual.hora} – ${somarMin(atual.hora, atual.duracao_min)} • Em atendimento com ${primeiroNome(atual.cliente_nome)}`;
  } else if (prox) {
    $('#proximoResumo').textContent =
      `Próximo às ${prox.hora} • ${primeiroNome(prox.cliente_nome)} (${prox.servico_nome})`;
  } else {
    $('#proximoResumo').textContent = state.data === isoHoje()
      ? 'Nenhum atendimento pendente para hoje.'
      : 'Nenhum atendimento pendente neste dia.';
  }

  const box = $('#atualConteudo');
  if (!destaque) {
    box.innerHTML = vazio(
      'event_available',
      'Nenhum cliente na cadeira agora',
      prox ? `Próximo às ${prox.hora} com ${esc(prox.cliente_nome)}.` : 'Aproveite para revisar a agenda e os bloqueios.'
    );
    return;
  }

  const emAndamento = Boolean(atual);
  const quando = emAndamento
    ? `Iniciado há ${minutosDesde(destaque.hora)}m`
    : `${dataBR(state.data)} às ${destaque.hora}`;

  box.innerHTML = `
    <div class="client-top">
      <span class="badge ${emAndamento ? 'badge-green' : 'badge-primary'}">
        <span class="material-symbols-outlined">${emAndamento ? 'airline_seat_recline_extra' : 'schedule'}</span>
        ${emAndamento ? 'Em andamento' : 'Próximo'}
      </span>
      <span class="client-time"><span class="material-symbols-outlined">schedule</span>${quando}</span>
    </div>
    <div class="client-body">
      <div class="avatar">${iniciais(destaque.cliente_nome)}</div>
      <div class="client-info">
        <div class="client-name">
          <h3>${esc(destaque.cliente_nome)}</h3>
          <span class="price">${BRL(destaque.preco_centavos)}</span>
        </div>
        <span class="client-service">${esc(destaque.servico_nome)}</span>
        <span class="client-meta"><span class="material-symbols-outlined">timer</span>${destaque.hora}–${somarMin(destaque.hora, destaque.duracao_min)} · ${destaque.duracao_min} min</span>
        <span class="client-meta"><span class="material-symbols-outlined">badge</span>${esc(destaque.cliente_telefone)} · ${esc(destaque.profissional_nome)}</span>
      </div>
    </div>
    <div class="note-box">
      <span class="material-symbols-outlined">room_service</span>
      <div><b>Atendimento:</b> ${esc(destaque.servico_nome)} com ${esc(destaque.profissional_nome)}. Confirme a presença pelo WhatsApp antes de iniciar.</div>
    </div>
    <div class="action-grid">
      <a class="btn btn-outline btn-sm" href="${linkWhats(destaque)}" target="_blank" rel="noopener">
        <span class="material-symbols-outlined">chat</span> WhatsApp
      </a>
      <button class="btn btn-danger btn-sm" type="button" data-canc="${destaque.id}">
        <span class="material-symbols-outlined">close</span> Cancelar
      </button>
    </div>
    <button class="btn btn-primary btn-block" type="button" data-ok="${destaque.id}">
      <span class="material-symbols-outlined">check_circle</span> Concluir &amp; liberar cadeira
    </button>`;

  bindAcoes(box);
}

/* ---------------- card de agendamento (agenda e comandas) ---------------- */
function infoStatus(a) {
  if (a.status === 'concluido') {
    return { label: 'Concluído', cls: 'badge-green', cor: 'var(--green)', nota: 'Atendimento concluído', icone: 'check_circle' };
  }
  if (a.status === 'cancelado') {
    return { label: 'Cancelado', cls: 'badge-red', cor: 'var(--error)', nota: 'Horário liberado para novos clientes', icone: 'cancel' };
  }
  return { label: 'Confirmado', cls: 'badge-primary', cor: 'var(--primary)', nota: 'Aguardando atendimento', icone: 'schedule' };
}

function cardAgendamento(a) {
  const info = infoStatus(a);
  const acoes = [];
  acoes.push(`<a class="btn btn-ghost btn-icon" href="${linkWhats(a)}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp">
    <span class="material-symbols-outlined">chat</span></a>`);
  if (a.status === 'confirmado') {
    acoes.push(`<button class="btn btn-ghost btn-sm" type="button" data-ok="${a.id}">
      <span class="material-symbols-outlined">check</span> Concluir</button>`);
    acoes.push(`<button class="btn btn-ghost btn-icon" type="button" data-canc="${a.id}" title="Cancelar" aria-label="Cancelar">
      <span class="material-symbols-outlined">close</span></button>`);
  } else {
    acoes.push(`<button class="btn btn-ghost btn-sm" type="button" data-reabrir="${a.id}">
      <span class="material-symbols-outlined">undo</span> Reabrir</button>`);
  }
  acoes.push(`<button class="btn btn-ghost btn-icon" type="button" data-del="${a.id}" title="Excluir" aria-label="Excluir">
    <span class="material-symbols-outlined">delete</span></button>`);

  return `
  <article class="timeline-item">
    <div class="timeline-main">
      <div class="time-box"><b>${a.hora}</b><small>${a.duracao_min} min</small></div>
      <div class="item-info">
        <div class="item-name">
          <span class="status-dot" style="background:${info.cor}"></span>
          ${esc(a.cliente_nome)}
        </div>
        <div class="item-service">${esc(a.servico_nome)}</div>
        <div class="item-sub">${esc(a.profissional_nome)} · ${esc(a.cliente_telefone)}</div>
      </div>
      <div class="item-right">
        <span class="price">${BRL(a.preco_centavos)}</span>
        <span class="badge ${info.cls}">${info.label}</span>
      </div>
    </div>
    <div class="timeline-note">
      <span>${info.nota}</span>
      <div class="item-actions">${acoes.join('')}</div>
    </div>
  </article>`;
}

function renderAgenda() {
  const lista = ordenada();
  $('#contadorAgenda').textContent = `${lista.length} agendado${lista.length === 1 ? '' : 's'}`;
  const box = $('#listaAgenda');
  box.innerHTML = lista.length
    ? lista.map(cardAgendamento).join('')
    : vazio('event_available', 'Nenhum agendamento', 'Os horários reservados pelos clientes aparecem aqui em tempo real.');
  bindAcoes(box);
}

function renderComandas() {
  const lista = ordenada().filter((a) => !state.status || a.status === state.status);
  $('#comandasCount').textContent = `${lista.length}`;
  $('#comandasTotal').textContent =
    `Total do dia: ${BRL(somaValores(lista.filter((a) => a.status !== 'cancelado')))}`;
  const box = $('#listaComandas');
  box.innerHTML = lista.length
    ? lista.map(cardAgendamento).join('')
    : vazio('receipt_long', 'Nada por aqui', 'Nenhum agendamento com esse filtro nesta data.');
  bindAcoes(box);
}

function renderFaturamento() {
  const lista = ordenada();
  const validos = lista.filter((a) => a.status !== 'cancelado');
  const concluidos = lista.filter((a) => a.status === 'concluido');
  const confirmados = lista.filter((a) => a.status === 'confirmado');
  const cancelados = lista.filter((a) => a.status === 'cancelado');
  const recebido = somaValores(concluidos);
  const aReceber = somaValores(confirmados);
  const total = somaValores(validos);

  $('#fatData').value = state.data;
  $('#fatDataLabel').textContent = `Resumo de ${dataLonga(state.data)}.`;
  $('#fatRecebido').textContent = BRL(recebido);
  $('#fatReceber').textContent = BRL(aReceber);
  $('#fatTotal').textContent = BRL(total);
  $('#fatTicket').textContent = BRL(validos.length ? Math.round(total / validos.length) : 0);
  $('#fatAtend').textContent = String(lista.length);
  $('#fatCancelado').textContent = BRL(somaValores(cancelados));

  const box = $('#fatDetalhe');
  box.innerHTML = lista.length
    ? lista.map((a) => {
      const info = infoStatus(a);
      return `<div class="list-row">
        <span class="material-symbols-outlined">${info.icone}</span>
        <div class="grow">${a.hora} · ${esc(a.cliente_nome)}<br><span class="muted">${esc(a.servico_nome)}</span></div>
        <b class="${a.status === 'cancelado' ? 'red' : ''}">${BRL(a.preco_centavos)}</b>
      </div>`;
    }).join('')
    : vazio('payments', 'Sem lançamentos', 'Nenhum agendamento nesta data.');
}

/* ---------------- ações da agenda ---------------- */
function bindAcoes(root) {
  $$('[data-ok]', root).forEach((b) => { b.onclick = () => mudaStatus(b.dataset.ok, 'concluido'); });
  $$('[data-canc]', root).forEach((b) => { b.onclick = () => mudaStatus(b.dataset.canc, 'cancelado'); });
  $$('[data-reabrir]', root).forEach((b) => { b.onclick = () => mudaStatus(b.dataset.reabrir, 'confirmado'); });
  $$('[data-del]', root).forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Excluir DEFINITIVAMENTE este agendamento? O histórico dele será apagado.')) return;
      try {
        await api(`/api/admin/agendamentos/${b.dataset.del}`, { method: 'DELETE' });
        toast('Agendamento excluído.', 'ok');
        carregarTudo();
      } catch (e) { toast(e.message, 'erro'); }
    };
  });
}

async function mudaStatus(id, status) {
  if (status === 'cancelado' && !confirm('Cancelar este agendamento? O horário ficará livre para outro cliente.')) return;
  try {
    await api(`/api/admin/agendamentos/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast(
      status === 'concluido' ? 'Atendimento concluído. Cadeira liberada.'
        : status === 'cancelado' ? 'Agendamento cancelado.' : 'Agendamento reaberto.',
      'ok'
    );
    await carregarTudo();
  } catch (e) {
    toast(e.message, 'erro');
  }
}

/* ============================================================================
   TEMPO REAL — SSE (instantâneo) + verificador de 5s (funciona em qualquer rede)
   ============================================================================ */
let ultimoIdConhecido = 0;
let checando = false;

function toast(mensagem, tipo = 'novo') {
  const el = $('#toast');
  if (!el) return;
  el.className = 'toast ' + tipo;
  el.textContent = mensagem;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 6500);
}

function registrarNovo(ag) {
  if (!ag || !ag.id || ag.id <= ultimoIdConhecido) return;
  ultimoIdConhecido = ag.id;
  $('#notifDot').hidden = false;
  toast(`Novo agendamento: ${ag.cliente_nome} — ${ag.servico_nome} em ${dataBR(ag.data)} às ${ag.hora} (${ag.profissional_nome})`);
  carregarTudo();
}

async function definirBase() {
  const lista = await api('/api/admin/ultimos?desde=0');
  ultimoIdConhecido = lista.reduce((m, a) => Math.max(m, a.id), 0);
}

function conectarTempoReal() {
  if (!window.EventSource) return;
  const fonte = new EventSource('/api/admin/eventos?token=' + encodeURIComponent(token()));
  fonte.addEventListener('pronto', () => console.log('[tempo real] conectado'));
  fonte.addEventListener('novo', (ev) => {
    let ag;
    try { ag = JSON.parse(ev.data); } catch { return; }
    registrarNovo(ag);
  });
  fonte.onerror = () => {
    if (!token()) return;
    console.warn('[tempo real] conexão caiu, o verificador continua ativo.');
  };
}

async function verificarNovos() {
  if (checando || document.hidden || !token()) return;
  checando = true;
  try {
    const lista = await api('/api/admin/ultimos?desde=' + ultimoIdConhecido);
    lista.forEach(registrarNovo);
  } catch { /* rede instável: tenta no próximo ciclo */ }
  finally { checando = false; }
}

function iniciarVerificador() {
  if (iniciarVerificador._t) return;
  iniciarVerificador._t = setInterval(verificarNovos, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) verificarNovos();
  });
}

/* ============================================================================
   CONFIGURAÇÕES — expediente semanal + bloqueios
   ============================================================================ */
async function carregarConfig() {
  await Promise.allSettled([carregarFunc(), carregarBloq()]);
}

async function carregarFunc() {
  const dias = await api('/api/admin/funcionamento');
  const box = $('#gradeFunc');
  box.innerHTML = dias.map((d) => {
    const almoco = d.almoco_inicio && d.almoco_fim ? `${d.almoco_inicio}-${d.almoco_fim}` : '';
    return `
    <div class="settings-day ${d.aberto ? 'is-open' : ''}" data-dia="${d.dia_semana}">
      <div class="day-name">${DIAS[d.dia_semana]}</div>
      <label class="switch" title="Aberto / fechado">
        <input type="checkbox" data-f="aberto" ${d.aberto ? 'checked' : ''} aria-label="${DIAS[d.dia_semana]} aberto" />
        <span></span>
      </label>
      <div class="settings-times">
        <label class="field"><span class="field-label">Abre</span><input class="input" type="time" data-f="abertura" value="${esc(d.abertura || '09:00')}" /></label>
        <label class="field"><span class="field-label">Fecha</span><input class="input" type="time" data-f="fechamento" value="${esc(d.fechamento || '19:00')}" /></label>
        <label class="field full"><span class="field-label">Almoço (opcional)</span><input class="input" type="text" data-f="almoco" value="${esc(almoco)}" placeholder="12:00-13:00" /></label>
      </div>
    </div>`;
  }).join('');

  $$('#gradeFunc .settings-day').forEach((row) => {
    const chk = row.querySelector('[data-f="aberto"]');
    chk.onchange = () => row.classList.toggle('is-open', chk.checked);
  });
}

async function salvarFunc() {
  const btn = $('#btnSalvarFunc');
  btn.disabled = true;
  try {
    const dias = $$('#gradeFunc .settings-day').map((el) => {
      const g = (f) => el.querySelector(`[data-f="${f}"]`).value.trim();
      const almoco = g('almoco');
      if (almoco && !/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(almoco)) {
        throw new Error('Almoço inválido. Use o formato 12:00-13:00.');
      }
      const partes = almoco.replace(/\s/g, '').split('-');
      return {
        dia_semana: Number(el.dataset.dia),
        aberto: el.querySelector('[data-f="aberto"]').checked ? 1 : 0,
        abertura: g('abertura') || '09:00',
        fechamento: g('fechamento') || '19:00',
        almoco_inicio: partes[0] || null,
        almoco_fim: partes[1] || null,
      };
    });
    await api('/api/admin/funcionamento', { method: 'PUT', body: JSON.stringify({ dias }) });
    toast('Expediente salvo. Vale na hora para novos agendamentos.', 'ok');
  } catch (e) {
    toast(e.message, 'erro');
  } finally {
    btn.disabled = false;
  }
}

async function carregarBloq() {
  const lista = await api('/api/admin/bloqueios');
  const box = $('#listaBloq');
  box.innerHTML = lista.length
    ? lista.map((b) => `
      <div class="list-row">
        <span class="material-symbols-outlined">event_busy</span>
        <div class="grow">
          <b>${dataBR(b.data)}</b> · ${b.hora_inicio ? `${esc(b.hora_inicio)}–${esc(b.hora_fim)}` : 'dia todo'}
          <br><span class="muted">${esc(b.motivo || 'sem motivo informado')}</span>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" data-unlock="${b.id}">
          <span class="material-symbols-outlined">lock_open</span> Liberar
        </button>
      </div>`).join('')
    : vazio('event_available', 'Nenhum bloqueio', 'Folgas, feriados e pausas aparecem aqui.');

  $$('[data-unlock]', box).forEach((x) => {
    x.onclick = async () => {
      try {
        await api(`/api/admin/bloqueios/${x.dataset.unlock}`, { method: 'DELETE' });
        toast('Horário liberado.', 'ok');
        carregarBloq();
      } catch (e) { toast(e.message, 'erro'); }
    };
  });
}

async function criarBloqueio() {
  const data = $('#bloqData').value;
  const ini = $('#bloqIni').value;
  const fim = $('#bloqFim').value;
  if (!data) return toast('Escolha a data do bloqueio.', 'erro');
  if (Boolean(ini) !== Boolean(fim)) return toast('Preencha início e fim, ou deixe os dois vazios para o dia todo.', 'erro');
  if (ini && fim && ini >= fim) return toast('O horário final deve ser depois do inicial.', 'erro');

  const btn = $('#btnBloquear');
  btn.disabled = true;
  try {
    await api('/api/admin/bloqueios', {
      method: 'POST',
      body: JSON.stringify({ data, hora_inicio: ini || null, hora_fim: fim || null, motivo: $('#bloqMotivo').value.trim() }),
    });
    $('#bloqMotivo').value = '';
    $('#bloqIni').value = '';
    $('#bloqFim').value = '';
    toast('Bloqueio criado. A agenda do cliente já reflete a mudança.', 'ok');
    carregarBloq();
  } catch (e) {
    toast(e.message, 'erro');
  } finally {
    btn.disabled = false;
  }
}

/* Arranque: com token válido abre direto; sem token, permanece no login. */
boot();


