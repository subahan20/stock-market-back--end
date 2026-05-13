import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let cachedTransport = null;

function smtpConfigured() {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
}

function resendConfigured() {
  return Boolean(env.resend.apiKey);
}

function getSmtpTransport() {
  if (!smtpConfigured()) return null;
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
  });
  return cachedTransport;
}

/**
 * Send via Resend (https://resend.com) over its public REST API.
 * Returns the same `{ delivered, reason, messageId }` shape as the SMTP path so the caller
 * can persist a unified `public.ai_email_reports` row.
 *
 * Resend free-tier gotchas (worth surfacing as the `reason`):
 *   - "from" must use a verified domain OR `onboarding@resend.dev` (the sandbox sender).
 *   - With `onboarding@resend.dev`, Resend will only accept recipients whose email matches
 *     the account owner; sending to other addresses returns a 403/422 with a clear message.
 */
async function sendViaResend({ to, subject, html, text }) {
  const url = 'https://api.resend.com/emails';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.resend.from,
        to: [to],
        subject,
        html,
        text,
      }),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[email] Resend network error', err?.message || err);
    return { delivered: false, reason: `resend_network: ${err?.message || err}`, messageId: null };
  }

  const body = await res.text().catch(() => '');
  let parsed = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const detail = parsed?.message || parsed?.error?.message || body || res.statusText;
    // eslint-disable-next-line no-console
    console.warn('[email] Resend send failed', { to, status: res.status, detail });
    return { delivered: false, reason: `resend_${res.status}: ${detail}`, messageId: null };
  }

  const messageId = parsed?.id || null;
  // eslint-disable-next-line no-console
  console.log('[email] Resend send ok', { to, subject, messageId });
  return { delivered: true, reason: null, messageId, via: 'resend' };
}

async function sendViaSmtp({ to, subject, html, text }) {
  const transport = getSmtpTransport();
  if (!transport) return { delivered: false, reason: 'no_smtp', messageId: null };
  try {
    const info = await transport.sendMail({
      from: env.smtp.from,
      to,
      subject,
      html,
      text,
    });
    // eslint-disable-next-line no-console
    console.log('[email] SMTP send ok', { to, subject, messageId: info.messageId });
    return { delivered: true, reason: null, messageId: info.messageId, via: 'smtp' };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[email] SMTP send failed', { to, subject, err: err?.message || err });
    return { delivered: false, reason: `smtp: ${err?.message || err}`, messageId: null };
  }
}

/**
 * Send an email using whichever transport is configured. Prefers Resend (preferred for
 * transactional API), falls back to SMTP/Nodemailer if Resend is not configured. When
 * neither is configured, returns `{ delivered:false, reason:'no_transport' }` so the
 * caller still persists a queued row in `public.ai_email_reports`.
 */
export async function sendMail({ to, subject, html, text }) {
  if (resendConfigured()) {
    return sendViaResend({ to, subject, html, text });
  }
  if (smtpConfigured()) {
    return sendViaSmtp({ to, subject, html, text });
  }
  // eslint-disable-next-line no-console
  console.warn('[email] No transport configured — would have sent', { to, subject });
  return { delivered: false, reason: 'no_transport', messageId: null };
}

/* -------------------------------------------------------------------------- */
/* HTML template builder                                                       */
/* -------------------------------------------------------------------------- */

const inrFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

function fmtInr(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `₹${inrFormatter.format(Number(value))}`;
}

function fmtPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stanceBadge(stance) {
  const s = String(stance || '').toLowerCase();
  const styles = {
    buy: 'background:#064e3b;color:#a7f3d0;border:1px solid #047857;',
    sell: 'background:#7f1d1d;color:#fecaca;border:1px solid #b91c1c;',
    hold: 'background:#78350f;color:#fde68a;border:1px solid #b45309;',
  };
  const css = styles[s] || 'background:#1f2937;color:#cbd5e1;border:1px solid #334155;';
  const label = s.toUpperCase() || '—';
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:10px;font-weight:600;letter-spacing:.04em;${css}">${label}</span>`;
}

function trendLabel(trend) {
  const t = String(trend || '').toLowerCase();
  if (t === 'up') return '↑ Bullish';
  if (t === 'down') return '↓ Bearish';
  return '→ Neutral';
}

function pctTone(value) {
  if (value == null || !Number.isFinite(Number(value))) return '#94a3b8';
  return Number(value) >= 0 ? '#34d399' : '#f87171';
}

/**
 * Build a professional HTML digest of every row in `public.ai_analysis`, joined with
 * the latest quote from `public.stocks` for live price/change context.
 *
 * @param {object} params
 * @param {string} params.recipientName
 * @param {Array<object>} params.rows  Joined rows: { symbol, name, stance, confidence, support, resistance, trend, summary, price, changePct, lastUpdated }
 * @param {string} [params.generatedAt] ISO timestamp
 */
export function buildAiDigestHtml({ recipientName, rows, generatedAt }) {
  const ts = generatedAt || new Date().toISOString();
  const tsLabel = new Date(ts).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : 'Hello,';

  const bullCount = rows.filter((r) => String(r.stance).toLowerCase() === 'buy').length;
  const bearCount = rows.filter((r) => String(r.stance).toLowerCase() === 'sell').length;
  const holdCount = rows.filter((r) => String(r.stance).toLowerCase() === 'hold').length;

  const rowsHtml = rows.length
    ? rows
        .map((r) => {
          const tone = pctTone(r.changePct);
          return `
          <tr style="border-top:1px solid #1e293b;">
            <td style="padding:14px 12px;vertical-align:top;">
              <div style="font-size:14px;font-weight:600;color:#f1f5f9;">${escapeHtml(r.symbol)}</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:2px;">${escapeHtml(r.name || '')}</div>
              <div style="margin-top:8px;">${stanceBadge(r.stance)}</div>
            </td>
            <td style="padding:14px 12px;vertical-align:top;text-align:right;">
              <div style="font-size:14px;font-weight:600;color:#f1f5f9;">${fmtInr(r.price)}</div>
              <div style="font-size:12px;color:${tone};margin-top:2px;">${fmtPct(r.changePct)}</div>
              <div style="font-size:11px;color:#64748b;margin-top:6px;">${escapeHtml(trendLabel(r.trend))}${
                r.confidence != null && Number.isFinite(Number(r.confidence))
                  ? ` · ${Math.round(Number(r.confidence))}% conf`
                  : ''
              }</div>
            </td>
            <td style="padding:14px 12px;vertical-align:top;text-align:right;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Support</div>
              <div style="font-size:13px;color:#cbd5e1;">${fmtInr(r.support)}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:6px;">Resistance</div>
              <div style="font-size:13px;color:#cbd5e1;">${fmtInr(r.resistance)}</div>
            </td>
          </tr>
          <tr style="border-top:1px solid #1e293b;">
            <td colspan="3" style="padding:0 12px 14px 12px;font-size:12px;line-height:1.55;color:#cbd5e1;">
              ${escapeHtml(r.summary || '')}
            </td>
          </tr>
        `;
        })
        .join('\n')
    : `
      <tr><td colspan="3" style="padding:28px 16px;text-align:center;color:#94a3b8;font-size:13px;">
        No AI analysis rows in <code style="background:#1e293b;padding:1px 6px;border-radius:4px;font-size:11px;">public.ai_analysis</code> yet. They populate after the live ingest job persists market quotes.
      </td></tr>
    `;

  const summaryStrip = `
    <tr>
      <td style="padding:0 24px 16px 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#0f172a;border:1px solid #1e293b;border-radius:10px;">
          <tr>
            <td style="padding:14px 16px;border-right:1px solid #1e293b;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Symbols covered</div>
              <div style="font-size:20px;font-weight:600;color:#f1f5f9;margin-top:4px;">${rows.length}</div>
            </td>
            <td style="padding:14px 16px;border-right:1px solid #1e293b;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Bullish</div>
              <div style="font-size:20px;font-weight:600;color:#34d399;margin-top:4px;">${bullCount}</div>
            </td>
            <td style="padding:14px 16px;border-right:1px solid #1e293b;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Bearish</div>
              <div style="font-size:20px;font-weight:600;color:#f87171;margin-top:4px;">${bearCount}</div>
            </td>
            <td style="padding:14px 16px;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Hold</div>
              <div style="font-size:20px;font-weight:600;color:#fde68a;margin-top:4px;">${holdCount}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Stock Insights · AI digest</title>
</head>
<body style="margin:0;padding:0;background:#020617;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;color:#e2e8f0;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#020617;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;border-collapse:collapse;background:#0b1220;border:1px solid #1e293b;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:24px 24px 8px 24px;">
              <div style="display:inline-block;font-size:11px;letter-spacing:.18em;color:#38bdf8;text-transform:uppercase;font-weight:600;">Stock Insights · AI digest</div>
              <h1 style="margin:10px 0 4px 0;font-size:22px;font-weight:600;color:#f8fafc;line-height:1.3;">${greeting}</h1>
              <p style="margin:0 0 4px 0;font-size:13px;color:#94a3b8;line-height:1.55;">
                A snapshot of every AI recommendation currently stored in your dashboard's
                <code style="background:#1e293b;padding:1px 6px;border-radius:4px;font-size:11px;">public.ai_analysis</code>
                table, joined with the latest live quote from
                <code style="background:#1e293b;padding:1px 6px;border-radius:4px;font-size:11px;">public.stocks</code>.
              </p>
              <p style="margin:6px 0 16px 0;font-size:12px;color:#64748b;">
                Generated ${escapeHtml(tsLabel)} IST. Every number below is database-backed — no synthetic data.
              </p>
            </td>
          </tr>
          ${summaryStrip}
          <tr>
            <td style="padding:0 24px 16px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#0f172a;border:1px solid #1e293b;border-radius:10px;overflow:hidden;">
                <thead>
                  <tr style="background:#111b2e;">
                    <th align="left" style="padding:10px 12px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Symbol</th>
                    <th align="right" style="padding:10px 12px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Price</th>
                    <th align="right" style="padding:10px 12px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Levels</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 24px 24px;">
              <p style="margin:0;font-size:11px;color:#64748b;line-height:1.6;">
                This digest was sent because you requested it from the Stock Insights dashboard. The full,
                interactive view (with live charts and refreshing socket prices) is at
                <a href="#" style="color:#38bdf8;text-decoration:none;">your dashboard</a>.
              </p>
              <p style="margin:12px 0 0 0;font-size:10px;color:#475569;line-height:1.6;">
                AI signals are derived deterministically from live price + intraday range. They are informational only — not investment advice.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text fallback for email clients that don't render HTML. */
export function buildAiDigestText({ recipientName, rows }) {
  const greet = recipientName ? `Hi ${recipientName},\n\n` : 'Hello,\n\n';
  const lines = rows.length
    ? rows.map((r) => {
        const price = r.price != null ? `₹${Number(r.price).toFixed(2)}` : '—';
        const chg = r.changePct != null ? `${Number(r.changePct) >= 0 ? '+' : ''}${Number(r.changePct).toFixed(2)}%` : '—';
        const stance = String(r.stance || '').toUpperCase();
        const conf = r.confidence != null ? ` (${Math.round(Number(r.confidence))}%)` : '';
        const sup = r.support != null ? `₹${Number(r.support).toFixed(2)}` : '—';
        const res = r.resistance != null ? `₹${Number(r.resistance).toFixed(2)}` : '—';
        return `${r.symbol} · ${stance}${conf} · ${price} (${chg})\n  Support ${sup} | Resistance ${res}\n  ${r.summary || ''}`;
      })
    : ['No AI analysis rows stored yet.'];
  return `${greet}Stock Insights · AI digest\n\n${lines.join('\n\n')}\n\n--\nGenerated automatically from public.ai_analysis. Informational only; not investment advice.\n`;
}
