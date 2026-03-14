import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

export async function giphyRoutes(app: FastifyInstance) {
  app.get('/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const { q } = request.query as { q?: string };
    if (!q) {
      return reply.code(400).send({ error: 'Missing query parameter "q"' });
    }

    try {
      const url = `https://api.giphy.com/v1/gifs/search?api_key=${config.giphy.apiKey}&q=${encodeURIComponent(q)}&limit=1&rating=g`;
      const res = await fetch(url);
      const json = await res.json();

      const gif = json.data?.[0];
      if (!gif) {
        return reply.send({ url: null });
      }

      const img = gif.images?.fixed_width;
      return reply.send({
        url: img?.url ?? null,
        width: img?.width ? Number(img.width) : null,
        height: img?.height ? Number(img.height) : null,
      });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Giphy request failed' });
    }
  });
}
