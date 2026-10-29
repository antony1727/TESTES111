/**
 * lib/eventos.js — Barramento de eventos em memória (pub/sub simples).
 * ----------------------------------------------------------------------------
 * PROBLEMA QUE RESOLVE: quando o cliente finaliza um agendamento no site, o
 * painel do barbeiro precisa saber NA HORA, sem ele apertar "Atualizar".
 *
 * COMO FUNCIONA:
 *  • Quem cria o agendamento (routes/public.js) faz `emissor.emit('novo', ag)`.
 *  • Quem está com o painel aberto (routes/admin.js /eventos) escuta
 *    `emissor.on('novo', ...)` e empurra o dado via SSE (Server-Sent Events)
 *    para o navegador do barbeiro.
 *
 * LIMITAÇÃO CONHECIDA: é em memória. Se rodar com vários processos/instâncias
 * (ex.: cluster), cada processo tem seu próprio barramento. Para esse caso,
 * troque por Redis Pub/Sub — a interface `emit/on/off` continua a mesma.
 */
const { EventEmitter } = require('events');

// Um único emissor compartilhado por todo o backend (singleton).
const emissor = new EventEmitter();
// Evita o aviso de "memory leak" quando muitas abas do painel ficam abertas.
emissor.setMaxListeners(200);

module.exports = emissor;
