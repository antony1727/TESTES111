/**
 * booking.js — LÓGICA DA ÁREA DO CLIENTE (wizard de 4 passos + confirmação).
 * ----------------------------------------------------------------------------
 *  1. Utilidades ......... $, $$, BRL, datas, esc, máscara de telefone
 *  2. Estado ............. escolhas do cliente + agendamento criado
 *  3. init() ............. carrega configuração, barbeiros e serviços
 *  4. irPara() ........... troca de etapa, stepper e resumo vivo
 *  5. Passo 3 ............ semana inteira + turnos
 *  6. Passo 4 ............ ticket, prévia do WhatsApp e POST
 *  7. Extras ............. .ics, modal "Meus cortes"/"Perfil", WhatsApp
 */

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const BRL = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const state = {
  etapa: 1,
  servicos: [],
  profissionais: [],
  servico: null,
  profissional: null,
  semanaInicio: null,
  diasSemana: [],
  data: null,
  hora: null,
  whatsapp: '',
  ultimoAg: null,
  _semanaTs: 0,
};

/* ---------------- datas ---------------- */
const DIAS_CURTOS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
function dataISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const hojeISO = () => dataISO(new Date());
function somarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dataISO(d);
}
function segundaDaSemana(iso) {
  const d = new Date(iso + 'T12:00:00');
  const dw = d.getDay();
  d.setDate(d.getDate() + (dw === 0 ? -6 : 1 - dw));
  return dataISO(d);
}
const dataBR = (iso) => String(iso || '').split('-').reverse().join('/');
function dataCurta(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
}
function dataLonga(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}
const iniciais = (nome) => String(nome || '?').trim().split(/\s+/).slice(0, 2)
  .map((p) => p[0]).join('').toUpperCase();

/* ---------------- API ---------------- */
async function api(path, opts) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erro || 'Falha na requisição.');
  return data;
}

function erro(msg) {
  const el = $('#msgErro');
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = msg;
}
function toast(msg, tipo = 'ok') {
  const el = $('#toast');
  if (!el) return;
  el.className = 'toast ' + tipo;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 6000);
}

/* ---------------- navegação do wizard ---------------- */
function irPara(etapa) {
  state.etapa = etapa;
  $$('[data-etapa]').forEach((d) => { d.hidden = d.dataset.etapa !== String(etapa); });

  const ativo = Math.min(etapa, 4);
  $$('.step-bar').forEach((b, i) => b.classList.toggle('on', i < ativo));
  $$('.step-label').forEach((b, i) => b.classList.toggle('on', i < ativo));
  $('#stepCounter').textContent = etapa >= 5 ? 'Concluído' : `Passo ${etapa} de 4`;

  $$('.nav-item').forEach((n) => {
    n.classList.toggle('active', etapa === 2 ? n.dataset.path === 'servicos' : n.dataset.path === 'agendar');
  });

  if (etapa === 4) { renderTicket(); renderPreview(); }
  if (etapa === 3 && Date.now() - state._semanaTs > 2000) carregarSemana().catch(() => {});

  atualizarResumo();
  erro(null);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function atualizarResumo() {
  const preco = state.servico ? state.servico.preco_centavos : 0;
  $('#pillPrice').textContent = BRL(preco);
  let texto;
  if (state.etapa === 1) {
    texto = state.profissional ? `Profissional: ${state.profissional.nome}` : 'Escolha o profissional de sua preferência';
  } else if (state.etapa === 2) {
    texto = state.servico ? `${state.servico.nome} • ${state.servico.duracao_min} min` : 'Escolha o serviço desejado';
  } else if (state.etapa === 3) {
    texto = state.data
      ? `${dataBR(state.data)}${state.hora ? ' às ' + state.hora : ' • escolha o horário'}`
      : 'Escolha o dia e o horário';
  } else if (state.etapa === 4) {
    texto = state.data ? `${dataBR(state.data)} às ${state.hora} • ${state.servico?.nome || ''}` : 'Revise e confirme';
  } else {
    texto = 'Agendamento confirmado — até breve!';
  }
  $('#pillText').textContent = texto;
}

async function prepararSemana() {
  if (!state.profissional || !state.servico) return;
  await carregarSemana();
}

/* ---------------- init ---------------- */
async function init() {
  try { state.whatsapp = (await api('/api/config')).whatsapp || ''; } catch { /* opcional */ }

  const [servicos, profs] = await Promise.all([api('/api/servicos'), api('/api/profissionais')]);
  state.servicos = servicos;
  state.profissionais = profs;
  renderProfs();
  renderServicos();
  $('#contadorProfs').textContent = `${profs.length} ${profs.length === 1 ? 'mestre' : 'mestres'}`;

  $('#semanaAnterior').onclick = () => mudarSemana(-7);
  $('#semanaProxima').onclick = () => mudarSemana(7);
  $$('[data-ir]').forEach((b) => { b.onclick = () => irPara(Number(b.dataset.ir)); });

  $('#btnConfirmar').onclick = confirmar;
  $('#btnNovo').onclick = () => location.reload();
  $('#btnIcs').onclick = baixarIcs;

  $('#btnTopoNotif').onclick = () => irPara(state.etapa);
  $('#btnTopoPerfil').onclick = () => abrirSheet('perfil');
  $('#sheetFechar').onclick = fecharSheet;
  $('#sheet').onclick = (e) => { if (e.target === $('#sheet')) fecharSheet(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharSheet(); });

  $$('.nav-item').forEach((n) => { n.onclick = () => navCliente(n.dataset.path); });

  const fone = $('#cliFone');
  fone.addEventListener('input', () => { fone.value = mascaraFone(fone.value); renderPreview(); });
  ['#cliNome', '#cliEmail', '#cliObs'].forEach((sel) => $(sel).addEventListener('input', renderPreview));

  preencherDadosSalvos();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.etapa === 3 && state.profissional && state.servico) {
      carregarSemana().catch(() => {});
    }
  });

  atualizarResumo();
  renderPreview();
}

function preencherDadosSalvos() {
  try {
    const c = JSON.parse(localStorage.getItem('bc_cliente') || 'null');
    if (!c) return;
    if (c.nome) $('#cliNome').value = c.nome;
    if (c.fone) $('#cliFone').value = c.fone;
  } catch { /* dado local inválido: ignora */ }
}

function mascaraFone(v) {
  const d = String(v).replace(/\D/g, '').slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/* ---------------- passo 1: barbeiros ---------------- */
function renderProfs() {
  const box = $('#etapaProfs');
  if (!state.profissionais.length) {
    box.innerHTML = `<div class="empty"><span class="material-symbols-outlined">person_off</span><b>Nenhum profissional ativo</b><span>Tente novamente em instantes.</span></div>`;
    return;
  }
  box.innerHTML = state.profissionais.map((p) => {
    const sel = state.profissional && String(state.profissional.id) === String(p.id);
    return `
    <button type="button" class="barber-card${sel ? ' is-selected' : ''}" data-id="${p.id}">
      <span class="verified">
        <span class="avatar">${iniciais(p.nome)}</span>
        <span class="vbadge"><span class="material-symbols-outlined">verified</span></span>
      </span>
      <span class="barber-main">
        <span class="barber-name">
          <h3>${esc(p.nome)}</h3>
          ${p.apelido ? `<span class="badge badge-primary">${esc(p.apelido)}</span>` : ''}
        </span>
        <span class="barber-role">Atendimento com hora marcada • Barber Code</span>
        <span class="barber-foot"><span class="dot"></span> Escolher este profissional</span>
      </span>
    </button>`;
  }).join('');

  $$('.barber-card', box).forEach((card) => {
    card.onclick = async () => {
      state.profissional = state.profissionais.find((p) => String(p.id) === card.dataset.id);
      $$('.barber-card', box).forEach((c) => c.classList.toggle('is-selected', c === card));
      atualizarResumo();
      setTimeout(async () => {
        if (state.servico) {
          await prepararSemana();
          irPara(3);
        } else {
          irPara(2);
        }
      }, 220);
    };
  });
}

/* ---------------- passo 2: serviços ---------------- */
function renderServicos() {
  const box = $('#etapaServicos');
  if (!state.servicos.length) {
    box.innerHTML = `<div class="empty"><span class="material-symbols-outlined">content_cut</span><b>Nenhum serviço ativo</b><span>Tente novamente em instantes.</span></div>`;
    return;
  }
  box.innerHTML = state.servicos.map((s) => {
    const sel = state.servico && String(state.servico.id) === String(s.id);
    const combo = /combo/i.test(s.nome);
    return `
    <button type="button" class="service-card${sel ? ' is-selected' : ''}" data-id="${s.id}">
      <span class="service-main">
        <span class="service-top">
          ${combo ? '<span class="tag">Mais pedido</span>' : ''}
          <span class="duration"><span class="material-symbols-outlined">schedule</span>${s.duracao_min} min</span>
        </span>
        <h3>${esc(s.nome)}</h3>
        <span class="service-desc">${esc(s.descricao || 'Cuidado profissional para o seu visual.')}</span>
      </span>
      <span class="service-side">
        <span class="service-price">${BRL(s.preco_centavos)}</span>
        <span class="check-circle"><span class="material-symbols-outlined">${sel ? 'check' : 'add'}</span></span>
      </span>
    </button>`;
  }).join('');

  $$('.service-card', box).forEach((card) => {
    card.onclick = async () => {
      state.servico = state.servicos.find((s) => String(s.id) === card.dataset.id);
      $$('.service-card', box).forEach((c) => {
        const ativo = c === card;
        c.classList.toggle('is-selected', ativo);
        const icone = c.querySelector('.check-circle .material-symbols-outlined');
        if (icone) icone.textContent = ativo ? 'check' : 'add';
      });
      atualizarResumo();
      setTimeout(async () => {
        if (state.profissional) {
          await prepararSemana();
          irPara(3);
        } else {
          irPara(1);
        }
      }, 220);
    };
  });
}

/* ============================================================================
   PASSO 3 — SEMANA INTEIRA + TURNOS
   ============================================================================ */
async function carregarSemana() {
  if (!state.profissional || !state.servico) return;
  if (!state.semanaInicio) state.semanaInicio = segundaDaSemana(hojeISO());
  const box = $('#semanaDias');
  box.innerHTML = `<div class="empty" style="grid-column:1/-1"><span class="material-symbols-outlined">hourglass_top</span><span>Carregando dias…</span></div>`;
  try {
    const r = await api('/api/disponibilidade-semana?data_inicio=' + state.semanaInicio +
      '&profissional_id=' + state.profissional.id +
      '&servico_id=' + state.servico.id);
    state.diasSemana = r.dias;
    state._semanaTs = Date.now();
    renderSemana();
  } catch (e) {
    box.innerHTML = `<div class="empty" style="grid-column:1/-1"><span class="material-symbols-outlined">error</span><span>${esc(e.message)}</span></div>`;
  }
}

function renderSemana() {
  const dias = state.diasSemana || [];
  if (!dias.length) return;
  const hoje = hojeISO();
  $('#semanaVazia')?.remove();

  $('#semanaTitulo').textContent = `Semana de ${dataCurta(dias[0].data)} a ${dataCurta(dias[6].data)}`;
  $('#semanaAnterior').disabled = dias[0].data <= segundaDaSemana(hoje);

  const box = $('#semanaDias');
  box.innerHTML = dias.map((d) => {
    const passou = d.data < hoje;
    const lotado = Number(d.total) === 0;
    const fechado = !d.aberto;
    const sel = state.data === d.data;
    const rotulo = passou ? '—' : fechado ? 'fechado' : lotado ? 'lotado' : `${d.total} vaga${Number(d.total) === 1 ? '' : 's'}`;
    const classes = ['day-chip', passou && 'is-past', fechado && 'is-closed', lotado && 'is-full',
      sel && 'is-selected', d.data === hoje && 'is-today'].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-data="${d.data}"
      ${passou || fechado || lotado ? 'disabled' : ''}
      aria-label="${dataLonga(d.data)}: ${rotulo}">
      <span class="wd">${DIAS_CURTOS[d.dia_semana]}</span>
      <span class="dn">${Number(d.data.slice(8, 10))}</span>
      <span class="dv">${rotulo}</span>
    </button>`;
  }).join('');

  $$('#semanaDias .day-chip:not([disabled])').forEach((b) => {
    b.onclick = () => escolherDia(b.dataset.data);
  });

  if (!dias.some((d) => d.data >= hoje && Number(d.total) > 0)) {
    box.insertAdjacentHTML('afterend',
      '<div class="hint" id="semanaVazia" style="margin-top:8px">Nenhum dia com vaga nesta semana — use → para ver a próxima.</div>');
  }
}

function escolherDia(data) {
  state.data = data;
  state.hora = null;
  $$('.day-chip').forEach((b) => b.classList.toggle('is-selected', b.dataset.data === data && !b.disabled));
  const dia = (state.diasSemana || []).find((d) => d.data === data);
  renderHoras(dia ? dia.horarios : []);
  atualizarResumo();
}

function renderHoras(horarios) {
  const box = $('#listaHoras');
  if (!state.data) {
    box.innerHTML = `<div class="empty"><span class="material-symbols-outlined">touch_app</span><b>Escolha um dia acima</b><span>Os horários livres aparecem aqui, separados por turno.</span></div>`;
    return;
  }
  if (!horarios.length) {
    box.innerHTML = `<div class="empty"><span class="material-symbols-outlined">event_busy</span><b>Sem horários neste dia</b><span>Escolha outro dia ou navegue para a próxima semana.</span></div>`;
    return;
  }

  const grupos = [
    { label: 'Manhã • até 12h', icone: 'wb_sunny', itens: horarios.filter((h) => h < '12:00') },
    { label: 'Tarde • 12h às 18h', icone: 'light_mode', itens: horarios.filter((h) => h >= '12:00' && h < '18:00') },
    { label: 'Noite • após 18h', icone: 'dark_mode', itens: horarios.filter((h) => h >= '18:00') },
  ].filter((g) => g.itens.length);

  box.innerHTML = `<div class="shifts">` + grupos.map((g) => `
    <div class="shift">
      <span class="shift-head"><span class="material-symbols-outlined">${g.icone}</span>${g.label}</span>
      <div class="slots">
        ${g.itens.map((h) => `<button type="button" class="slot" data-h="${h}">${h}</button>`).join('')}
      </div>
    </div>`).join('') + `</div>`;

  $$('.slot', box).forEach((b) => { b.onclick = () => escolherHora(b); });
}

function escolherHora(btn) {
  state.hora = btn.dataset.h;
  $$('.slot').forEach((b) => b.classList.toggle('is-selected', b === btn));
  atualizarResumo();
  setTimeout(() => irPara(4), 200);
}

function mudarSemana(delta) {
  const atual = state.semanaInicio || segundaDaSemana(hojeISO());
  const destino = somarDias(atual, delta);
  if (destino < segundaDaSemana(hojeISO())) return;
  state.semanaInicio = destino;
  state.data = null;
  state.hora = null;
  $('#listaHoras').innerHTML = `<div class="empty"><span class="material-symbols-outlined">touch_app</span><b>Escolha um dia acima</b><span>Os horários livres aparecem aqui.</span></div>`;
  carregarSemana();
}

/* ============================================================================
   PASSO 4 — TICKET, PRÉVIA E CONFIRMAÇÃO
   ============================================================================ */
function somarMin(hora, min) {
  const [h, m] = String(hora).split(':').map(Number);
  const t = h * 60 + m + Number(min || 0);
  return String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

function renderTicket() {
  $('#recBarbeiro').textContent = state.profissional ? state.profissional.nome : '—';
  $('#recData').textContent = state.data
    ? `${dataBR(state.data)} às ${state.hora || '--:--'}`
    : '—';
  $('#recServico').textContent = state.servico ? state.servico.nome : '—';
  $('#recDuracao').textContent = state.servico ? `${state.servico.duracao_min} min` : '—';
  $('#recTotal').textContent = BRL(state.servico ? state.servico.preco_centavos : 0);
}

/** Mensagem formatada (prévia e envio final). */
function mensagemWhats(ag) {
  const nome = ag ? ag.cliente_nome : ($('#cliNome').value.trim() || 'Seu nome');
  const fone = ag ? ag.cliente_telefone : ($('#cliFone').value.trim() || 'não informado');
  const barbeiro = ag ? ag.profissional_nome : (state.profissional ? state.profissional.nome : '—');
  const servico = ag ? ag.servico_nome : (state.servico ? state.servico.nome : '—');
  const duracao = ag ? ag.duracao_min : (state.servico ? state.servico.duracao_min : '—');
  const data = ag ? ag.data : state.data;
  const hora = ag ? ag.hora : state.hora;
  const preco = ag ? ag.preco_centavos : (state.servico ? state.servico.preco_centavos : 0);
  const obs = $('#cliObs').value.trim();

  return `💈 *AGENDAMENTO — BARBER CODE*\n` +
    `👤 *Cliente:* ${nome}\n` +
    `📱 *WhatsApp:* ${fone}\n` +
    `✂️ *Profissional:* ${barbeiro}\n` +
    `⭐ *Serviço:* ${servico} (${duracao} min)\n` +
    `🗓️ *Data:* ${dataBR(data)} às ${hora}\n` +
    `💰 *Valor:* ${BRL(preco)}` +
    (obs ? `\n📝 *Obs:* ${obs}` : '') +
    `\n\n_Por favor, confirmem minha reserva._`;
}

function renderPreview() {
  const nome = $('#cliNome').value.trim() || 'Seu nome';
  const fone = $('#cliFone').value.trim() || 'não informado';
  const obs = $('#cliObs').value.trim();
  $('#waBody').innerHTML = `
    <div>💈 <span class="k">Barbeiro:</span> ${esc(state.profissional ? state.profissional.nome : '—')}</div>
    <div>✂️ <span class="k">Serviço:</span> ${esc(state.servico ? state.servico.nome : '—')} (${state.servico ? state.servico.duracao_min : '—'} min)</div>
    <div>🗓️ <span class="k">Data:</span> ${state.data ? `${dataBR(state.data)} às ${state.hora || '--:--'}` : '—'}</div>
    <div>👤 <span class="k">Cliente:</span> ${esc(nome)}</div>
    <div>📱 <span class="k">WhatsApp:</span> ${esc(fone)}</div>
    ${obs ? `<div>📝 <span class="k">Obs:</span> ${esc(obs)}</div>` : ''}
    <div>💰 <span class="k">Total:</span> ${BRL(state.servico ? state.servico.preco_centavos : 0)}</div>`;
}

/** Link wa.me com o número oficial (ou wa.me genérico se não configurado). */
function linkWhats(texto) {
  const numero = String(state.whatsapp || '').replace(/\D/g, '');
  return (numero ? `https://wa.me/${numero}` : 'https://wa.me/') + '?text=' + encodeURIComponent(texto);
}

async function confirmar() {
  erro(null);
  const nome = $('#cliNome').value.trim();
  const fone = $('#cliFone').value.trim();
  const email = $('#cliEmail').value.trim();
  const digits = fone.replace(/\D/g, '');

  if (nome.length < 2) return erro('Informe seu nome completo.');
  if (digits.length < 10) return erro('Informe um WhatsApp válido com DDD.');
  if (!state.servico || !state.profissional || !state.data || !state.hora) {
    return erro('Volte e escolha barbeiro, serviço, data e horário.');
  }

  const btn = $('#btnConfirmar');
  const conteudo = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined">progress_activity</span> Confirmando…';

  // Abre a aba do WhatsApp ANTES do await para não ser bloqueada como pop-up.
  let win = null;
  try { win = window.open('', '_blank'); } catch { /* bloqueado: usamos o botão do passo 5 */ }

  try {
    const ag = await api('/api/agendamentos', {
      method: 'POST',
      body: JSON.stringify({
        servico_id: state.servico.id,
        profissional_id: state.profissional.id,
        data: state.data,
        hora: state.hora,
        cliente_nome: nome,
        cliente_telefone: fone,
        cliente_email: email,
      }),
    });

    state.ultimoAg = ag;
    try {
      localStorage.setItem('bc_ultimo_ag', JSON.stringify(ag));
      localStorage.setItem('bc_cliente', JSON.stringify({ nome, fone }));
    } catch { /* modo privado: segue sem salvar */ }

    const url = linkWhats(mensagemWhats(ag));
    $('#confirmBox').textContent = `Agendado para ${dataBR(ag.data)} às ${ag.hora} com ${ag.profissional_nome}.`;
    $('#resumoFinal').innerHTML =
      `<b>${esc(ag.servico_nome)}</b><br>` +
      `<span class="muted">${BRL(ag.preco_centavos)} • ${ag.duracao_min} min • ${esc(ag.cliente_nome)}</span>`;
    $('#btnWhats').href = url;

    if (win) win.location.href = url;
    else toast('Reserva criada! Use o botão do WhatsApp para avisar o atelier.', 'ok');

    irPara(5);
  } catch (e) {
    if (win) { try { win.close(); } catch { /* ignora */ } }
    erro(e.message);
    // 409 = outra pessoa pegou o horário: recarrega a semana e volta ao passo 3.
    if (/indispon|ocupad/i.test(e.message)) {
      state.semanaInicio = segundaDaSemana(state.data);
      await carregarSemana();
      irPara(3);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = conteudo;
  }
}

/* ---------------- .ics (Google Agenda / Apple / Outlook) ---------------- */
function baixarIcs() {
  const ag = state.ultimoAg;
  if (!ag) return toast('Nenhum agendamento recente para salvar.', 'erro');
  const inicio = ag.data.replaceAll('-', '') + 'T' + String(ag.hora).replace(':', '') + '00';
  const fim = ag.data.replaceAll('-', '') + 'T' + somarMin(ag.hora, ag.duracao_min).replace(':', '') + '00';
  const agora = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber Code//Agenda//PT-BR',
    'BEGIN:VEVENT', `UID:ag-${ag.id}@barbercode`, `DTSTAMP:${agora}`,
    `DTSTART:${inicio}`, `DTEND:${fim}`,
    `SUMMARY:Barber Code — ${ag.servico_nome}`,
    `DESCRIPTION:Com ${ag.profissional_nome}`,
    'LOCATION:Barber Code', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'agendamento-barbercode.ics';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Arquivo .ics gerado.', 'ok');
}

/* ---------------- modal: Meus cortes / Perfil ---------------- */
function navCliente(path) {
  if (path === 'agendar') irPara(state.etapa >= 1 && state.etapa <= 4 ? state.etapa : 1);
  else if (path === 'servicos') irPara(2);
  else if (path === 'meus-cortes') abrirSheet('cortes');
  else if (path === 'perfil') abrirSheet('perfil');
}

function abrirSheet(tipo) {
  const corpo = $('#sheetCorpo');
  if (tipo === 'cortes') {
    $('#sheetTitulo').textContent = 'Meus cortes';
    let ag = null;
    try { ag = JSON.parse(localStorage.getItem('bc_ultimo_ag') || 'null'); } catch { /* ignora */ }

    if (!ag) {
      corpo.innerHTML = `
        <div class="empty"><span class="material-symbols-outlined">content_cut</span>
          <b>Nenhum agendamento neste aparelho</b>
          <span>Quando você reservar, os detalhes ficam salvos aqui.</span>
        </div>
        <button class="btn btn-primary btn-block" type="button" id="sheetAgendar">
          <span class="material-symbols-outlined">calendar_month</span> Agendar agora
        </button>`;
      $('#sheetAgendar').onclick = () => { fecharSheet(); irPara(1); };
    } else {
      state.ultimoAg = ag;
      corpo.innerHTML = `
        <div class="ticket">
          <div class="ticket-head">
            <span class="ticket-brand"><span class="material-symbols-outlined">workspace_premium</span> Última reserva</span>
            <span class="badge badge-green">Confirmada</span>
          </div>
          <div class="ticket-grid">
            <div class="ticket-cell"><span>Barbeiro</span><b>${esc(ag.profissional_nome)}</b></div>
            <div class="ticket-cell"><span>Data &amp; horário</span><b class="gold">${dataBR(ag.data)} às ${ag.hora}</b></div>
            <div class="ticket-cell" style="grid-column:1/-1"><span>Serviço</span><b>${esc(ag.servico_nome)}</b></div>
          </div>
          <div class="ticket-total"><span>Total</span><b>${BRL(ag.preco_centavos)}</b></div>
        </div>
        <a class="btn btn-whats btn-block" href="${linkWhats(mensagemWhats(ag))}" target="_blank" rel="noopener">
          <span class="material-symbols-outlined">chat</span> Falar no WhatsApp
        </a>
        <button class="btn btn-outline btn-block" type="button" id="sheetIcs">
          <span class="material-symbols-outlined">calendar_add_on</span> Salvar no calendário
        </button>`;
      $('#sheetIcs').onclick = baixarIcs;
    }
  } else {
    $('#sheetTitulo').textContent = 'Seu perfil';
    let cliente = null;
    try { cliente = JSON.parse(localStorage.getItem('bc_cliente') || 'null'); } catch { /* ignora */ }
    const numero = String(state.whatsapp || '').replace(/\D/g, '');
    const link = numero
      ? `https://wa.me/${numero}?text=${encodeURIComponent('Olá, Barber Code! Gostaria de falar sobre meu atendimento.')}`
      : '';
    corpo.innerHTML = `
      <div class="card-low card">
        <span class="eyebrow">Dados salvos neste aparelho</span>
        <p style="margin-top:6px"><b>${esc(cliente?.nome || 'Nenhum nome salvo')}</b><br>
        <span class="muted">${esc(cliente?.fone || 'Nenhum WhatsApp salvo')}</span></p>
      </div>
      <p>Seus dados são usados apenas para preencher o formulário e não são exibidos publicamente.</p>
      ${link ? `<a class="btn btn-whats btn-block" href="${link}" target="_blank" rel="noopener">
        <span class="material-symbols-outlined">chat</span> Falar com o atelier
      </a>` : `<div class="alert alert-error">WhatsApp do atelier não configurado. Fale pelo contato habitual.</div>`}
      <button class="btn btn-ghost btn-block" type="button" id="sheetLimpar">
        <span class="material-symbols-outlined">delete</span> Limpar dados salvos
      </button>
      <a class="btn btn-outline btn-block" href="/admin"><span class="material-symbols-outlined">badge</span> Área do barbeiro</a>`;
    $('#sheetLimpar').onclick = () => {
      localStorage.removeItem('bc_cliente');
      localStorage.removeItem('bc_ultimo_ag');
      $('#cliNome').value = '';
      $('#cliFone').value = '';
      state.ultimoAg = null;
      renderPreview();
      toast('Dados removidos deste aparelho.', 'ok');
      fecharSheet();
    };
  }
  $('#sheet').hidden = false;
}

function fecharSheet() {
  $('#sheet').hidden = true;
  $$('.nav-item').forEach((n) => {
    n.classList.toggle('active', state.etapa === 2 ? n.dataset.path === 'servicos' : n.dataset.path === 'agendar');
  });
}

/* ---------------- arranque ---------------- */
init().catch((e) => {
  $('#etapaProfs').innerHTML = `<div class="empty"><span class="material-symbols-outlined">error</span><b>Falha ao carregar</b><span>${esc(e.message)}</span></div>`;
  $('#etapaServicos').innerHTML = `<div class="empty"><span class="material-symbols-outlined">error</span><b>Falha ao carregar</b><span>${esc(e.message)}</span></div>`;
  toast('Não foi possível carregar os serviços. Recarregue a página.', 'erro');
});


