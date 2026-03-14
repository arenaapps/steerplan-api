/**
 * Seed script: indexes knowledge base markdown files into the embeddings table.
 *
 * Usage: npx tsx src/scripts/seed-knowledge-base.ts
 */
import { indexKnowledgeBase } from '../lib/knowledge-base.js';

async function main() {
  console.log('Seeding knowledge base...');
  await indexKnowledgeBase();
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to seed knowledge base:', err);
  process.exit(1);
});
