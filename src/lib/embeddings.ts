import { openai } from './openai.js';
import { supabase } from './supabase.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 100;

export type ContentType = 'transaction' | 'income' | 'outgoing' | 'budget' | 'knowledge_base';

export interface EmbeddingRecord {
  userId: string;
  contentType: ContentType;
  sourceId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/** Generate a 1536-dim embedding for a single text string */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

/** Generate embeddings for multiple texts in a single API call */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    for (const item of response.data) {
      results.push(item.embedding);
    }
  }
  return results;
}

/** Upsert a single embedding record */
export async function upsertEmbedding(record: EmbeddingRecord): Promise<void> {
  const embedding = await generateEmbedding(record.content);

  const { error } = await supabase
    .from('embeddings')
    .upsert(
      {
        user_id: record.userId,
        content_type: record.contentType,
        source_id: record.sourceId,
        content: record.content,
        embedding: JSON.stringify(embedding),
        metadata: record.metadata || {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,source_id' }
    );

  if (error) throw new Error(`Failed to upsert embedding: ${error.message}`);
}

/** Batch upsert multiple embedding records */
export async function upsertEmbeddings(records: EmbeddingRecord[]): Promise<void> {
  if (records.length === 0) return;

  const texts = records.map((r) => r.content);
  const embeddings = await generateEmbeddings(texts);

  const rows = records.map((record, i) => ({
    user_id: record.userId,
    content_type: record.contentType,
    source_id: record.sourceId,
    content: record.content,
    embedding: JSON.stringify(embeddings[i]),
    metadata: record.metadata || {},
    updated_at: new Date().toISOString(),
  }));

  // Upsert in chunks to avoid payload size limits
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('embeddings')
      .upsert(chunk, { onConflict: 'user_id,source_id' });

    if (error) throw new Error(`Failed to batch upsert embeddings: ${error.message}`);
  }
}

/** Delete all embeddings for a user + optional source_id prefix */
export async function deleteEmbeddings(userId: string, sourceIdPrefix?: string): Promise<void> {
  let query = supabase.from('embeddings').delete().eq('user_id', userId);

  if (sourceIdPrefix) {
    query = query.like('source_id', `${sourceIdPrefix}%`);
  }

  const { error } = await query;
  if (error) throw new Error(`Failed to delete embeddings: ${error.message}`);
}

/** Search embeddings by similarity */
export async function searchEmbeddings(params: {
  userId: string;
  query: string;
  contentTypes?: ContentType[];
  limit?: number;
  threshold?: number;
}): Promise<Array<{
  id: string;
  content_type: ContentType;
  source_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}>> {
  const queryEmbedding = await generateEmbedding(params.query);

  const { data, error } = await supabase.rpc('match_embeddings', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_user_id: params.userId,
    match_content_types: params.contentTypes || null,
    match_limit: params.limit || 25,
    match_threshold: params.threshold || 0.5,
  });

  if (error) throw new Error(`Embedding search failed: ${error.message}`);
  return data || [];
}
