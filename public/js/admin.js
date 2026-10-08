// Painel admin: login JWT, resumo do dia, agenda com filtros/status e configurações.
const $ = (s) => document.querySelector(s);
const BRL = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const token = () => localStorage.getItem('bb_token');

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}), ...opts.headers },
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(); throw new Error('Sessão expirada. Faça login.'); }
  if (!r.ok) throw new Error(data.erro || 'Falha na requisição.');
  return data;
}

function logout() { localStorage.removeItem('bb_token'); location.reload(); }

// ---- Login ----
$('#btnLogin').onclick = async () => {
  const box = $('#loginErro'); box.hidden = true;
  try {
    const r = await api('/api/auth/login', { method: 'POST',
      body: JSON.stringify({ email: $('#loginEmail').value, senha: $('#loginSenha').value }) });
    localStorage.setItem('bb_token', r.token);
    boot();
  } catch (e) { box.hidden = false; box.textContent = e.message; }
};
$('#btnSair').onclick = logout;

async function boot() {
  if (!token()) return;
  $('#telaLogin').hidden = true; $('#painel').hidden = false; $('#btnSair').hidden = false;
  $('#filtroData').value = new Date().toISOString().slice(0, 10);
  $('#hojeLbl').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  $('#btnRecarregar').onclick = carregarTudo;
  $('#filtroData').onchange = carregarTudo;
  $('#filtroStatus').onchange = carregarTudo;
  $('#btnSalvarFunc').onclick = salvarFunc;
  $('#btnBloquear').onclick = criarBloqueio;
  await carregarTudo();
}

async function carregarTudo() {
  const data = $('#filtroData').value;
  const resumo = await api(`/api/admin/resumo?data=${data}`);
  $('#kpiTotal').textContent = resumo.total;
  $('#kpiFat').textContent = BRL(resumo.faturamento_centavos);
  $('#kpiProx').textContent = resumo.proximos[0] ? `${resumo.proximos[0].hora} · ${resumo.proximos[0].cliente_nome.split(' ')[0]}` : '—';

  const st = $('#filtroStatus').value;
  const lista = await api(`/api/admin/agendamentos?data=${data}${st ? '&status=' + st : ''}`);
  $('#corpoAgenda').innerHTML = lista.map((a) => `
    <tr><td><b>${a.hora}</b></td>
      <td>${a.cliente_nome}<br><span class="meta">${a.cliente_telefone}</span></td>
      <td>${a.servico_nome}<br><span class="meta">${BRL(a.preco_centavos)}</span></td>
      <td>${a.profissional_nome}</td>
      <td><span class="badge b-${a.status}">${a.status}</span></td>
      <td><div class="linha">
        ${a.status !== 'concluido' ? `<button class="btn small" data-ok="${a.id}">✓</button>` : ''}
        ${a.status === 'confirmado' ? `<button class="btn small" data-canc="${a.id}">✕</button>` : ''}
        <button class="btn small ghost" data-del="${a.id}">excluir</button>
      </div></td></tr>`).join('') || '<tr><td colspan="6" class="meta">Nenhum agendamento.</td></tr>';

  document.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => mudaStatus(b.dataset.ok, 'concluido'));
  document.querySelectorAll('[data-canc]').forEach((b) => b.onclick = () => mudaStatus(b.dataset.canc, 'cancelado'));
  document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Excluir este agendamento?')) return;
    await api(`/api/admin/agendamentos/${b.dataset.del}`, { method: 'DELETE' });
    carregarTudo();
  });

  await carregarFunc(); await carregarBloq();
}

async function mudaStatus(id, status) {
  await api(`/api/admin/agendamentos/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  carregarTudo();
}

// ---- Expediente ----
async function carregarFunc() {
  const dias = await api('/api/admin/funcionamento');
  $('#gradeFunc').innerHTML = dias.map((d) => `
    <div class="dia" data-dia="${d.dia_semana}">
      <b>${DIAS[d.dia_semana]}</b>
      <label><input type="checkbox" data-f="aberto" ${d.aberto ? 'checked' : ''} style="width:auto"> aberto</label>
      <input type="time" data-f="abertura" value="${d.abertura}" />
      <input type="time" data-f="fechamento" value="${d.fechamento}" />
      <input type="text" data-f="almoco" value="${d.almoco_inicio || ''}-${d.almoco_fim || ''}" placeholder="12:00-13:00 (almoço)" />
    </div>`).join('');
}

async function salvarFunc() {
  const dias = [...document.querySelectorAll('#gradeFunc .dia')].map((el) => {
    const g = (f) => el.querySelector(`[data-f="${f}"]`).value;
    const alm = (g('almoco') || '').split('-');
    return {
      dia_semana: Number(el.dataset.dia),
      aberto: el.querySelector('[data-f="aberto"]').checked ? 1 : 0,
      abertura: g('abertura') || '09:00', fechamento: g('fechamento') || '19:00',
      almoco_inicio: (alm[0] || '').trim() || null, almoco_fim: (alm[1] || '').trim() || null,
    };
  });
  await api('/api/admin/funcionamento', { method: 'PUT', body: JSON.stringify({ dias }) });
  alert('Expediente salvo!');
}

// ---- Bloqueios ----
async function carregarBloq() {
  const lista = await api('/api/admin/bloqueios');
  $('#listaBloq').innerHTML = lista.map((b) =>
    `<div>📅 ${b.data} ${b.hora_inicio ? `${b.hora_inicio}–${b.hora_fim}` : '(dia todo)'} — ${b.motivo || 'sem motivo'} <button class="btn small ghost" data-unlock="${b.id}">liberar</button></div>`
  ).join('') || 'Nenhum bloqueio.';
  document.querySelectorAll('[data-unlock]').forEach((x) => x.onclick = async () => {
    await api(`/api/admin/bloqueios/${x.dataset.unlock}`, { method: 'DELETE' }); carregarBloq();
  });
}

async function criarBloqueio() {
  const data = $('#bloqData').value;
  if (!data) return alert('Escolha a data.');
  await api('/api/admin/bloqueios', { method: 'POST', body: JSON.stringify({
    data, hora_inicio: $('#bloqIni').value || null, hora_fim: $('#bloqFim').value || null, motivo: $('#bloqMotivo').value,
  })});
  $('#bloqMotivo').value = ''; carregarBloq();
}

boot();
