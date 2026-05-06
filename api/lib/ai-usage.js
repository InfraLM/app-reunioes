const prisma = require('../../lib/prisma.cjs');
const logger = require('./logger');

// Preços por modelo em USD por 1M tokens.
// Mantidos aqui pra não depender de lookup externo. Atualizar quando modelo novo
// for adicionado ou preços mudarem (https://www.anthropic.com/pricing).
const PRICING = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cache_write_5m: 3.75, cache_read: 0.3 },
  'claude-opus-4-7':   { input: 15.0, output: 75.0, cache_write_5m: 18.75, cache_read: 1.5 },
  'claude-haiku-4-5':  { input: 1.0, output: 5.0, cache_write_5m: 1.25, cache_read: 0.1 },
};

const DEFAULT_PRICING = PRICING['claude-sonnet-4-6'];

function calcCostUsd(model, usage) {
  const p = PRICING[model] || DEFAULT_PRICING;
  const input = Number(usage?.input_tokens || 0);
  const output = Number(usage?.output_tokens || 0);
  const cacheCreate = Number(usage?.cache_creation_input_tokens || 0);
  const cacheRead = Number(usage?.cache_read_input_tokens || 0);
  return (
    (input * p.input + output * p.output + cacheCreate * p.cache_write_5m + cacheRead * p.cache_read) / 1_000_000
  );
}

/**
 * Grava uma chamada à API de IA no banco pra alimentar /api/stats/ai-usage.
 * Não faz throw — falha de tracking não deve derrubar o caller.
 *
 * @param {object} data
 * @param {string} data.endpoint       ex: 'generate-ata'
 * @param {string} data.model          ex: 'claude-sonnet-4-6'
 * @param {object} data.usage          { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
 * @param {string} [data.conference_id]
 * @param {'success'|'error'} [data.status]
 * @param {string} [data.error_message]
 */
async function recordAiUsage({
  endpoint,
  model,
  usage = {},
  conference_id = null,
  status = 'success',
  error_message = null,
}) {
  try {
    const cost_usd = calcCostUsd(model, usage);
    await prisma.eppAiUsage.create({
      data: {
        conference_id: conference_id || null,
        endpoint: String(endpoint).slice(0, 50),
        model: String(model).slice(0, 60),
        input_tokens: Number(usage?.input_tokens || 0),
        output_tokens: Number(usage?.output_tokens || 0),
        cache_creation_tokens: Number(usage?.cache_creation_input_tokens || 0),
        cache_read_tokens: Number(usage?.cache_read_input_tokens || 0),
        cost_usd,
        status,
        error_message: error_message ? String(error_message).slice(0, 2000) : null,
      },
    });
  } catch (err) {
    logger.warn(`[ai-usage] falha ao gravar tracking: ${err.message}`);
  }
}

module.exports = { recordAiUsage, calcCostUsd, PRICING };
