import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload } from '../../lib/encryption.js';

const TX_COLUMNS = 'id, date, amount, currency, direction, description, merchant, category, "accountId", "isRecurring", "affectsPlan", "affectsPlanReason", tags';

const fetchRows = async (table: string, userId: string) => {
  const { data, error } = await supabase
    .from(table)
    .select('id,payload_enc')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return data || [];
};

const decryptRows = async <T>(rows: { payload_enc: string | null }[]) => {
  const decrypted = await Promise.all(
    rows.map((row) => decryptPayload<T>(row.payload_enc))
  );
  return decrypted.filter(Boolean) as T[];
};

const fetchTransactions = async (userId: string) => {
  const { data, error } = await supabase
    .from('transactions')
    .select(TX_COLUMNS)
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => ({ ...row, tags: row.tags ?? [] }));
};

export async function stateRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [
        metricsRows,
        obligationsRows,
        incomeRows,
        outgoingsRows,
        accountsRows,
        transactions,
        timelineRows,
        profitLossRows,
      ] = await Promise.all([
        fetchRows('cash_flow_metrics', request.userId),
        fetchRows('obligations', request.userId),
        fetchRows('income_sources', request.userId),
        fetchRows('outgoings_outline', request.userId),
        fetchRows('bank_accounts', request.userId),
        fetchTransactions(request.userId),
        fetchRows('projection_timeline', request.userId),
        fetchRows('profit_loss_data', request.userId),
      ]);

      const [metrics, obligations, income, outgoingsRaw, accounts, timeline, profitLoss] =
        await Promise.all([
          decryptRows(metricsRows),
          decryptRows(obligationsRows),
          decryptRows(incomeRows),
          decryptRows(outgoingsRows),
          decryptRows(accountsRows),
          decryptRows(timelineRows),
          decryptRows(profitLossRows),
        ]);

      const outgoings = outgoingsRaw
        .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
        .map((row: any) => {
          const { position, ...rest } = row || {};
          return rest;
        });

      return reply.send({
        metrics,
        obligations,
        income,
        outgoings,
        accounts,
        transactions,
        timeline,
        profitLoss,
      });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load state' });
    }
  });
}
