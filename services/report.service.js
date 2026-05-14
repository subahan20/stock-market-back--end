import { getDb } from './db.service.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/index.js';
import { buildAiDigestHtml, buildAiDigestText, sendMail, buildGroqEmailTemplate } from './email.service.js';
import { getMarketSnapshot } from './realtimeStock.engine.js';
import { generateEmailDigestWithGroq } from './groq.service.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Load every row of `ai_analysis`, joined client-side with the latest quote from `stocks`
 * for live price/change context. Returns rows sorted by stance (BUY → SELL → HOLD → other)
 * then symbol, so the digest reads as a prioritized action list.
 */
async function loadAiDigestRows() {
  const client = getDb();
  if (!client) throw new ApiError('Database unavailable', HTTP_STATUS.SERVICE_UNAVAILABLE);

  const { data: aiRows, error: aiErr } = await client
    .from(env.tables.aiAnalysis)
    .select('symbol, recommendation, confidence_score, support_level, resistance_level, trend, analysis, created_at')
    .order('created_at', { ascending: false });
  if (aiErr) throw new ApiError(aiErr.message, HTTP_STATUS.BAD_REQUEST);

  const dedup = new Map();
  for (const r of aiRows || []) {
    if (!dedup.has(r.symbol)) dedup.set(r.symbol, r);
  }
  const uniqueAi = Array.from(dedup.values());
  const symbols = uniqueAi.map((r) => r.symbol);

  let stocksBySym = {};
  if (symbols.length) {
    const { data: stockRows, error: stockErr } = await client
      .from(env.tables.stocks)
      .select('symbol, company_name, price, change_percent, last_updated')
      .in('symbol', symbols);
    if (stockErr) {
      // eslint-disable-next-line no-console
      console.warn('[reports] stocks lookup failed', stockErr.message);
    } else {
      stocksBySym = Object.fromEntries((stockRows || []).map((r) => [r.symbol, r]));
    }
  }

  const stanceOrder = { buy: 0, sell: 1, hold: 2 };
  const rows = uniqueAi.map((r) => {
    const stock = stocksBySym[r.symbol] || {};
    return {
      symbol: r.symbol,
      name: stock.company_name || r.symbol,
      stance: String(r.recommendation || 'hold').toLowerCase(),
      confidence: r.confidence_score != null ? Number(r.confidence_score) : null,
      support: r.support_level != null ? Number(r.support_level) : null,
      resistance: r.resistance_level != null ? Number(r.resistance_level) : null,
      trend: r.trend || null,
      summary: r.analysis || '',
      price: stock.price != null ? Number(stock.price) : null,
      changePct: stock.change_percent != null ? Number(stock.change_percent) : null,
      lastUpdated: stock.last_updated || r.created_at || null,
    };
  });

  rows.sort((a, b) => {
    const sa = stanceOrder[a.stance] ?? 99;
    const sb = stanceOrder[b.stance] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.symbol.localeCompare(b.symbol);
  });

  return rows;
}

/**
 * Insert a row in `public.ai_email_reports` capturing the request, snapshot of HTML payload
 * and current delivery status. Returns the persisted row.
 */
async function insertReportRow({ userId, name, email, subject, html, symbolCount, status, deliveryError, providerMessageId, sentAt }) {
  const client = getDb();
  if (!client) throw new ApiError('Database unavailable', HTTP_STATUS.SERVICE_UNAVAILABLE);
  const { data, error } = await client
    .from(env.tables.aiEmailReports)
    .insert({
      user_id: userId || null,
      recipient_name: name,
      recipient_email: email,
      subject,
      html_body: html,
      symbol_count: symbolCount,
      status,
      delivery_error: deliveryError || null,
      provider_message_id: providerMessageId || null,
      sent_at: sentAt || null,
    })
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === '42P01' || error.message?.includes('relation')) {
      throw new ApiError(
        'ai_email_reports table is missing — run backend/migrations/010_create_ai_email_reports.sql in Supabase first.',
        HTTP_STATUS.SERVICE_UNAVAILABLE
      );
    }
    throw new ApiError(error.message, HTTP_STATUS.BAD_REQUEST);
  }
  return data;
}

/**
 * Orchestrates the AI digest email flow:
 *   1. Validate name + email.
 *   2. Load ALL `ai_analysis` rows joined with latest `stocks` quotes.
 *   3. Render professional HTML + text bodies.
 *   4. Try to deliver via SMTP (graceful no-op if SMTP not configured).
 *   5. Persist an `ai_email_reports` row with status='sent' or 'queued'/'failed'.
 */
export async function sendAiInsightsEmail({ user, name, email }) {
  const cleanedName = String(name || '').trim();
  const cleanedEmail = String(email || '').trim().toLowerCase();
  if (!cleanedName) throw new ApiError('Name is required', HTTP_STATUS.BAD_REQUEST);
  if (cleanedName.length > 80) throw new ApiError('Name is too long (max 80 chars)', HTTP_STATUS.BAD_REQUEST);
  if (!cleanedEmail || !EMAIL_RE.test(cleanedEmail)) {
    throw new ApiError('A valid email address is required', HTTP_STATUS.BAD_REQUEST);
  }

  const snapshot = getMarketSnapshot();
  if (!snapshot) {
    throw new ApiError('Live market data is not available yet', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }

  const miniSnapshot = {
    nifty: snapshot.nifty,
    sensex: snapshot.sensex,
    topGainers: snapshot.topGainers,
    topLosers: snapshot.topLosers,
  };

  const groqRes = await generateEmailDigestWithGroq(miniSnapshot);
  if (groqRes.error) {
    throw new ApiError(groqRes.error, HTTP_STATUS.SERVICE_UNAVAILABLE);
  }

  const subject = `Stock Insights · Groq AI Market Digest`;
  const html = buildGroqEmailTemplate({ recipientName: cleanedName, contentHtml: groqRes.htmlContent });
  const text = `Hi ${cleanedName},\n\nHere is your market digest:\n\n${groqRes.htmlContent.replace(/<[^>]*>?/gm, '')}\n\n--\nGenerated by Groq AI.`;

  const send = await sendMail({ to: cleanedEmail, subject, html, text });
  const nowIso = new Date().toISOString();

  let status = 'sent';
  let deliveryError = null;
  let sentAt = nowIso;

  if (!send.delivered) {
    if (send.reason === 'no_transport' || send.reason === 'no_smtp') {
      status = 'queued';
      deliveryError = 'No email transport configured on the server (set RESEND_API_KEY or SMTP_* in backend/.env)';
      sentAt = null;
    } else {
      status = 'failed';
      deliveryError = send.reason;
      sentAt = null;
    }
  }

  const row = await insertReportRow({
    userId: user?.id || null,
    name: cleanedName,
    email: cleanedEmail,
    subject,
    html,
    symbolCount: 0,
    status,
    deliveryError,
    providerMessageId: send.messageId,
    sentAt,
  });

  return {
    id: row?.id,
    status,
    symbolCount: 0,
    deliveredVia: send.delivered ? (send.via || 'smtp') : null,
    queuedReason: send.delivered ? null : deliveryError,
    recipient: { name: cleanedName, email: cleanedEmail },
  };
}
