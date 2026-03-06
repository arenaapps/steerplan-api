import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';

const TX_COLUMNS = 'id, date, amount, currency, direction, description, merchant, category, "accountId", "isRecurring", "affectsPlan", "affectsPlanReason", tags';

export async function transactionsRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;
    const query = request.query as Record<string, string | undefined>;
    const accountId = query.accountId;
    const search = query.search?.toLowerCase();
    const limit = parseInt(query.limit || '0', 10);
    const offset = parseInt(query.offset || '0', 10);

    try {
      let countQuery = supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      let dataQuery = supabase
        .from('transactions')
        .select(TX_COLUMNS)
        .eq('user_id', userId)
        .order('date', { ascending: false });

      if (accountId) {
        countQuery = countQuery.eq('accountId', accountId);
        dataQuery = dataQuery.eq('accountId', accountId);
      }

      if (search) {
        const searchFilter = `description.ilike.%${search}%,merchant.ilike.%${search}%,category.ilike.%${search}%`;
        countQuery = countQuery.or(searchFilter);
        dataQuery = dataQuery.or(searchFilter);
      }

      if (limit > 0) {
        dataQuery = dataQuery.range(offset, offset + limit - 1);
      }

      const [{ count, error: countError }, { data, error: dataError }] =
        await Promise.all([countQuery, dataQuery]);

      if (countError) throw countError;
      if (dataError) throw dataError;

      const rows = (data || []).map((row: any) => ({ ...row, tags: row.tags ?? [] }));
      return reply.send({ transactions: rows, total: count || 0 });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load transactions' });
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;
    try {
      const transactions = request.body as Array<Record<string, any>>;
      const rows = (transactions || []).map((tx) => ({
        id: tx.id,
        user_id: userId,
        date: tx.date || null,
        amount: tx.amount ?? null,
        currency: tx.currency || null,
        direction: tx.direction || null,
        description: tx.description || null,
        merchant: tx.merchant || null,
        category: tx.category || null,
        accountId: tx.accountId || null,
        isRecurring: tx.isRecurring ?? null,
        affectsPlan: tx.affectsPlan ?? null,
        affectsPlanReason: tx.affectsPlanReason || null,
        tags: tx.tags || null,
      }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('transactions')
          .upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to save transactions' });
    }
  });
}
