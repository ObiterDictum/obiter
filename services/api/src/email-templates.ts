/**
 * Plain-TypeScript transactional email templates. Email HTML is a constrained,
 * hostile environment (Outlook, Gmail, etc.), so these use table-based layout
 * with fully inline CSS, a system font stack, no external stylesheets, no
 * JavaScript, no web fonts, and no remote images. Each template returns a
 * shared layout populated with per-email content, plus a plain-text fallback
 * (Resend sends both parts).
 *
 * Tone: calm, professional, terse. The audience is solicitors. No marketing
 * fluff, no emoji, no exclamation marks. The product name is "Obiter".
 */

export interface EmailContent {
  subject: string
  html: string
  text: string
}

interface EmailBody {
  /** Short headline, rendered above the action button. */
  heading: string
  /** One or two sentences explaining what the email is for. */
  bodyText: string
  /** The button label for the primary action. */
  buttonLabel: string
  /** The one-time URL the button points at. */
  url: string
  /** The "you can ignore this email" line, message-appropriate. */
  ignoreLine: string
}

// System font stack — no web fonts (many clients block them).
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

const MAX_WIDTH = 560

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Renders the shared layout for one transactional email. The wordmark is
 * styled text only — no remote images (blocked by many clients, and there is
 * no CDN yet). The primary action is a bulletproof button (padded table-cell
 * link with a solid background) with the raw URL printed beneath for clients
 * that strip buttons.
 */
function renderEmail(content: EmailBody): string {
  const safeUrl = escapeHtml(content.url)
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#f4f5f7;font-family:${FONT_STACK};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="${MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${MAX_WIDTH}px;background-color:#ffffff;border-radius:8px;">
        <tr>
          <td style="padding:32px 40px 8px 40px;">
            <h1 style="margin:0;font-size:18px;font-weight:600;letter-spacing:-0.01em;color:#0f172a;">Obiter</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 40px 0 40px;">
            <p style="margin:0 0 4px 0;font-size:16px;font-weight:600;line-height:1.4;color:#0f172a;">${escapeHtml(content.heading)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 40px 0 40px;">
            <p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(content.bodyText)}</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:28px 40px 8px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="border-radius:6px;background-color:#4f46e5;">
                  <a href="${safeUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(content.buttonLabel)}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 40px 0 40px;">
            <p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;word-break:break-all;">If the button does not work, copy and paste this URL into your browser:<br/><a href="${safeUrl}" style="color:#64748b;text-decoration:underline;">${safeUrl}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px 40px 40px;">
            <p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;">${escapeHtml(content.ignoreLine)}</p>
          </td>
        </tr>
      </table>
      <table role="presentation" width="${MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${MAX_WIDTH}px;">
        <tr>
          <td style="padding:16px 8px;">
            <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">Obiter</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
}

/**
 * Plain-text fallback for the same content. Kept readable on clients that
 * ignore HTML or for users who prefer text. The URL is always present.
 */
function renderText(content: EmailBody): string {
  return [
    'Obiter',
    '',
    content.heading,
    '',
    content.bodyText,
    '',
    `${content.buttonLabel}: ${content.url}`,
    '',
    content.ignoreLine,
    '',
    'Obiter',
  ].join('\n')
}

export function magicLinkEmail(url: string): EmailContent {
  const body: EmailBody = {
    heading: 'Sign in to Obiter',
    bodyText:
      'Use the link below to sign in to your Obiter account. The link expires in 10 minutes.',
    buttonLabel: 'Sign in',
    url,
    ignoreLine: 'If you did not request this link, you can ignore this email.',
  }
  return {
    subject: 'Your Obiter sign-in link',
    html: renderEmail(body),
    text: renderText(body),
  }
}

export function verificationEmail(url: string): EmailContent {
  const body: EmailBody = {
    heading: 'Verify your email',
    bodyText:
      'Confirm your email address to finish creating your Obiter account.',
    buttonLabel: 'Verify email',
    url,
    ignoreLine:
      'If you did not create this account, you can ignore this email.',
  }
  return {
    subject: 'Verify your Obiter email',
    html: renderEmail(body),
    text: renderText(body),
  }
}

export function resetPasswordEmail(url: string): EmailContent {
  const body: EmailBody = {
    heading: 'Reset your password',
    bodyText:
      'Set a new password for your Obiter account using the link below.',
    buttonLabel: 'Reset password',
    url,
    ignoreLine:
      'If you did not request a password reset, you can ignore this email and your password will stay the same.',
  }
  return {
    subject: 'Reset your Obiter password',
    html: renderEmail(body),
    text: renderText(body),
  }
}
