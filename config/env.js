import 'dotenv/config';

const requiredInProduction = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:4000',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  tables: {
    users: process.env.SUPABASE_TABLE_USERS || 'users',
    stocks: process.env.SUPABASE_TABLE_STOCKS || 'stocks',
    stockChartHistory: process.env.SUPABASE_TABLE_STOCK_CHART_HISTORY || 'stock_chart_history',
    portfolio: process.env.SUPABASE_TABLE_PORTFOLIO || 'portfolio',
    aiAnalysis: process.env.SUPABASE_TABLE_AI_ANALYSIS || 'ai_analysis',
    watchlist: process.env.SUPABASE_TABLE_WATCHLIST || 'user_watchlist',
    alerts: process.env.SUPABASE_TABLE_ALERTS || 'stock_alerts',
    aiEmailReports: process.env.SUPABASE_TABLE_AI_EMAIL_REPORTS || 'ai_email_reports',
  },
  /**
   * SMTP settings for the AI email digest. When unset, send attempts are still persisted to
   * `public.ai_email_reports` (with `status='queued'`) and logged to the console — useful for
   * local development. Configure to actually deliver mail.
   *
   * Gmail SMTP example (uses an App Password — not your real password):
   *   SMTP_HOST=smtp.gmail.com
   *   SMTP_PORT=465
   *   SMTP_SECURE=true
   *   SMTP_USER=youraddress@gmail.com
   *   SMTP_PASS=xxxxxxxxxxxxxxxx
   *   SMTP_FROM=Stock Insights <youraddress@gmail.com>
   */
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@stock-insights.local',
  },
  /**
   * Resend (https://resend.com) — preferred delivery channel when `RESEND_API_KEY` is set.
   * Free tier limits: 100 emails/day, 3000/month, AND the sandbox `from` must be
   * `onboarding@resend.dev` until you verify a domain. On the sandbox sender, Resend will
   * also only accept recipients whose email matches the account owner.
   *
   * To send to arbitrary recipients, verify a domain at https://resend.com/domains and set
   * `RESEND_FROM=YourName <hello@yourdomain.com>`.
   */
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.RESEND_FROM || 'Stock Insights <onboarding@resend.dev>',
  },
  /**
   * Live-job broadcast interval in ms.
   * Defaults to 5 min (300 000 ms) — fits ~5 hrs of live ticks on Twelve Data free plan
   * (8 credits/min, 800 credits/day; 6 symbols × 1 /quote credit per tick after sparkline cache warms).
   * Override via MARKET_BROADCAST_MS in `.env`. See `.env` for the credit budget math.
   */
  marketBroadcastMs: Number(process.env.MARKET_BROADCAST_MS || 300000),
  externalStockApiUrl: process.env.EXTERNAL_STOCK_API_URL || '',
  externalStockApiKey: process.env.EXTERNAL_STOCK_API_KEY || '',
  /** Twelve Data — when set, quotes/charts/sparklines use api.twelvedata.com instead of Yahoo */
  twelveDataApiKey: process.env.TWELVE_DATA_API_KEY || '',
  /**
   * Finnhub — when set, US-listed quotes are pulled from Finnhub (real-time on free plan,
   * 60 req/min, no daily cap). NSE/BSE tickers continue to use Twelve Data.
   * Sign up at https://finnhub.io/register (no credit card required).
   */
  finnhubApiKey: process.env.FINNHUB_API_KEY || '',
  /** Set DEBUG_STOCK=1 for search/quote/socket trace logs (avoid in production). */
  debugStock: process.env.DEBUG_STOCK === '1' || process.env.DEBUG_STOCK === 'true',
};

export function assertSupabaseConfig() {
  if (env.nodeEnv === 'production') {
    for (const k of requiredInProduction) {
      if (!process.env[k]) {
        throw new Error(`Missing required env: ${k}`);
      }
    }
  }
}

/**
 * Twelve Data keys are 32-char hex strings (e.g. 94887b3c..09de8).
 * Returns true when the configured value LOOKS like a real key (not a URL, blank, or placeholder).
 */
export function looksLikeTwelveDataKey(value = env.twelveDataApiKey) {
  if (!value || typeof value !== 'string') return false;
  return /^[a-f0-9]{32}$/i.test(value.trim());
}

export function warnIfTwelveKeyMalformed() {
  if (!env.twelveDataApiKey) {
    // eslint-disable-next-line no-console
    console.warn('[config] TWELVE_DATA_API_KEY is empty — live ingest disabled.');
    return;
  }
  if (!looksLikeTwelveDataKey()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config] TWELVE_DATA_API_KEY does not look like a Twelve Data key (expected 32-char hex). Got: "${env.twelveDataApiKey.slice(0, 40)}${env.twelveDataApiKey.length > 40 ? '…' : ''}"`
    );
    // eslint-disable-next-line no-console
    console.warn('[config] Get your key from https://twelvedata.com/account/api-keys');
  }
}

/**
 * Finnhub keys are alphanumeric tokens (typically 20+ chars). We don't enforce a strict format,
 * but log at startup so the user knows whether real-time US quotes will be served from Finnhub.
 */
export function looksLikeFinnhubKey(value = env.finnhubApiKey) {
  if (!value || typeof value !== 'string') return false;
  const v = value.trim();
  // Reject obvious URLs or placeholders.
  if (/^https?:/i.test(v)) return false;
  return v.length >= 16 && /^[A-Za-z0-9_-]+$/.test(v);
}

/**
 * Resend keys start with `re_` and are ~30+ chars. Sanity check only — Resend will return
 * its own 401 on a malformed value, but we warn early so the user can fix it before sending.
 */
export function looksLikeResendKey(value = env.resend.apiKey) {
  if (!value || typeof value !== 'string') return false;
  return /^re_[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

export function warnIfEmailUnconfigured() {
  const hasResend = Boolean(env.resend.apiKey);
  const hasSmtp = Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
  if (hasResend) {
    if (!looksLikeResendKey()) {
      // eslint-disable-next-line no-console
      console.warn(
        `[config] RESEND_API_KEY does not look like a Resend key (expected "re_…"). Got: "${env.resend.apiKey.slice(0, 12)}…"`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`[config] Email delivery: Resend (from=${env.resend.from})`);
    }
    return;
  }
  if (hasSmtp) {
    // eslint-disable-next-line no-console
    console.log(`[config] Email delivery: SMTP (host=${env.smtp.host}, from=${env.smtp.from})`);
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[config] Neither RESEND_API_KEY nor SMTP_* configured — AI email reports will be persisted to public.ai_email_reports (queued) and logged, but NOT delivered. Add RESEND_API_KEY to backend/.env to enable real delivery.'
  );
}

/** Back-compat: kept so server.js does not need to change its imports. */
export const warnIfSmtpMissing = warnIfEmailUnconfigured;

export function warnIfFinnhubKeyMissing() {
  if (!env.finnhubApiKey) {
    // eslint-disable-next-line no-console
    console.warn(
      '[config] FINNHUB_API_KEY is empty — US tickers (AAPL, MSFT, …) will fall back to Twelve Data (delayed on free plan). Get a free real-time key at https://finnhub.io/register'
    );
    return;
  }
  if (!looksLikeFinnhubKey()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config] FINNHUB_API_KEY does not look like a Finnhub token. Got: "${env.finnhubApiKey.slice(0, 20)}${env.finnhubApiKey.length > 20 ? '…' : ''}"`
    );
  }
}
