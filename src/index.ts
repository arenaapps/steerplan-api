import Fastify from 'fastify';
import { config } from './config.js';
import multipart from '@fastify/multipart';
import { corsPlugin } from './plugins/cors.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';

// Route imports — webhooks (no auth)
import { clerkWebhookRoutes } from './routes/webhooks/clerk.js';

// Route imports — authenticated
import { profileRoutes } from './routes/profile.js';
import { accountRoutes } from './routes/account.js';
import { transactionsRoutes } from './routes/data/transactions.js';
import { bankAccountsRoutes } from './routes/data/bank-accounts.js';
import { incomeSourcesRoutes } from './routes/data/income-sources.js';
import { outgoingsRoutes } from './routes/data/outgoings.js';
import { conversationsRoutes } from './routes/data/conversations.js';
import { conversationRoutes } from './routes/data/conversation.js';
import { messagesRoutes } from './routes/data/messages.js';
import { budgetsRoutes } from './routes/data/budgets.js';
import { obligationsRoutes } from './routes/data/obligations.js';
import { potsRoutes } from './routes/data/pots.js';
import { csvUploadsRoutes } from './routes/data/csv-uploads.js';
import { cashFlowMetricsRoutes } from './routes/data/cash-flow-metrics.js';
import { profitLossRoutes } from './routes/data/profit-loss.js';
import { stateRoutes } from './routes/data/state.js';
import { timelineRoutes } from './routes/data/timeline.js';
import { merchantRulesRoutes } from './routes/data/merchant-rules.js';
import { chatRoutes } from './routes/ai/chat.js';
import { confirmRoutes } from './routes/ai/confirm.js';
import { categoriseRoutes } from './routes/ai/categorise.js';
import { classifyIncomeRoutes } from './routes/ai/classify-income.js';
import { briefingRoutes } from './routes/ai/briefing.js';
import { transcribeRoutes } from './routes/ai/transcribe.js';
import { ttsRoutes } from './routes/ai/tts.js';
import { yapilyInstitutionsRoutes } from './routes/yapily/institutions.js';
import { yapilyConsentRoutes } from './routes/yapily/consent.js';
import { yapilySyncRoutes } from './routes/yapily/sync.js';
import { yapilyDisconnectRoutes } from './routes/yapily/disconnect.js';
import { plaidLinkTokenRoutes } from './routes/plaid/link-token.js';
import { plaidExchangeRoutes } from './routes/plaid/exchange.js';
import { plaidSyncRoutes } from './routes/plaid/sync.js';
import { plaidDisconnectRoutes } from './routes/plaid/disconnect.js';
import { plaidBankIncomeRoutes } from './routes/plaid/bank-income.js';
import { plaidIncomeLinkTokenRoutes } from './routes/plaid/income-link-token.js';
import { finexerProvidersRoutes } from './routes/finexer/providers.js';
import { finexerConsentRoutes } from './routes/finexer/consent.js';
import { finexerSyncRoutes } from './routes/finexer/sync.js';
import { finexerDisconnectRoutes } from './routes/finexer/disconnect.js';
import { giphyRoutes } from './routes/giphy.js';

// Workers
import { startEmailWorker } from './queues/workers/email.worker.js';
import { startSyncWorker } from './queues/workers/sync.worker.js';
import { startScoreWorker } from './queues/workers/score.worker.js';

const app = Fastify({ logger: true });

// ── Global plugins ──
await app.register(corsPlugin);
await app.register(errorHandlerPlugin);
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

// ── Health check (no auth) ──
app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// ── All /api routes ──
await app.register(async function apiRoutes(api) {
  // Webhook routes (no auth — registered BEFORE auth scope)
  await api.register(clerkWebhookRoutes, { prefix: '/webhooks' });

  // Auth + rate limiting (all routes below require auth)
  await api.register(async function authedRoutes(authed) {
    await authed.register(authPlugin);
    await authed.register(rateLimitPlugin);

    // Profile & Account
    await authed.register(profileRoutes, { prefix: '/profile' });
    await authed.register(accountRoutes, { prefix: '/account' });

    // Data routes
    await authed.register(transactionsRoutes, { prefix: '/data/transactions' });
    await authed.register(bankAccountsRoutes, { prefix: '/data/bank-accounts' });
    await authed.register(incomeSourcesRoutes, { prefix: '/data/income-sources' });
    await authed.register(outgoingsRoutes, { prefix: '/data/outgoings' });
    await authed.register(conversationsRoutes, { prefix: '/data/conversations' });
    await authed.register(conversationRoutes, { prefix: '/data/conversations' });
    await authed.register(messagesRoutes, { prefix: '/data/conversations' });
    await authed.register(budgetsRoutes, { prefix: '/data/budgets' });
    await authed.register(obligationsRoutes, { prefix: '/data/obligations' });
    await authed.register(potsRoutes, { prefix: '/data/pots' });
    await authed.register(csvUploadsRoutes, { prefix: '/data/csv-uploads' });
    await authed.register(cashFlowMetricsRoutes, { prefix: '/data/cash-flow-metrics' });
    await authed.register(profitLossRoutes, { prefix: '/data/profit-loss' });
    await authed.register(stateRoutes, { prefix: '/data/state' });
    await authed.register(timelineRoutes, { prefix: '/data/timeline' });
    await authed.register(merchantRulesRoutes, { prefix: '/data/merchant-rules' });

    // AI routes
    await authed.register(chatRoutes, { prefix: '/ai/chat' });
    await authed.register(confirmRoutes, { prefix: '/ai/chat/confirm' });
    await authed.register(categoriseRoutes, { prefix: '/ai/categorise' });
    await authed.register(classifyIncomeRoutes, { prefix: '/ai/classify-income' });
    await authed.register(briefingRoutes, { prefix: '/ai/briefing' });
    await authed.register(transcribeRoutes, { prefix: '/ai/transcribe' });
    await authed.register(ttsRoutes, { prefix: '/ai/tts' });

    // Yapily routes
    await authed.register(yapilyInstitutionsRoutes, { prefix: '/yapily/institutions' });
    await authed.register(yapilyConsentRoutes, { prefix: '/yapily/consent' });
    await authed.register(yapilySyncRoutes, { prefix: '/yapily/sync' });
    await authed.register(yapilyDisconnectRoutes, { prefix: '/yapily/disconnect' });

    // Plaid routes
    await authed.register(plaidLinkTokenRoutes, { prefix: '/plaid/link-token' });
    await authed.register(plaidExchangeRoutes, { prefix: '/plaid/exchange' });
    await authed.register(plaidSyncRoutes, { prefix: '/plaid/sync' });
    await authed.register(plaidDisconnectRoutes, { prefix: '/plaid/disconnect' });
    await authed.register(plaidBankIncomeRoutes, { prefix: '/plaid/bank-income' });
    await authed.register(plaidIncomeLinkTokenRoutes, { prefix: '/plaid/income-link-token' });

    // Finexer routes
    await authed.register(finexerProvidersRoutes, { prefix: '/finexer/providers' });
    await authed.register(finexerConsentRoutes, { prefix: '/finexer/consent' });
    await authed.register(finexerSyncRoutes, { prefix: '/finexer/sync' });
    await authed.register(finexerDisconnectRoutes, { prefix: '/finexer/disconnect' });

    // Giphy proxy
    await authed.register(giphyRoutes, { prefix: '/giphy' });
  });
}, { prefix: '/api' });

// ── Start workers ──
startEmailWorker();
startSyncWorker();
startScoreWorker();

// ── Start server ──
try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Steerplan API listening on port ${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
