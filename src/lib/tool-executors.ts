import { plaidClient } from './plaid.js';
import { supabase } from './supabase.js';
import { decryptPayload } from './encryption.js';
import {
  PaymentAmountCurrency,
  PaymentInitiationPaymentCreateRequest,
  PaymentInitiationRecipientCreateRequest,
  PaymentScheduleInterval,
} from 'plaid';

interface PlaidAccountPayload {
  account_id: string;
  name: string;
  official_name?: string;
  type: string;
  subtype?: string;
  mask?: string;
  balances: {
    available?: number | null;
    current?: number | null;
    iso_currency_code?: string | null;
  };
}

// ── Auto-execute tool handlers ──

export async function executeGetUserAccounts(userId: string) {
  const { data: bankAccounts, error } = await supabase
    .from('bank_accounts')
    .select('id, name, provider, last_four, payload_enc')
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to fetch accounts: ${error.message}`);

  const accounts = [];
  for (const ba of bankAccounts || []) {
    const payload = await decryptPayload<PlaidAccountPayload[]>(ba.payload_enc);
    if (payload && Array.isArray(payload)) {
      for (const acc of payload) {
        accounts.push({
          id: acc.account_id,
          name: acc.name || ba.name,
          type: acc.type,
          mask: acc.mask || ba.last_four,
          balance_available: acc.balances?.available,
          balance_current: acc.balances?.current,
          currency: acc.balances?.iso_currency_code || 'GBP',
        });
      }
    }
  }
  return { accounts };
}

export async function executeGetAccountBalance(userId: string, input: { account_id: string }) {
  const { data: bankAccounts } = await supabase
    .from('bank_accounts')
    .select('payload_enc')
    .eq('user_id', userId);

  for (const ba of bankAccounts || []) {
    const payload = await decryptPayload<PlaidAccountPayload[]>(ba.payload_enc);
    if (payload && Array.isArray(payload)) {
      const account = payload.find((a) => a.account_id === input.account_id);
      if (account) {
        return {
          account_id: account.account_id,
          name: account.name,
          balance_available: account.balances?.available,
          balance_current: account.balances?.current,
          currency: account.balances?.iso_currency_code || 'GBP',
        };
      }
    }
  }
  return { error: 'Account not found' };
}

export async function executeGetPayees(userId: string) {
  const { data, error } = await supabase
    .from('payment_recipients')
    .select('id, name, sort_code, account_number, iban')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch payees: ${error.message}`);
  return { payees: data || [] };
}

// ── Confirmation tool handlers (called after user confirms) ──

export async function executeCreatePayment(
  userId: string,
  input: {
    recipient_name: string;
    sort_code?: string;
    account_number?: string;
    amount: number;
    reference: string;
    source_account_id?: string;
  },
) {
  // 1. Find or create Plaid recipient
  let recipientId: string;

  const { data: existing } = await supabase
    .from('payment_recipients')
    .select('id, plaid_recipient_id')
    .eq('user_id', userId)
    .ilike('name', input.recipient_name)
    .maybeSingle();

  if (existing?.plaid_recipient_id) {
    recipientId = existing.plaid_recipient_id;
  } else {
    if (!input.sort_code || !input.account_number) {
      throw new Error('Sort code and account number are required for new payees.');
    }

    const recipientRequest: PaymentInitiationRecipientCreateRequest = {
      name: input.recipient_name,
      bacs: {
        sort_code: input.sort_code,
        account: input.account_number,
      },
    };

    const recipientResponse = await plaidClient.paymentInitiationRecipientCreate(recipientRequest);
    recipientId = recipientResponse.data.recipient_id;

    // Upsert recipient in our DB
    await supabase.from('payment_recipients').upsert(
      {
        id: existing?.id ?? undefined,
        user_id: userId,
        name: input.recipient_name,
        sort_code: input.sort_code,
        account_number: input.account_number,
        plaid_recipient_id: recipientId,
      },
      { onConflict: 'id' },
    );
  }

  // 2. Create payment via Plaid
  const paymentRequest: PaymentInitiationPaymentCreateRequest = {
    recipient_id: recipientId,
    reference: input.reference,
    amount: {
      currency: PaymentAmountCurrency.Gbp,
      value: input.amount,
    },
  };

  const paymentResponse = await plaidClient.paymentInitiationPaymentCreate(paymentRequest);
  const plaidPaymentId = paymentResponse.data.payment_id;

  // 3. Record in our payments table
  const { data: recipientRow } = await supabase
    .from('payment_recipients')
    .select('id')
    .eq('user_id', userId)
    .eq('plaid_recipient_id', recipientId)
    .maybeSingle();

  await supabase.from('payments').insert({
    user_id: userId,
    recipient_id: recipientRow?.id,
    amount: input.amount,
    currency: 'GBP',
    reference: input.reference,
    type: 'one_off',
    status: 'initiated',
    plaid_payment_id: plaidPaymentId,
    source_account_id: input.source_account_id,
  });

  return {
    success: true,
    payment_id: plaidPaymentId,
    amount: input.amount,
    currency: 'GBP',
    recipient: input.recipient_name,
    reference: input.reference,
  };
}

export async function executeCreateStandingOrder(
  userId: string,
  input: {
    recipient_name: string;
    sort_code?: string;
    account_number?: string;
    amount: number;
    reference: string;
    frequency: 'WEEKLY' | 'MONTHLY';
    start_date: string;
    source_account_id?: string;
  },
) {
  // 1. Find or create Plaid recipient (same as one-off)
  let recipientId: string;

  const { data: existing } = await supabase
    .from('payment_recipients')
    .select('id, plaid_recipient_id')
    .eq('user_id', userId)
    .ilike('name', input.recipient_name)
    .maybeSingle();

  if (existing?.plaid_recipient_id) {
    recipientId = existing.plaid_recipient_id;
  } else {
    if (!input.sort_code || !input.account_number) {
      throw new Error('Sort code and account number are required for new payees.');
    }

    const recipientRequest: PaymentInitiationRecipientCreateRequest = {
      name: input.recipient_name,
      bacs: {
        sort_code: input.sort_code,
        account: input.account_number,
      },
    };

    const recipientResponse = await plaidClient.paymentInitiationRecipientCreate(recipientRequest);
    recipientId = recipientResponse.data.recipient_id;

    await supabase.from('payment_recipients').upsert(
      {
        id: existing?.id ?? undefined,
        user_id: userId,
        name: input.recipient_name,
        sort_code: input.sort_code,
        account_number: input.account_number,
        plaid_recipient_id: recipientId,
      },
      { onConflict: 'id' },
    );
  }

  // 2. Create standing order via Plaid
  const scheduleInterval = input.frequency === 'WEEKLY'
    ? PaymentScheduleInterval.Weekly
    : PaymentScheduleInterval.Monthly;

  const schedule = {
    frequency: input.frequency,
    interval: 1,
    start_date: input.start_date,
  };

  const executionDay = input.frequency === 'MONTHLY'
    ? parseInt(input.start_date.split('-')[2], 10)
    : undefined;

  const paymentRequest: PaymentInitiationPaymentCreateRequest = {
    recipient_id: recipientId,
    reference: input.reference,
    amount: {
      currency: PaymentAmountCurrency.Gbp,
      value: input.amount,
    },
    schedule: {
      interval: scheduleInterval,
      interval_execution_day: executionDay ?? 1,
      start_date: input.start_date,
    },
  };

  const paymentResponse = await plaidClient.paymentInitiationPaymentCreate(paymentRequest);
  const plaidPaymentId = paymentResponse.data.payment_id;

  // 3. Record in payments table
  const { data: recipientRow } = await supabase
    .from('payment_recipients')
    .select('id')
    .eq('user_id', userId)
    .eq('plaid_recipient_id', recipientId)
    .maybeSingle();

  await supabase.from('payments').insert({
    user_id: userId,
    recipient_id: recipientRow?.id,
    amount: input.amount,
    currency: 'GBP',
    reference: input.reference,
    type: 'standing_order',
    status: 'initiated',
    plaid_payment_id: plaidPaymentId,
    schedule,
    source_account_id: input.source_account_id,
  });

  return {
    success: true,
    payment_id: plaidPaymentId,
    amount: input.amount,
    currency: 'GBP',
    recipient: input.recipient_name,
    reference: input.reference,
    schedule,
  };
}

/** Dispatch an auto-execute tool call */
export async function executeAutoTool(
  toolName: string,
  toolInput: Record<string, any>,
  userId: string,
): Promise<string> {
  let result: unknown;

  switch (toolName) {
    case 'get_user_accounts':
      result = await executeGetUserAccounts(userId);
      break;
    case 'get_account_balance':
      result = await executeGetAccountBalance(userId, toolInput as { account_id: string });
      break;
    case 'get_payees':
      result = await executeGetPayees(userId);
      break;
    default:
      result = { error: `Unknown tool: ${toolName}` };
  }

  return JSON.stringify(result);
}

/** Dispatch a confirmation tool call after user confirms */
export async function executeConfirmationTool(
  toolName: string,
  toolInput: Record<string, any>,
  userId: string,
): Promise<string> {
  let result: unknown;

  switch (toolName) {
    case 'create_payment':
      result = await executeCreatePayment(userId, toolInput as any);
      break;
    case 'create_standing_order':
      result = await executeCreateStandingOrder(userId, toolInput as any);
      break;
    default:
      result = { error: `Unknown tool: ${toolName}` };
  }

  return JSON.stringify(result);
}
