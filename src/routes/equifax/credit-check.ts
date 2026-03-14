import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { encryptPayload } from '../../lib/encryption.js';
import { creditQuotation, type CreditQuotationInput } from '../../lib/equifax-gateway.js';

export async function equifaxCreditCheckRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;

    try {
      const body = request.body as {
        firstName: string;
        surname: string;
        dateOfBirth: string;
        houseNumber: string;
        street: string;
        postcode: string;
        grossAnnualIncome?: number;
        sortCode?: string;
        accountNumber?: string;
      };

      // Validate required PII fields
      if (!body.firstName || !body.surname || !body.dateOfBirth || !body.houseNumber || !body.street || !body.postcode) {
        return reply.code(400).send({
          error: 'Missing required fields: firstName, surname, dateOfBirth, houseNumber, street, postcode',
        });
      }

      // Call Gateway soft search
      const result = await creditQuotation(body as CreditQuotationInput);

      // Encrypt and store full response
      const encPayload = await encryptPayload(result);
      await supabase.from('credit_insights').insert({
        user_id: userId,
        insight_type: 'credit_report',
        payload_enc: encPayload,
      });

      // Extract bureau score into credit_scores table
      if (result.bureauScore != null) {
        await supabase.from('credit_scores').insert({
          user_id: userId,
          bureau_score: result.bureauScore,
          source: 'gateway',
        });
      }

      return reply.send({
        bureauScore: result.bureauScore,
        creditAccounts: result.creditAccounts.length,
        ccjs: result.ccjs.length,
        electoralRoll: result.electoralRoll.length,
        searches: result.searches.length,
        characteristics: result.characteristics,
      });
    } catch (error: any) {
      request.log.error(`Equifax credit check failed: ${error.message}`);
      return reply.code(500).send({ error: error?.message || 'Credit check failed' });
    }
  });
}
