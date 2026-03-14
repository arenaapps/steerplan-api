import { searchEmbeddings, type ContentType } from './embeddings.js';
import { supabase } from './supabase.js';

/** Retrieve relevant context via vector search for a user's chat message */
export async function retrieveContext(
  userId: string,
  message: string,
): Promise<string> {
  try {
    // Run personal + knowledge base + credit data searches in parallel
    const [personalResults, knowledgeResults, creditData] = await Promise.all([
      searchEmbeddings({
        userId,
        query: message,
        contentTypes: ['transaction', 'income', 'outgoing', 'budget'],
        limit: 25,
        threshold: 0.5,
      }),
      searchEmbeddings({
        userId: '__global__',
        query: message,
        contentTypes: ['knowledge_base'],
        limit: 5,
        threshold: 0.55,
      }),
      Promise.resolve(
        supabase
          .from('credit_scores')
          .select('fhi_score, fhi_flags, income_grade, bureau_score, disposable_income, total_income, total_expenditure, source, scored_at')
          .eq('user_id', userId)
          .order('scored_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ).then((r) => r.data).catch(() => null),
    ]);

    if (personalResults.length === 0 && knowledgeResults.length === 0 && !creditData) {
      return '';
    }

    // Group personal results by content type
    const grouped: Record<string, string[]> = {};
    for (const r of personalResults) {
      if (!grouped[r.content_type]) grouped[r.content_type] = [];
      grouped[r.content_type].push(r.content);
    }

    const sections: string[] = [];

    if (grouped.transaction?.length) {
      sections.push(`### Relevant Transactions\n${grouped.transaction.join('\n')}`);
    }
    if (grouped.income?.length) {
      sections.push(`### Relevant Income\n${grouped.income.join('\n')}`);
    }
    if (grouped.outgoing?.length) {
      sections.push(`### Relevant Outgoings\n${grouped.outgoing.join('\n')}`);
    }
    if (grouped.budget?.length) {
      sections.push(`### Relevant Budgets\n${grouped.budget.join('\n')}`);
    }
    if (knowledgeResults.length > 0) {
      sections.push(`### Financial Knowledge\n${knowledgeResults.map((r) => r.content).join('\n\n')}`);
    }
    if (creditData) {
      const parts: string[] = [];
      if (creditData.fhi_score) parts.push(`FHI Score: ${creditData.fhi_score}/9`);
      if (creditData.income_grade) parts.push(`Income Grade: ${creditData.income_grade}`);
      if (creditData.bureau_score) parts.push(`Bureau Score: ${creditData.bureau_score}`);
      if (creditData.total_income) parts.push(`Monthly Income (Equifax): £${creditData.total_income}`);
      if (creditData.total_expenditure) parts.push(`Monthly Expenditure (Equifax): £${creditData.total_expenditure}`);
      if (creditData.disposable_income) parts.push(`Disposable Income: £${creditData.disposable_income}`);
      const flags = creditData.fhi_flags || [];
      if (Array.isArray(flags) && flags.length > 0) {
        parts.push(`Risk Flags: ${flags.map((f: any) => `${f.flag} (${f.level})`).join(', ')}`);
      }
      if (parts.length > 0) {
        sections.push(`### Credit Health\n${parts.join(' | ')}`);
      }
    }

    return sections.join('\n\n');
  } catch (err: any) {
    console.error(`[rag] retrieveContext failed: ${err.message}`);
    return '';
  }
}
