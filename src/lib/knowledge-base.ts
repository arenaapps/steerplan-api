import { readdir, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { upsertEmbeddings, type EmbeddingRecord } from './embeddings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KNOWLEDGE_DIR = join(__dirname, '..', 'data', 'knowledge');

/** Load and index all knowledge base markdown files */
export async function indexKnowledgeBase(): Promise<void> {
  const files = await readdir(KNOWLEDGE_DIR);
  const mdFiles = files.filter((f) => f.endsWith('.md'));

  const records: EmbeddingRecord[] = [];

  for (const file of mdFiles) {
    const content = await readFile(join(KNOWLEDGE_DIR, file), 'utf-8');
    const topic = basename(file, '.md');

    // Split into chunks if content is long (>1500 chars)
    const chunks = splitIntoChunks(content, 1500);

    for (let i = 0; i < chunks.length; i++) {
      records.push({
        userId: '__global__',
        contentType: 'knowledge_base',
        sourceId: `kb:${topic}:${i}`,
        content: chunks[i],
        metadata: { topic, file, chunkIndex: i },
      });
    }
  }

  if (records.length > 0) {
    await upsertEmbeddings(records);
    console.log(`[knowledge-base] Indexed ${records.length} chunks from ${mdFiles.length} files`);
  }
}

function splitIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? '\n\n' : '') + para;
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
