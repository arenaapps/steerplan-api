import type Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_user_accounts',
    description:
      'List the user\'s connected bank accounts with current balances. Use this when the user asks about their accounts or you need to know which account to send money from.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_account_balance',
    description:
      'Get the current balance of a specific bank account by account ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: {
          type: 'string',
          description: 'The bank account ID to check the balance of.',
        },
      },
      required: ['account_id'],
    },
  },
  {
    name: 'get_payees',
    description:
      'List the user\'s saved payment recipients (payees). Use this to check if a recipient already exists before creating a payment.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_payment',
    description:
      'Initiate a one-off payment to a recipient. This requires user confirmation before execution. Provide all payment details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        recipient_name: {
          type: 'string',
          description: 'Name of the recipient (e.g. "Mum", "John Smith").',
        },
        sort_code: {
          type: 'string',
          description: 'UK sort code (6 digits, e.g. "200000").',
        },
        account_number: {
          type: 'string',
          description: 'UK account number (8 digits).',
        },
        amount: {
          type: 'number',
          description: 'Payment amount in GBP.',
        },
        reference: {
          type: 'string',
          description: 'Payment reference (max 18 chars).',
        },
        source_account_id: {
          type: 'string',
          description: 'The bank account ID to send the payment from. If not specified, the user\'s primary account is used.',
        },
      },
      required: ['recipient_name', 'amount', 'reference'],
    },
  },
  {
    name: 'get_credit_insights',
    description:
      'Get the user\'s credit health data including Financial Health Index (FHI) score, income verification grade, bureau score, risk flags, and income vs expenditure analysis from Equifax. Use this when the user asks about their credit score, financial health, or credit health.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_financial_data',
    description:
      'Search the user\'s full financial history using semantic search. Use this when you need to find specific transactions, spending patterns, or financial details that are not in the dashboard context. For example: "What did I spend at Tesco in January?", "Show my Amazon purchases", "How much did I spend on transport last quarter?".',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query describing what financial data to find.',
        },
        content_types: {
          type: 'array',
          items: { type: 'string', enum: ['transaction', 'income', 'outgoing', 'budget'] },
          description: 'Optional filter to search only specific data types. Defaults to all types.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 25, max 50).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_standing_order',
    description:
      'Set up a recurring standing order to a recipient. This requires user confirmation before execution.',
    input_schema: {
      type: 'object' as const,
      properties: {
        recipient_name: {
          type: 'string',
          description: 'Name of the recipient.',
        },
        sort_code: {
          type: 'string',
          description: 'UK sort code (6 digits).',
        },
        account_number: {
          type: 'string',
          description: 'UK account number (8 digits).',
        },
        amount: {
          type: 'number',
          description: 'Payment amount in GBP per occurrence.',
        },
        reference: {
          type: 'string',
          description: 'Payment reference (max 18 chars).',
        },
        frequency: {
          type: 'string',
          enum: ['WEEKLY', 'MONTHLY'],
          description: 'How often the payment repeats.',
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format.',
        },
        source_account_id: {
          type: 'string',
          description: 'The bank account ID to send from.',
        },
      },
      required: ['recipient_name', 'amount', 'reference', 'frequency', 'start_date'],
    },
  },
];

/** Tools that execute automatically server-side without user confirmation */
export const AUTO_EXECUTE_TOOLS = new Set([
  'get_user_accounts',
  'get_account_balance',
  'get_payees',
  'search_financial_data',
  'get_credit_insights',
]);

/** Tools that require user confirmation before execution */
export const CONFIRMATION_TOOLS = new Set([
  'create_payment',
  'create_standing_order',
]);
