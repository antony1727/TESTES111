// Lógica da área do cliente: carrega serviços/profissionais, controla o wizard e cria o agendamento.
const $ = (s) => document.querySelector(s);
const state = { servico: null, profissional: null, data: null, hora: null, whatsapp: '', ultimoAg: null };

const BRL = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function erro(msg) {
  const el = $('#msgErro');
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false; el.textContent = msg;
}

function irPara(etapa) {
  document.querySelectorAll('[data-etapa]').forEach((d) => { d.hidden = d.dataset.etapa != String(etapa); });
  document.querySelectorAll('#barraPassos .passo').forEach((p, i) => p.classList.toggle('on', i < etapa));
  erro(null);
  document.querySelector('#agendar .card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function api(path, opts) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erro || 'Falha na requisição.');
  return data;
}

function marcarSelecionado(container, id) {
  container.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.id == String(id)));
}

async function init() {
  // WhatsApp da barbearia (config pública)
  try { state.whatsapp = (await api('/api/config')).whatsapp || ''; } catch {}

  // Serviços (vitrine + etapa 1)
  const servicos = await api('/api/servicos');
  $('#listaServicos').innerHTML = servicos.map((s) => `
    <div class="card"><h3>${s.nome}</h3>
      <div class="meta">${s.descricao || ''} • ~${s.duracao_min}min</div>
      <div class="preco">${BRL(s.preco_centavos)}</div>
      <button class="btn gold" data-agendar="${s.id}">Agendar este</button>
    </div>`).join('') || '<div class="card">Nenhum serviço ativo.</div>';

  $('#etapaServicos').innerHTML = servicos.map((s) => `
    <div class="card" data-id="${s.id}" style="cursor:pointer">
      <h3>${s.nome}</h3><div class="meta">~${s.duracao_min}min</div>
      <div class="preco">${BRL(s.preco_centavos)}</div>
    </div>`).join('');

  document.querySelectorAll('[data-agendar]').forEach((b) =>
    b.onclick = () => {
      state.servico = servicos.find((s) => s.id == b.dataset.agendar);
      marcarSelecionado($('#etapaServicos'), state.servico.id);
      carregarProfs().then(() => irPara(2));
    });

  $('#etapaServicos').onclick = (e) => {
    const card = e.target.closest('.card'); if (!card) return;
    state.servico = servicos.find((s) => s.id == card.dataset.id);
    marcarSelecionado($('#etapaServicos'), state.servico.id);
    setTimeout(async () => { await carregarProfs(); irPara(2); }, 150);
  };

  // Data mínima = hoje
  $('#campoData').min = new Date().toISOString().slice(0, 10);
  $('#campoData').onchange = carregarHoras;

  document.querySelectorAll('[data-voltar]').forEach((b) =>
    b.onclick = () => {
      const atual = Number(document.querySelector('[data-etapa]:not([hidden])').dataset.etapa);
      irPara(Math.max(1, atual - 1));
    });

  $('#btnConfirmar').onclick = confirmar;
  $('#btnNovo').onclick = () => location.reload();
  $('#btnIcs').onclick = baixarIcs;
}

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

async function carregarHoras() {
  state.data = $('#campoData').value; state.hora = null;
  const box = $('#listaHoras');
  if (!state.data) { box.innerHTML = '<span class="meta">Escolha uma data.</span>'; return; }
  box.innerHTML = '<span class="meta">Buscando horários…</span>';
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

async function confirmar() {
  const nome = $('#cliNome').value.trim();
  const fone = $('#cliFone').value.trim();
  const email = $('#cliEmail').value.trim();
  if (!nome || !fone) return erro('Informe nome e telefone/WhatsApp.');
  $('#btnConfirmar').disabled = true;
  try {
    const ag = await api('/api/agendamentos', { method: 'POST', body: JSON.stringify({
      servico_id: state.servico.id, profissional_id: state.profissional.id,
      data: state.data, hora: state.hora, cliente_nome: nome, cliente_telefone: fone, cliente_email: email,
    })});
    state.ultimoAg = ag;
    const dataBR = ag.data.split('-').reverse().join('/');
    $('#confirmBox').textContent = `Agendado para ${dataBR} às ${ag.hora} com ${ag.profissional_nome}.`;
    $('#resumoFinal').innerHTML =
      `<b>${ag.servico_nome}</b> • ${BRL(ag.preco_centavos)} • ~${ag.duracao_min}min<br>` +
      `Cliente: ${ag.cliente_nome} (${ag.cliente_telefone})`;
    const texto = encodeURIComponent(`Olá! Agendei ${ag.servico_nome} dia ${dataBR} às ${ag.hora} com ${ag.profissional_nome}. Nome: ${ag.cliente_nome}`);
    $('#btnWhats').href = state.whatsapp
      ? `https://wa.me/${state.whatsapp}?text=${texto}`
      : `https://wa.me/?text=${texto}`;
    irPara(5);
  } catch (e) { erro(e.message); } finally { $('#btnConfirmar').disabled = false; }
}

// Gera um .ics para "salvar no calendário" (Google/Apple/Outlook).
function baixarIcs() {
  const ag = state.ultimoAg; if (!ag) return;
  const dt = ag.data.replaceAll('-', '') + 'T' + ag.hora.replace(':', '') + '00';
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
    `DTSTART:${dt}`, `SUMMARY:Barbearia — ${ag.servico_nome}`,
    `DESCRIPTION:Com ${ag.profissional_nome}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'agendamento-barbearia.ics'; a.click();
}

init().catch((e) => { $('#listaServicos').innerHTML = `<div class="card">${e.message}</div>`; });
