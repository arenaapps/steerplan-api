import { config } from '../config.js';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (name) => ['CreditAccount', 'CCJ', 'ElectoralRoll', 'Search', 'Characteristic'].includes(name),
});

// ── Token cache (valid ~5 hours) ──
let gwTokenCache: { token: string; expiresAt: number } | null = null;

export async function getGatewayToken(): Promise<string> {
  // Use static token for sandbox testing if provided
  if (config.equifax.staticToken) {
    return config.equifax.staticToken;
  }

  if (gwTokenCache && Date.now() < gwTokenCache.expiresAt) {
    return gwTokenCache.token;
  }

  const res = await fetch(`${config.equifax.gwBaseUrl}/Security/Logon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: config.equifax.clientId,
      clientSecret: config.equifax.clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gateway logon failed: ${res.status} ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  gwTokenCache = {
    token: data.token || data.access_token,
    expiresAt: Date.now() + 4.5 * 60 * 60 * 1000, // refresh after 4.5h
  };
  return gwTokenCache.token;
}

// ── SOAP XML builder ──

export interface CreditQuotationInput {
  firstName: string;
  surname: string;
  dateOfBirth: string; // YYYY-MM-DD
  houseNumber: string;
  street: string;
  postcode: string;
  grossAnnualIncome?: number;
  sortCode?: string;
  accountNumber?: string;
}

function buildCreditQuotationXML(input: CreditQuotationInput): string {
  const [year, month, day] = input.dateOfBirth.split('-');

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="http://www.equifax.co.uk/gateway">
  <soap:Body>
    <ns:Search>
      <ns:SearchDefinition Type="CreditQuotation">
        <ns:DataGroups>
          <ns:DataGroup Name="SCO" />
          <ns:DataGroup Name="INS" />
          <ns:DataGroup Name="ELR" />
          <ns:DataGroup Name="CJR" />
          <ns:DataGroup Name="ASR" />
        </ns:DataGroups>
        <ns:Applicants>
          <ns:Applicant>
            <ns:Name>
              <ns:Forename>${escapeXml(input.firstName)}</ns:Forename>
              <ns:Surname>${escapeXml(input.surname)}</ns:Surname>
            </ns:Name>
            <ns:DateOfBirth Day="${day}" Month="${month}" Year="${year}" />
            <ns:CurrentAddress>
              <ns:HouseNumber>${escapeXml(input.houseNumber)}</ns:HouseNumber>
              <ns:Street>${escapeXml(input.street)}</ns:Street>
              <ns:Postcode>${escapeXml(input.postcode)}</ns:Postcode>
            </ns:CurrentAddress>
            ${input.grossAnnualIncome ? `<ns:Income>${input.grossAnnualIncome}</ns:Income>` : ''}
            ${input.sortCode && input.accountNumber ? `
            <ns:BankAccount>
              <ns:SortCode>${escapeXml(input.sortCode)}</ns:SortCode>
              <ns:AccountNumber>${escapeXml(input.accountNumber)}</ns:AccountNumber>
            </ns:BankAccount>` : ''}
          </ns:Applicant>
        </ns:Applicants>
      </ns:SearchDefinition>
    </ns:Search>
  </soap:Body>
</soap:Envelope>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Parse response ──

export interface GatewayResult {
  bureauScore: number | null;
  characteristics: { name: string; value: string }[];
  creditAccounts: {
    provider: string;
    type: string;
    status: string;
    balance: number;
    limit: number;
    startDate: string;
  }[];
  ccjs: {
    court: string;
    amount: number;
    date: string;
    status: string;
  }[];
  electoralRoll: {
    name: string;
    address: string;
    startDate: string;
    endDate?: string;
  }[];
  searches: {
    type: string;
    date: string;
    company: string;
  }[];
}

function parseGatewayResponse(xml: string): GatewayResult {
  const parsed = parser.parse(xml);

  // Navigate the SOAP envelope
  const body = parsed?.Envelope?.Body || parsed?.Body || parsed;
  const searchResponse = body?.SearchResponse || body?.Search || body;
  const results = searchResponse?.Results || searchResponse;

  // Extract score
  const scoreSection = results?.Score || results?.SCO;
  const bureauScore = scoreSection?.RiskNavigator?.Score ??
    scoreSection?.Score ??
    null;

  // Extract characteristics
  const characteristics = (scoreSection?.Characteristic || []).map((c: any) => ({
    name: c?.['@_Name'] || c?.Name || '',
    value: c?.['@_Value'] || c?.Value || c?.['#text'] || '',
  }));

  // Extract credit accounts
  const insSection = results?.INS || results?.CreditAccounts;
  const creditAccounts = (insSection?.CreditAccount || []).map((ca: any) => ({
    provider: ca?.Provider || ca?.Company || '',
    type: ca?.Type || '',
    status: ca?.Status || '',
    balance: parseFloat(ca?.Balance || '0'),
    limit: parseFloat(ca?.Limit || '0'),
    startDate: ca?.StartDate || '',
  }));

  // Extract CCJs
  const ccjSection = results?.CJR || results?.CCJs;
  const ccjs = (ccjSection?.CCJ || []).map((c: any) => ({
    court: c?.Court || '',
    amount: parseFloat(c?.Amount || '0'),
    date: c?.Date || '',
    status: c?.Status || '',
  }));

  // Extract electoral roll
  const elrSection = results?.ELR || results?.ElectoralRoll;
  const electoralRoll = (elrSection?.ElectoralRoll || []).map((e: any) => ({
    name: e?.Name || '',
    address: e?.Address || '',
    startDate: e?.StartDate || '',
    endDate: e?.EndDate,
  }));

  // Extract searches
  const asrSection = results?.ASR || results?.Searches;
  const searches = (asrSection?.Search || []).map((s: any) => ({
    type: s?.Type || '',
    date: s?.Date || '',
    company: s?.Company || '',
  }));

  return {
    bureauScore: bureauScore != null ? Number(bureauScore) : null,
    characteristics,
    creditAccounts,
    ccjs,
    electoralRoll,
    searches,
  };
}

// ── Main API method ──

export async function creditQuotation(
  input: CreditQuotationInput,
): Promise<GatewayResult> {
  const token = await getGatewayToken();
  const xmlBody = buildCreditQuotationXML(input);

  const res = await fetch(`${config.equifax.gwBaseUrl}/Search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'http://www.equifax.co.uk/gateway/Search',
    },
    body: xmlBody,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gateway credit quotation failed: ${res.status} ${body.slice(0, 500)}`);
  }

  const responseXml = await res.text();
  return parseGatewayResponse(responseXml);
}
