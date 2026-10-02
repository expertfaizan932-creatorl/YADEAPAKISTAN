<?php
/**
 * EVEE CRM - Database configuration & shared helpers
 * XAMPP defaults: user root, empty password.
 */

declare(strict_types=1);

/**
 * Database credentials. Read from environment variables (DB_HOST, DB_PORT,
 * DB_NAME, DB_USER, DB_PASS) so production servers never need credentials
 * committed to the repo. Falls back to the XAMPP local defaults below.
 */
define('DB_HOST', getenv('DB_HOST') ?: '127.0.0.1');
define('DB_PORT', (int)(getenv('DB_PORT') ?: 3306));
define('DB_NAME', getenv('DB_NAME') ?: 'evee_crm');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: '');

/* Mail credentials live in api/mail_config.php (see that file for the list
 * of values to fill in). Loaded here so every endpoint can send mail. */
if (is_file(__DIR__ . '/mail_config.php')) {
    require_once __DIR__ . '/mail_config.php';
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', DB_HOST, DB_PORT, DB_NAME);
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    return $pdo;
}

function cors(): void
{
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    // Authorization carries the session token, X-Acting-As is the Admin-only
    // "Login as" impersonation header. Both must survive the preflight.
    header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, Authorization, X-Acting-As');
    header('Content-Type: application/json; charset=utf-8');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function respond($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function fail(string $message, int $code = 400): void
{
    respond(['error' => $message], $code);
}

function json_body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '[]', true);
    return is_array($data) ? $data : [];
}

/** '' -> null so UNIQUE keys allow multiple rows. */
function normalize_optional(?string $value): ?string
{
    if ($value === null) return null;
    $value = trim($value);
    return $value === '' ? null : $value;
}

/** Clip a string to a byte/length budget without requiring mbstring. */
function text_clip(string $value, int $max): string
{
    return function_exists('mb_substr') ? mb_substr($value, 0, $max) : substr($value, 0, $max);
}

/* ----------------------- AUTH / PASSWORD HELPERS ----------------------- */

/** True when the stored value is already a bcrypt/argon2 hash. */
function is_hashed_password(string $value): bool
{
    return str_starts_with($value, '$2y$')
        || str_starts_with($value, '$2a$')
        || str_starts_with($value, '$2b$')
        || str_starts_with($value, '$argon2');
}

/**
 * Hash a plain-text password before storing. Passwords that are already
 * hashed (bcrypt/argon2) pass through untouched so the API is idempotent.
 * Returns null for empty input (no password set).
 */
function hash_password(?string $plain): ?string
{
    if ($plain === null || $plain === '') return null;
    if (is_hashed_password($plain)) return $plain;
    return password_hash($plain, PASSWORD_BCRYPT);
}

/** Verify a plain-text attempt against a stored value (hash or legacy plain). */
function verify_password(string $plain, ?string $stored): bool
{
    if ($stored === null || $stored === '') return false;
    if (is_hashed_password($stored)) {
        return password_verify($plain, $stored);
    }
    // Legacy rows saved as plain text before hashing was introduced.
    return hash_equals($stored, $plain);
}

/**
 * Random strong password for auto-provisioned accounts (e.g. dealers who
 * register through the public website form). Avoids visually ambiguous
 * characters and always contains one symbol.
 */
function generate_strong_password(int $length = 12): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    $symbols = '!@#$%&*';
    $out = '';
    for ($i = 0; $i < max(8, $length) - 1; $i++) {
        $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    $out .= $symbols[random_int(0, strlen($symbols) - 1)];
    return str_shuffle($out);
}

/* ----------------------- EMAIL NOTIFICATION (PHPMailer SMTP) ----------------------- */

/**
 * Wrap transactional content in a clean, table-based HTML shell. Inline
 * styles only (Gmail strips <style>), plain background, short text — the
 * template stays friendly to spam filters.
 */
function email_html_template(string $title, string $bodyHtml): string
{
    $brand = '#EB5F1B';
    $fromName = defined('MAIL_FROM_NAME') ? MAIL_FROM_NAME : 'Yadea Pakistan';
    $year = date('Y');
    $titleEsc = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
    return '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>' . $titleEsc . '</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#334155;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr>
          <td style="background-color:' . $brand . ';padding:18px 28px;">
            <span style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:1px;">' . htmlspecialchars($fromName, ENT_QUOTES, 'UTF-8') . '</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <h2 style="margin:0 0 14px 0;font-size:18px;color:#1e293b;">' . $titleEsc . '</h2>
            ' . $bodyHtml . '
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:11px;line-height:16px;color:#94a3b8;">
              You received this email because an action was taken on your ' . htmlspecialchars($fromName, ENT_QUOTES, 'UTF-8') . ' account.
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:14px 0 0 0;font-size:11px;color:#94a3b8;">&copy; ' . $year . ' ' . htmlspecialchars($fromName, ENT_QUOTES, 'UTF-8') . '. All rights reserved.</p>
    </td>
  </tr>
</table>
</body>
</html>';
}

/**
 * Strip tags + decode entities for the plain-text alternative body.
 */
function email_plain_text(string $html): string
{
    $text = html_entity_decode(strip_tags($html), ENT_QUOTES, 'UTF-8');
    return trim(preg_replace("/[ \t]+/", ' ', preg_replace("/\r|\n{2,}/", "\n", $text)) ?? $text);
}

/**
 * Distinct valid addresses that should receive form-submission / registration
 * notifications. Reads MAIL_NOTIFY_TO (semicolon/comma separated); falls back
 * to the authenticated mailbox when unset.
 */
function mail_notify_recipients(): array
{
    $raw = defined('MAIL_NOTIFY_TO') ? (string)MAIL_NOTIFY_TO : '';
    $candidates = [];
    if (trim($raw) !== '') {
        foreach (preg_split('/[;,]+/', $raw) as $part) {
            $part = trim($part);
            if ($part !== '') $candidates[] = $part;
        }
    } elseif (defined('SMTP_USER') && SMTP_USER !== '') {
        $candidates[] = (string)SMTP_USER;
    }
    $clean = [];
    foreach ($candidates as $addr) {
        if (filter_var($addr, FILTER_VALIDATE_EMAIL) && !in_array($addr, $clean, true)) {
            $clean[] = $addr;
        }
    }
    return $clean;
}

/**
 * Append a line to the web-accessible mail debug log (mail-debug.log next to
 * the document root) AND the PHP error log. Lets the deliverability status of
 * every notification be verified over HTTP without SSH access.
 */
function mail_debug_log(string $line): void
{
    error_log('[Evee CRM] ' . $line);
    @file_put_contents(__DIR__ . '/../mail-debug.log', '[' . date('c') . '] ' . $line . "\n", FILE_APPEND);
}

/**
 * Send an email through SMTP via PHPMailer. Falls back to PHP mail() when
 * SMTP is not configured so notifications never hard-fail on fresh installs.
 * Returns true when the message was accepted for delivery.
 */
function send_app_mail(string $to, string $toName, string $subject, string $bodyHtml): bool
{
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) return false;

    $html = email_html_template($subject, $bodyHtml);
    $host = defined('SMTP_HOST') ? trim((string)SMTP_HOST) : '';

    if ($host === '') {
        // Not configured yet: legacy best-effort mail() path.
        $headers = "MIME-Version: 1.0\r\n"
            . "Content-Type: text/html; charset=UTF-8\r\n"
            . 'From: ' . (defined('MAIL_FROM_NAME') ? MAIL_FROM_NAME : 'Yadea CRM') . " <no-reply@evee.local>\r\n"
            . "X-Mailer: Yadea CRM Notification\r\n";
        try {
            return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $html, $headers);
        } catch (Throwable $e) {
            return false;
        }
    }

    require_once __DIR__ . '/lib/phpmailer/Exception.php';
    require_once __DIR__ . '/lib/phpmailer/PHPMailer.php';
    require_once __DIR__ . '/lib/phpmailer/SMTP.php';

    $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host = $host;
        $mail->Port = defined('SMTP_PORT') ? SMTP_PORT : 587;
        if (defined('SMTP_SECURE') && SMTP_SECURE !== '') {
            $mail->SMTPSecure = SMTP_SECURE === 'ssl'
                ? \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS
                : \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        }
        $mail->SMTPAuth = true;
        $mail->Username = defined('SMTP_USER') ? SMTP_USER : '';
        $mail->Password = defined('SMTP_PASS') ? SMTP_PASS : '';
        $mail->CharSet = 'UTF-8';
        $mail->Encoding = 'base64';

        // Send from the authenticated mailbox itself (SPF/DKIM aligned),
        // which keeps the message out of spam folders.
        $from = SMTP_USER !== '' ? SMTP_USER : 'no-reply@evee.local';
        $mail->setFrom($from, defined('MAIL_FROM_NAME') ? MAIL_FROM_NAME : 'Yadea CRM');
        if ($toName !== '') {
            $mail->addAddress($to, $toName);
        } else {
            $mail->addAddress($to);
        }
        if ($from !== $to) {
            $mail->addReplyTo($from, defined('MAIL_FROM_NAME') ? MAIL_FROM_NAME : 'Yadea CRM');
        }

        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body = $html;
        $mail->AltBody = email_plain_text($bodyHtml);

        $ok = $mail->send();
        if (!$ok) {
            mail_debug_log('FAIL mail to ' . $to . ': ' . $mail->ErrorInfo);
        }
        return $ok;
    } catch (Throwable $e) {
        mail_debug_log('EXCEPTION mail to ' . $to . ': ' . $e->getMessage());
        return false;
    }
}

/**
 * Best-effort notification email used across the app. Kept for backwards
 * compatibility with existing call sites; now backed by PHPMailer/SMTP.
 * Returns true when mail() accepted the message.
 */
function send_notification_email(string $to, string $subject, string $body): bool
{
    return send_app_mail($to, '', $subject, $body);
}

/**
 * Send a RAW email (no CRM template wrapper) through the configured SMTP
 * account — used by the /emails/send campaign endpoint so the message the
 * user composed in the UI is delivered exactly as written.
 *
 * $opts keys:
 *   to        string|string[]  recipient address(es)          (required)
 *   cc / bcc  string|string[]  optional copies
 *   subject   string                                          (required)
 *   html      string           HTML body                      (required)
 *   from_name string           display name override
 * Returns [sent => string[], failed => array<string,string>].
 */
function send_crm_mail(array $opts): array
{
    $norm = static function ($v): array {
        if ($v === null || $v === '') return [];
        return is_array($v) ? $v : [$v];
    };
    $tos = $norm($opts['to'] ?? null);
    $ccs = $norm($opts['cc'] ?? null);
    $bccs = $norm($opts['bcc'] ?? null);
    $subject = trim((string)($opts['subject'] ?? ''));
    $html = (string)($opts['html'] ?? '');
    $fromName = trim((string)($opts['from_name'] ?? '')) ?: (defined('MAIL_FROM_NAME') ? MAIL_FROM_NAME : 'Yadea Pakistan');

    $valid = array_values(array_filter(array_map('trim', $tos), fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)));
    if ($valid === [] || $subject === '') {
        return ['sent' => [], 'failed' => array_fill_keys($tos, 'Invalid recipient or empty subject')];
    }

    require_once __DIR__ . '/lib/phpmailer/Exception.php';
    require_once __DIR__ . '/lib/phpmailer/PHPMailer.php';
    require_once __DIR__ . '/lib/phpmailer/SMTP.php';

    $sent = [];
    $failed = [];

    // One PHPMailer instance reused with SMTP keep-alive: much faster for
    // bulk sends because the connection/auth happens only once.
    $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host = defined('SMTP_HOST') ? SMTP_HOST : '';
        $mail->Port = defined('SMTP_PORT') ? SMTP_PORT : 465;
        if (defined('SMTP_SECURE') && SMTP_SECURE !== '') {
            $mail->SMTPSecure = SMTP_SECURE === 'ssl'
                ? \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS
                : \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        }
        $mail->SMTPAuth = true;
        $mail->Username = defined('SMTP_USER') ? SMTP_USER : '';
        $mail->Password = defined('SMTP_PASS') ? SMTP_PASS : '';
        $mail->CharSet = 'UTF-8';
        $mail->Encoding = 'base64';
        $mail->SMTPKeepAlive = true;
        $from = $mail->Username !== '' ? $mail->Username : 'no-reply@evee.local';
        $mail->setFrom($from, $fromName);
        foreach (array_filter(array_map('trim', $ccs), fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)) as $cc) {
            $mail->addCC($cc);
        }
        foreach (array_filter(array_map('trim', $bccs), fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)) as $bcc) {
            $mail->addBCC($bcc);
        }

        foreach ($valid as $to) {
            try {
                $mail->clearAddresses();
                $mail->addAddress($to);
                $mail->isHTML(true);
                $mail->Subject = $subject;
                $mail->Body = $html;
                $mail->AltBody = email_plain_text($html);
                if ($mail->send()) {
                    $sent[] = $to;
                } else {
                    $failed[$to] = 'Rejected by server';
                }
            } catch (Throwable $e) {
                $failed[$to] = $e->getMessage();
            }
        }
    } catch (Throwable $e) {
        // Connect/auth failed: every valid recipient counts as failed.
        foreach ($valid as $to) {
            $failed[$to] = $e->getMessage();
        }
    } finally {
        $mail->smtpClose();
    }

    return ['sent' => $sent, 'failed' => $failed];
}
