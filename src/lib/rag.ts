import { searchEmbeddings, type ContentType } from './embeddings.js';

/** Retrieve relevant context via vector search for a user's chat message */
export async function retrieveContext(
  userId: string,
  message: string,
): Promise<string> {
  try {
    // Run personal + knowledge base searches in parallel
    const [personalResults, knowledgeResults] = await Promise.all([
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
    ]);

    if (personalResults.length === 0 && knowledgeResults.length === 0) {
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

    return sections.join('\n\n');
  } catch (err: any) {
    console.error(`[rag] retrieveContext failed: ${err.message}`);
    return '';
  }
}
