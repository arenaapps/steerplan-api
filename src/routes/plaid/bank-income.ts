import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plaidClient } from '../../lib/plaid.js';
import { supabase } from '../../lib/supabase.js';
import { encryptPayload, decryptPayload } from '../../lib/encryption.js';

interface IncomeSource {
  id: string;
  label: string;
  amount: string;
  date: string;
  status: 'paid' | 'pending';
  frequency?: 'day' | 'week' | 'month';
  source?: 'manual' | 'bank';
  plaidIncomeSourceId?: string;
  incomeCategory?: string;
  paidWeeks?: string[];
  paidMonths?: string[];
}

function mapFrequency(plaidFrequency?: string): 'day' | 'week' | 'month' {
  switch (plaidFrequency) {
    case 'DAILY':
      return 'day';
    case 'WEEKLY':
    case 'BIWEEKLY':
      return 'week';
    case 'MONTHLY':
    case 'SEMI_MONTHLY':
    default:
      return 'month';
  }
}

function formatCategory(cat?: string): string {
  if (!cat) return 'Income';
  // Convert SALARY -> Salary, GIG_ECONOMY -> Gig Economy, etc.
  return cat
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export async function plaidBankIncomeRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get plaid_user_id
      const { data: tokenRow } = await supabase
        .from('plaid_user_tokens')
        .select('plaid_user_id')
        .eq('clerk_user_id', request.userId)
        .single();

      if (!tokenRow?.plaid_user_id) {
        return reply.code(400).send({ error: 'No Plaid user found. Connect a bank first.' });
      }

      // Fetch bank income from Plaid using user_id (cast needed — SDK types lag behind API)
      const incomeResponse = await plaidClient.creditBankIncomeGet({
        user_id: tokenRow.plaid_user_id,
      } as any);

      const bankIncomeReports = incomeResponse.data.bank_income;
      const incomeSources: IncomeSource[] = [];

      if (bankIncomeReports) {
        for (const report of bankIncomeReports) {
          for (const item of report.items ?? []) {
            for (const source of item.bank_income_sources ?? []) {
              const totalAmount = source.total_amount ?? 0;
              const startDate = source.start_date;
              const endDate = source.end_date;

              // Calculate per-period average
              let periodAmount = Math.abs(totalAmount);
              if (startDate && endDate) {
                const start = new Date(startDate);
                const end = new Date(endDate);
                const daysDiff = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
                const freq = mapFrequency(source.pay_frequency);
                if (freq === 'month') {
                  const months = Math.max(1, daysDiff / 30);
                  periodAmount = Math.abs(totalAmount) / months;
                } else if (freq === 'week') {
                  const weeks = Math.max(1, daysDiff / 7);
                  periodAmount = Math.abs(totalAmount) / weeks;
                } else {
                  periodAmount = Math.abs(totalAmount) / daysDiff;
                }
              }

              incomeSources.push({
                id: `plaid-inc-${source.income_source_id ?? Date.now()}`,
                label: source.income_description || formatCategory(source.income_category),
                amount: periodAmount.toFixed(2),
                date: new Date().toISOString().split('T')[0],
                status: 'pending',
                frequency: mapFrequency(source.pay_frequency),
                source: 'bank',
                plaidIncomeSourceId: source.income_source_id,
                incomeCategory: formatCategory(source.income_category),
                paidWeeks: [],
                paidMonths: [],
              });
            }
          }
        }
      }

      // Fetch existing income sources, keep manual ones, replace bank ones
      const { data: existingRows } = await supabase
        .from('income_sources')
        .select('payload_enc')
        .eq('user_id', request.userId);

      const existingIncomes = await Promise.all(
        (existingRows || []).map((row) => decryptPayload<IncomeSource>(row.payload_enc))
      );

      const manualIncomes = existingIncomes.filter(
        (item): item is IncomeSource => item !== null && item.source !== 'bank'
      );

      const merged = [...manualIncomes, ...incomeSources];

      // Save merged array
      await supabase.from('income_sources').delete().eq('user_id', request.userId);
      if (merged.length > 0) {
        const rows = await Promise.all(
          merged.map(async (item) => ({
            id: item.id,
            user_id: request.userId,
            payload_enc: await encryptPayload(item),
          }))
        );
        const { error } = await supabase.from('income_sources').insert(rows);
        if (error) throw error;
      }

      return reply.send(merged);
    } catch (error: any) {
      const plaidError = error?.response?.data;
      request.log.error(plaidError ?? error, 'Plaid bank-income error');
      return reply.code(500).send({
        error: plaidError?.error_message ?? error?.message ?? 'Failed to fetch bank income',
      });
    }
  });
}
