<?php
/**
 * EVEE CRM - REST API router
 * ---------------------------------
 * GET  /api/index.php/contacts                 -> list (filters: search, tag, type, lead, sort)
 * GET  /api/index.php/contacts/{id}            -> single contact with tags
 * POST /api/index.php/contacts                 -> create contact
 * POST /api/index.php/contacts/bulk-delete     -> delete many ({ "ids": [1,2] })
 * DELETE /api/index.php/contacts/{id}          -> delete one
 *  GET  /api/index.php/leads                    -> LEADS ONLY (the "find leads" shortcut)
 *  GET  /api/index.php/tags                     -> list all tags
 *  GET  /api/index.php/campaigns?status=active  -> list campaigns (status: active|paused|canceled|finished)
 *  GET  /api/index.php/workflows?status=active  -> list workflows (status: active|finished)
 *  GET  /api/index.php/staff                    -> list staff users
 *  POST /api/index.php/staff                    -> create staff user
 *  PUT  /api/index.php/staff/{id}               -> update staff user
 *  DELETE /api/index.php/staff/{id}             -> delete staff user
 *  PUT  /api/index.php/contacts/{id}            -> update contact (e.g. assigned_to)
 *
 *  GET  /api/index.php/invoices                  -> list invoices (filter: search); Admins see all, others their own
 *  GET  /api/index.php/invoices/next-number      -> suggested next sequential invoice number
 *  POST /api/index.php/invoices                  -> create sales tax invoice
 *  PUT  /api/index.php/invoices/{id}             -> update sales tax invoice
 *  DELETE /api/index.php/invoices/{id}           -> delete sales tax invoice
 *
 * POST /api/index.php/emails/send              -> send email via SMTP (crm@yadea.com.pk)
 *                                                 { to, cc?, bcc?, subject, html, from_name? }
 * POST /api/index.php/emails/test              -> deliverability check { to, subject?, html? }
 *
 *  GET  /api/index.php/submissions              -> portal submissions (type, assigned_to, search)
 *                                                 Admins see all; everybody else
 *                                                 only rows assigned to them.
 * POST /api/index.php/submissions               -> create dealership application / inquiry ticket (public)
 * POST /api/index.php/submissions/{id}/assign   -> { assigned_to } (0 = unassign)
 * DELETE /api/index.php/submissions/{id}        -> remove a submission
 *
 * Full URL example:  http://localhost/Evee/api/index.php/contacts?search=faiz
 */

declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

register_shutdown_function(function () {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'error' => 'Fatal PHP error',
            'message' => $error['message'],
            'file' => $error['file'],
            'line' => $error['line'],
        ]);
        exit;
    }
});

require __DIR__ . '/config.php';

cors();

/** Parse request path relative to this script, e.g. ["contacts", "5"]. */
function route_parts(): array
{
    $script = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '';
    $base = parse_url($_SERVER['SCRIPT_NAME'], PHP_URL_PATH) ?: '';
    $path = substr($script, strlen($base));
    $parts = array_values(array_filter(explode('/', $path), fn($p) => $p !== ''));
    return $parts;
}

function to_int(string $v): int
{
    return (int)$v;
}

/**
 * Build the WHERE clause for contacts/leads queries.
 *
 * Tenancy is appended from the CALLER's identity, never from the request. See
 * contact_scope_clause() for the visibility rules.
 */
function build_where(array $filters, array &$params): string
{
    $clauses = [];

    if (!empty($filters['search'])) {
        $term = '%' . $filters['search'] . '%';
        // PDO named placeholders must be unique, so repeat the term across 5 params.
        $searchCols = ['name', 'phone', 'email', 'business_name', 'tags'];
        $pats = [];
        foreach ($searchCols as $i => $col) {
            $pname = ':search' . $i;
            $params[$pname] = $term;
            $pats[] = "$col LIKE $pname";
        }
        $clauses[] = '(' . implode(' OR ', $pats) . ')';
    }
    if (!empty($filters['tag'])) {
        $params[':tag'] = $filters['tag'];
        $clauses[] = 'FIND_IN_SET(:tag, tags)';
    }
    if (!empty($filters['type'])) {
        $params[':type'] = $filters['type'];
        $clauses[] = 'contact_type = :type';
    }
    if (isset($filters['lead'])) {
        $params[':lead'] = to_int($filters['lead']);
        $clauses[] = 'is_lead = :lead';
    }
    // NOTE: a `restrict_to` query parameter is deliberately ignored. It used to
    // be the only visibility filter and it came straight from the URL, so a
    // dealer could just leave it out and read the whole CRM.
    // Tenancy is applied below from the caller's session token.
    $clauses[] = contact_scope_clause('', current_user_id(), $params, 'scope');

    return $clauses ? (' WHERE ' . implode(' AND ', $clauses)) : '';
}

function order_clause(array $filters): string
{
    $allowed = ['name', 'phone', 'email', 'business_name', 'created_at', 'last_activity_at'];
    $sort = $filters['sort'] ?? 'created_at';
    $sort = in_array($sort, $allowed, true) ? $sort : 'created_at';
    $dir = strtolower($filters['dir'] ?? 'desc') === 'asc' ? 'ASC' : 'DESC';
    return sprintf(' ORDER BY %s %s', $sort, $dir);
}

/**
 * Followers for a whole page of contacts in ONE query.
 *
 * list_contacts() used to call contact_followers() once per row, so a 3,000
 * contact page meant 3,000 sequential round trips: 48 seconds on the live box
 * and a browser timeout ("Failed to fetch") long before that. One grouped
 * query does the same work in a single pass.
 */
function contact_followers_map(array $contactIds): array
{
    $map = [];
    foreach (array_unique(array_map('intval', $contactIds)) as $id) $map[$id] = [];
    if (!$map) return $map;

    // Chunked so a huge page cannot build a statement past max_allowed_packet.
    foreach (array_chunk(array_keys($map), 500) as $chunk) {
        $in = implode(',', array_fill(0, count($chunk), '?'));
        $stmt = db()->prepare(
            "SELECT cf.contact_id, s.id, s.first_name, s.last_name, s.full_name, s.user_type, s.avatar_data
               FROM contact_followers cf
               JOIN staff_users s ON s.id = cf.staff_id
              WHERE cf.contact_id IN ($in)
              ORDER BY s.full_name"
        );
        $stmt->execute($chunk);
        foreach ($stmt->fetchAll() as $r) {
            $cid = (int)$r['contact_id'];
            unset($r['contact_id']);
            $map[$cid][] = $r;
        }
    }
    return $map;
}

/**
 * Indexes the contact list depends on.
 *
 * Every scoped contacts query filters on assigned_to/deleted_at and the tag
 * joins need contact_tags(contact_id). Without them the scope check degrades
 * into a full table scan per request, which is what made the CRM crawl.
 *
 * Idempotent: asks information_schema once for the index names that already
 * exist and only creates what is missing, so this is safe on every request and
 * a failure here is never fatal - it just leaves the query unindexed.
 */
function ensure_list_indexes(): void
{
    static $done = false;
    if ($done) return;
    $done = true;

    $wanted = [
        'contacts' => [
            'idx_contacts_assigned_deleted' => '(assigned_to, deleted_at)',
            'idx_contacts_deleted_activity' => '(deleted_at, last_activity_at)',
            'idx_contacts_lead_type' => '(is_lead, contact_type)',
        ],
        'contact_tags' => [
            'idx_contact_tags_contact' => '(contact_id)',
            'idx_contact_tags_tag' => '(tag_id)',
        ],
    ];

    try {
        $pdo = db();
        $have = [];
        $stmt = $pdo->prepare(
            'SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (:a, :b)'
        );
        $stmt->execute([':a' => 'contacts', ':b' => 'contact_tags']);
        foreach ($stmt->fetchAll() as $r) $have[$r['TABLE_NAME'] . '.' . $r['INDEX_NAME']] = true;

        foreach ($wanted as $table => $indexes) {
            foreach ($indexes as $name => $cols) {
                if (isset($have[$table . '.' . $name])) continue;
                $pdo->exec("CREATE INDEX `$name` ON `$table` $cols");
            }
        }
    } catch (Throwable $e) {
        // An index is an optimisation, never a correctness requirement.
    }
}

/** List contacts (from the aggregated view). */
function list_contacts(array $filters): void
{
    ensure_list_indexes();
    $params = [];
    $where = build_where($filters, $params);
    $order = order_clause($filters);

    $stmt = db()->prepare('SELECT * FROM v_contacts_with_tags' . $where . $order);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $followers = contact_followers_map(array_column($rows, 'id'));

    foreach ($rows as &$row) {
        $row['tags'] = $row['tags'] !== '' ? explode(',', $row['tags']) : [];
        $row['tag_ids'] = $row['tag_ids'] !== '' ? array_map('to_int', explode(',', $row['tag_ids'])) : [];
        $row['custom_fields'] = decode_custom_fields($row['custom_fields'] ?? null);
        $row['followers'] = $followers[(int)$row['id']] ?? [];
    }

    respond(['data' => $rows, 'count' => count($rows)]);
}

/** Load the follower staff summaries for a contact. */
function contact_followers(int $contactId): array
{
    $rows = db()->prepare(
        'SELECT s.id, s.first_name, s.last_name, s.full_name, s.user_type, s.avatar_data
           FROM contact_followers cf
           JOIN staff_users s ON s.id = cf.staff_id
          WHERE cf.contact_id = :id
          ORDER BY s.full_name'
    );
    $rows->execute([':id' => $contactId]);
    return $rows->fetchAll();
}

/** Single contact with tags. */
function get_contact(int $id): void
{
    require_contact_access($id);
    $stmt = db()->prepare('SELECT * FROM v_contacts_with_tags WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();

    if (!$row) fail('Contact not found', 404);

    $row['tags'] = $row['tags'] !== '' ? explode(',', $row['tags']) : [];
    $row['tag_ids'] = $row['tag_ids'] !== '' ? array_map('to_int', explode(',', $row['tag_ids'])) : [];
    $row['custom_fields'] = decode_custom_fields($row['custom_fields'] ?? null);
    $row['followers'] = contact_followers((int)$id);
    respond(['data' => $row]);
}

/** Find-or-create a tag, return its id. */
function ensure_tag(PDO $pdo, string $tagName): int
{
    $name = trim($tagName);
    if ($name === '') return 0;

    $stmt = $pdo->prepare('SELECT id FROM tags WHERE name = :name');
    $stmt->execute([':name' => $name]);
    $id = $stmt->fetchColumn();

    if ($id !== false) return (int)$id;

    $stmt = $pdo->prepare('INSERT INTO tags (name) VALUES (:name)');
    $stmt->execute([':name' => $name]);
    return (int)$pdo->lastInsertId();
}

/** Normalize a custom_fields value (array or JSON string) into a JSON text column value. */
function normalize_custom_fields($value): ?string
{
    if (is_array($value)) {
        return encode_json_field($value);
    }
    if (is_string($value) && $value !== '') {
        $decoded = json_decode($value, true);
        if (is_array($decoded)) return json_encode($decoded, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return $value;
    }
    return null;
}

/** Decode the custom_fields JSON column into a PHP array for the API response. */
function decode_custom_fields(?string $raw): array
{
    $decoded = decode_json_field($raw);
    return is_array($decoded) ? $decoded : [];
}

/**
 * Merge an incoming custom_fields JSON value into the value already stored on
 * the contact. 'form_submissions' arrays are APPENDED so a repeat submission
 * never wipes the earlier history (what was filled before stays saved);
 * every other key simply overwrites its previous value.
 */
function merge_custom_fields(?string $existingRaw, ?string $incomingRaw): ?string
{
    $base = decode_custom_fields($existingRaw);
    $inc = decode_custom_fields($incomingRaw);
    if (!$inc) return $existingRaw;

    $result = $base;
    foreach ($inc as $key => $value) {
        if ($key === 'form_submissions' && is_array($value)) {
            $existingSubs = is_array($result['form_submissions'] ?? null) ? $result['form_submissions'] : [];
            $result['form_submissions'] = array_merge($existingSubs, $value);
        } else {
            $result[$key] = $value;
        }
    }
    return encode_json_field($result);
}

/** Create a contact (accepts first_name/last_name or a combined name). */
/**
 * POST /public/leads — a website form submission.
 *
 * This is the ONLY contact write the anonymous internet may perform. It exists
 * because the public form used to POST to /contacts, which now requires a
 * session. Everything that could route or influence a record is stripped
 * rather than trusted:
 *
 *   - assigned_to is forced to nobody, so a public visitor can never drop a
 *     lead into a dealer's pipeline (or trigger their notifications);
 *   - contact_type is forced to Lead;
 *   - tags are trimmed to short labels instead of being taken verbatim;
 *   - it never merges into an existing contact, so it cannot be used to probe
 *     whether an email/phone is already in the CRM, nor to overwrite it.
 */
function create_public_lead(array $body): void
{
    unset($body['assigned_to'], $body['staff_id'], $body['user_id'], $body['id'], $body['avatar_data']);

    $body['contact_type'] = 'Lead';

    $tags = [];
    foreach (array_slice((array)($body['tags'] ?? []), 0, 10) as $t) {
        $t = trim(preg_replace('/[^\p{L}\p{N} \-_]/u', '', (string)$t) ?? '');
        if ($t !== '') $tags[] = mb_substr($t, 0, 50);
    }
    $body['tags'] = $tags;

    // Website leads stay in the unassigned pool even when a staff member
    // happens to be signed in on the browser that fills the form: the token
    // rides along on every request, and create_contact() would otherwise hand
    // the lead to whoever was logged in.
    create_contact($body, true);
}

function create_contact(array $body, bool $publicLead = false): void
{
    $firstName = normalize_optional($body['first_name'] ?? null);
    $lastName = normalize_optional($body['last_name'] ?? null);

    // Fallback: accept a combined "name" and split on first space.
    if ($firstName === null && !empty($body['name'])) {
        $name = trim((string)$body['name']);
        $space = strpos($name, ' ');
        if ($space === false) {
            $firstName = $name;
        } else {
            $firstName = substr($name, 0, $space);
            $lastName = substr($name, $space + 1);
        }
    }

    if ($firstName === null || $firstName === '') {
        fail('First name is required');
    }

    // last_name is NOT NULL in the schema; coerce null/empty to ''.
    $lastName = $lastName ?? '';

    $phone = normalize_optional($body['phone'] ?? null);
    $email = normalize_optional($body['email'] ?? null);
    $business = normalize_optional($body['business_name'] ?? null);
    $contactType = in_array($body['contact_type'] ?? '', ['Lead', 'Customer', 'Vendor', 'Partner'], true)
        ? $body['contact_type'] : '';
    $avatarColor = normalize_optional($body['avatar_color'] ?? null) ?? 'bg-emerald-200 text-emerald-800';
    $avatarData = normalize_optional($body['avatar_data'] ?? null);
    $customFields = normalize_custom_fields($body['custom_fields'] ?? null);

    // PUBLIC FORM DETECTION: public custom forms submit
    // { custom_fields: { form_submissions: [{ formName, submittedOn, values }] } }.
    // Any such row is a real website submission -> the CRM team gets notified
    // (mailbox copy + Admins). Manual adds / imports carry no form_submissions
    // and are left untouched (no spam).
    $formSubmission = null;
    $formName = '';
    if (is_array($customFields) && is_array($customFields['form_submissions'] ?? null)) {
        foreach ($customFields['form_submissions'] as $sub) {
            if (is_array($sub) && isset($sub['formName'])) {
                $formSubmission = $sub;
                $formName = (string)$sub['formName'];
                break;
            }
        }
    }

    $tagInput = array_values(array_filter(
        array_map(fn($t) => trim((string)$t), (array)($body['tags'] ?? [])),
        fn($t) => $t !== ''
    ));

    $isLead = $contactType === 'Lead'
        || in_array('warm lead', $tagInput, true)
        || in_array('hot lead', $tagInput, true)
        || in_array('cold lead', $tagInput, true);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        // Dedupe on email OR phone: if an existing contact already carries
        // either value, update it instead of failing, so form re-submissions
        // never hard-block with a "duplicate" error.
        $existingId = 0;
        if ($email !== null || $phone !== null) {
            $dupSql = 'SELECT id FROM contacts WHERE 1=0';
            $dupParams = [];
            if ($email !== null) {
                $dupSql .= ' OR email = :dup_email';
                $dupParams[':dup_email'] = $email;
            }
            if ($phone !== null) {
                $dupSql .= ' OR phone = :dup_phone';
                $dupParams[':dup_phone'] = $phone;
            }
            $dupStmt = $pdo->prepare($dupSql);
            $dupStmt->execute($dupParams);
            $dupId = $dupStmt->fetchColumn();
            if ($dupId !== false) $existingId = (int)$dupId;
        }

        // Only merge into a contact the caller can actually see. Without this a
        // dealer (or a public website form) could submit somebody else's email
        // and overwrite — and un-soft-delete — that person's record, because the
        // dedupe lookup ran across every tenant.
        if ($existingId > 0 && !caller_can_access_contact($existingId)) {
            $existingId = 0;
        }

        if ($existingId > 0) {
            // Guard: if the incoming email/phone is already owned by a DIFFERENT
            // contact, skip overwriting that field (keep the original value).
            if ($email !== null) {
                $owner = $pdo->prepare('SELECT id FROM contacts WHERE email = :email AND id <> :id LIMIT 1');
                $owner->execute([':email' => $email, ':id' => $existingId]);
                if ($owner->fetchColumn() !== false) $email = null;
            }
            if ($phone !== null) {
                $owner = $pdo->prepare('SELECT id FROM contacts WHERE phone = :phone AND id <> :id LIMIT 1');
                $owner->execute([':phone' => $phone, ':id' => $existingId]);
                if ($owner->fetchColumn() !== false) $phone = null;
            }

            $updates = [];
            $params = [':id' => $existingId];
            if ($firstName !== null) { $updates[] = 'first_name = :first_name'; $params[':first_name'] = $firstName; }
            if ($lastName !== null) { $updates[] = 'last_name = :last_name'; $params[':last_name'] = $lastName; }
            if ($phone !== null) { $updates[] = 'phone = :phone'; $params[':phone'] = $phone; }
            if ($email !== null) { $updates[] = 'email = :email'; $params[':email'] = $email; }
            if ($business !== null) { $updates[] = 'business_name = :business_name'; $params[':business_name'] = $business; }
            if ($contactType !== '') { $updates[] = 'contact_type = :contact_type'; $params[':contact_type'] = $contactType; }
            if ($isLead) { $updates[] = 'is_lead = :is_lead'; $params[':is_lead'] = 1; }
            if ($avatarData !== null) { $updates[] = 'avatar_data = :avatar_data'; $params[':avatar_data'] = $avatarData; }
            if ($customFields !== null) {
                // Append the new form submission to any existing history instead
                // of replacing custom_fields, so no filled data is ever lost.
                $existingCf = $pdo->prepare('SELECT custom_fields FROM contacts WHERE id = :id');
                $existingCf->execute([':id' => $existingId]);
                $existingRaw = $existingCf->fetchColumn();
                $updates[] = 'custom_fields = :custom_fields';
                $params[':custom_fields'] = merge_custom_fields(
                    $existingRaw !== false ? (string)$existingRaw : null,
                    $customFields
                );
            }
            $updates[] = 'last_activity_at = NOW()';
            $updates[] = 'deleted_at = NULL';
            if ($updates) {
                $pdo->prepare('UPDATE contacts SET ' . implode(', ', $updates) . ' WHERE id = :id')
                    ->execute($params);
            }

            foreach ($tagInput as $tagName) {
                $tagId = ensure_tag($pdo, $tagName);
                if ($tagId > 0) {
                    $pdo->prepare('INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (:c, :t)')
                        ->execute([':c' => $existingId, ':t' => $tagId]);
                }
            }

            // This lead already existed (matched by email/phone) and re-submitted
            // the form — tag it so the repeat submission is visible at a glance.
            $repeatTagId = ensure_tag($pdo, 'Form Re-submitted');
            if ($repeatTagId > 0) {
                $pdo->prepare('INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (:c, :t)')
                    ->execute([':c' => $existingId, ':t' => $repeatTagId]);
            }

            $pdo->commit();

            // Link the (re-)submitted contact to its outlet smart list.
            sync_contact_outlet_smart_lists($existingId);

            if ($formSubmission !== null) {
                notify_form_submission_from_contact($formName, $formSubmission, $firstName, $lastName, $email, $phone, $business);
            }

            respond(['data' => ['id' => $existingId], 'message' => 'Contact already exists; updated'], 200);
        }

        // OWNER OF THE NEW ROW
        //
        // The tenancy rule (contact_scope_clause) only ever shows a non-admin
        // their own rows, so a row inserted with assigned_to = NULL was visible
        // to Admins alone: a Dealer who added a contact never saw it again.
        // A signed-in non-admin therefore always owns what they create (and
        // cannot create into somebody else's book), an Admin may name an owner
        // explicitly, and the anonymous website form stays unassigned.
        $assignedTo = null;
        $creator = $publicLead ? null : api_current_user();
        if ($creator !== null) {
            if (($creator['user_type'] ?? '') === 'Admin') {
                $reqOwner = $body['assigned_to'] ?? null;
                $reqOwner = ($reqOwner === null || $reqOwner === '') ? 0 : to_int((string)$reqOwner);
                if ($reqOwner > 0) {
                    $ownerCheck = $pdo->prepare('SELECT id FROM staff_users WHERE id = :id');
                    $ownerCheck->execute([':id' => $reqOwner]);
                    if ($ownerCheck->fetch()) $assignedTo = $reqOwner;
                }
            } else {
                $assignedTo = (int)$creator['id'];
            }
        }

        $stmt = $pdo->prepare(
            'INSERT INTO contacts (first_name, last_name, phone, email, business_name,
                                   contact_type, is_lead, avatar_color, avatar_data, custom_fields, assigned_to)
             VALUES (:fn, :ln, :phone, :email, :biz, :type, :lead, :color, :avatar, :custom, :assigned_to)'
        );
        $stmt->execute([
            ':fn' => $firstName,
            ':ln' => $lastName,
            ':phone' => $phone,
            ':email' => $email,
            ':biz' => $business,
            ':type' => $contactType,
            ':lead' => $isLead ? 1 : 0,
            ':color' => $avatarColor,
            ':avatar' => $avatarData,
            ':custom' => $customFields,
            ':assigned_to' => $assignedTo,
        ]);

        $contactId = (int)$pdo->lastInsertId();

        foreach ($tagInput as $tagName) {
            $tagId = ensure_tag($pdo, $tagName);
            if ($tagId > 0) {
                $pdo->prepare('INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (:c, :t)')
                    ->execute([':c' => $contactId, ':t' => $tagId]);
            }
        }

        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        fail('Database error: ' . $e->getMessage(), 500);
    }

    // Link the new contact to its outlet smart list.
    sync_contact_outlet_smart_lists($contactId);

    if ($formSubmission !== null) {
        notify_form_submission_from_contact($formName, $formSubmission, $firstName, $lastName, $email, $phone, $business);
    }

    respond(['data' => ['id' => $contactId], 'message' => 'Contact created'], 201);
}

/** Soft-delete one contact: hides it from every live view but keeps the DB row. */
function delete_contact(int $id): void
{
    require_contact_access($id);
    $stmt = db()->prepare('UPDATE contacts SET deleted_at = NOW(), last_activity_at = NOW() WHERE id = :id AND deleted_at IS NULL');
    $stmt->execute([':id' => $id]);
    if ($stmt->rowCount() === 0) fail('Contact not found', 404);
    prune_smart_lists_when_empty([$id]);
    respond(['message' => 'Contact deleted']);
}

/** Soft-delete many contacts (rows stay in the DB, only hidden from live views). */
function bulk_delete(array $body): void
{
    $ids = array_values(array_filter(array_map('to_int', (array)($body['ids'] ?? [])), fn($i) => $i > 0));
    if (!$ids) fail('No ids provided');

    // Check every id against the caller's tenancy before deleting anything, so a
    // mixed batch cannot be used to reach another dealer's contacts.
    $allowed = array_values(array_filter($ids, 'caller_can_access_contact'));
    if ($allowed !== $ids) {
        fail('Some contacts are not yours and cannot be deleted.', 403);
    }

    $placeholders = implode(',', array_fill(0, count($allowed), '?'));
    $stmt = db()->prepare("UPDATE contacts SET deleted_at = NOW(), last_activity_at = NOW() WHERE id IN ($placeholders) AND deleted_at IS NULL");
    $stmt->execute($allowed);

    prune_smart_lists_when_empty($allowed);

    respond(['message' => 'Deleted ' . $stmt->rowCount() . ' contact(s)']);
}

/**
 * Drop a deleted contact out of the smart lists that referenced it.
 *
 * This used to DELETE every smart list in the table once the last contact was
 * removed, wiping other dealers' lists along with it. It now only unlinks the
 * ids the caller just deleted, and only from lists the caller can see.
 */
function prune_smart_lists_when_empty(array $deletedIds): void
{
    $ids = array_values(array_filter(array_map('to_int', $deletedIds), fn($i) => $i > 0));
    if (!$ids) return;

    $rows = db()->query('SELECT id, members, created_by FROM smart_lists')->fetchAll();
    foreach ($rows as $row) {
        // Admins maintain the shared/outlet lists; nobody else may edit them.
        if ((int)$row['created_by'] !== current_user_id() && !is_api_admin()) continue;

        $members = array_values(array_filter(array_map(
            'to_int',
            array_filter(explode(',', (string)($row['members'] ?? '')), 'strlen')
        )));
        if (!$members) continue;

        $kept = array_values(array_diff($members, $ids));
        if (count($kept) === count($members)) continue;

        db()->prepare('UPDATE smart_lists SET members = :members WHERE id = :id')
            ->execute([':members' => implode(',', $kept), ':id' => (int)$row['id']]);
    }
}

/** List all tags. */
function list_tags(): void
{
    $rows = db()->query('SELECT id, name, color FROM tags ORDER BY name')->fetchAll();
    respond(['data' => $rows]);
}

/** List campaigns, optionally filtered by status (active|paused|canceled|finished). */
function list_campaigns(array $filters): void
{
    $allowed = ['active', 'paused', 'canceled', 'finished'];
    $status = strtolower((string)($filters['status'] ?? ''));

    $where = '';
    $params = [];
    if ($status !== '' && in_array($status, $allowed, true)) {
        $where = ' WHERE status = :status';
        $params[':status'] = $status;
    }

    try {
        $stmt = db()->prepare('SELECT id, name, status, description, created_at FROM campaigns' . $where . ' ORDER BY name');
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    } catch (PDOException $e) {
        // Table not created yet -> treat as no campaigns rather than a hard error.
        $rows = [];
    }

    respond(['data' => $rows, 'count' => count($rows)]);
}

/** List workflows, optionally filtered by status (active|finished). */
function list_workflows(array $filters): void
{
    $allowed = ['active', 'finished'];
    $status = strtolower((string)($filters['status'] ?? ''));

    $where = '';
    $params = [];
    if ($status !== '' && in_array($status, $allowed, true)) {
        $where = ' WHERE status = :status';
        $params[':status'] = $status;
    }

    try {
        $stmt = db()->prepare('SELECT id, name, status, description, created_at FROM workflows' . $where . ' ORDER BY name');
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    } catch (PDOException $e) {
        // Table not created yet -> treat as no workflows rather than a hard error.
        $rows = [];
    }

    respond(['data' => $rows, 'count' => count($rows)]);
}

/** LEADS ONLY — quick way to find leads. */
function list_leads(array $filters): void
{
    ensure_list_indexes();
    $params = [];
    $clauses = [];

    if (!empty($filters['search'])) {
        $term = '%' . $filters['search'] . '%';
        $searchCols = ['name', 'phone', 'email', 'business_name', 'tags'];
        $pats = [];
        foreach ($searchCols as $i => $col) {
            $pname = ':search' . $i;
            $params[$pname] = $term;
            $pats[] = "$col LIKE $pname";
        }
        $clauses[] = '(' . implode(' OR ', $pats) . ')';
    }
    // Tenancy from the session, not from `?restrict_to=` (see build_where).
    $clauses[] = contact_scope_clause('', current_user_id(), $params, 'scope');
    $where = ' WHERE ' . implode(' AND ', $clauses);
    $order = order_clause($filters);

    $stmt = db()->prepare('SELECT * FROM v_leads' . $where . $order);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) {
        $row['tags'] = $row['tags'] !== '' ? explode(',', $row['tags']) : [];
        $row['tag_ids'] = $row['tag_ids'] !== '' ? array_map('to_int', explode(',', $row['tag_ids'])) : [];
        $row['custom_fields'] = decode_custom_fields($row['custom_fields'] ?? null);
    }

    respond(['data' => $rows, 'count' => count($rows)]);
}

/* ------------------ CONTACT SUB-RESOURCES ------------------ */

/**
 * Every contact sub-resource (opportunities, tasks, notes, appointments,
 * followers, activities) funnels through here, so this is the single place
 * that stops a dealer reading another dealer's contact by guessing an id.
 * Returns 404 rather than 403 so ids cannot be probed for existence.
 */
function ensure_contact_exists(int $contactId): void
{
    require_contact_access($contactId);
    $stmt = db()->prepare('SELECT id FROM contacts WHERE id = :id AND deleted_at IS NULL');
    $stmt->execute([':id' => $contactId]);
    if (!$stmt->fetch()) fail('Contact not found', 404);
}

function list_opportunities(int $contactId): void
{
    ensure_contact_exists($contactId);
    $stmt = db()->prepare('SELECT * FROM opportunities WHERE contact_id = :id ORDER BY created_at DESC');
    $stmt->execute([':id' => $contactId]);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) {
        $row['tags'] = $row['tags'] !== '' && $row['tags'] !== null
            ? array_values(array_filter(array_map('trim', explode(',', $row['tags']))))
            : [];
    }

    respond(['data' => $rows, 'count' => count($rows)]);
}

function create_opportunity(int $contactId, array $body): void
{
    ensure_contact_exists($contactId);

    $tagsInput = array_map('trim', (array)($body['tags'] ?? []));
    $tagsInput = array_values(array_filter($tagsInput, fn($t) => $t !== ''));

    $stmt = db()->prepare(
        'INSERT INTO opportunities (contact_id, name, pipeline, stage, status, value, business_name,
                                    source, expected_close_date, tags)
         VALUES (:c, :name, :pipeline, :stage, :status, :value, :biz, :source, :close, :tags)'
    );
    $stmt->execute([
        ':c' => $contactId,
        ':name' => normalize_optional($body['name'] ?? null) ?? 'New Opportunity',
        ':pipeline' => normalize_optional($body['pipeline'] ?? null) ?? 'Marketing Pipeline',
        ':stage' => normalize_optional($body['stage'] ?? null) ?? 'New Lead',
        ':status' => normalize_optional($body['status'] ?? null) ?? 'Open',
        ':value' => normalize_optional($body['value'] ?? null) ?? 'Rs 0',
        ':biz' => normalize_optional($body['business_name'] ?? null) ?? '',
        ':source' => normalize_optional($body['source'] ?? null) ?? '',
        ':close' => normalize_optional($body['expected_close_date'] ?? null) ?? '',
        ':tags' => $tagsInput ? implode(',', $tagsInput) : '',
    ]);
    respond(['data' => ['id' => (int)db()->lastInsertId()], 'message' => 'Opportunity created'], 201);
}

function delete_opportunity(int $id): void
{
    // Opportunities hang off a contact, so they inherit its tenancy: resolve the
    // parent contact and run the normal access guard instead of trusting a bare
    // opportunity id (which would let anybody delete any dealer's deal).
    require_child_contact_access('opportunities', $id);

    $stmt = db()->prepare('DELETE FROM opportunities WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if ($stmt->rowCount() === 0) fail('Opportunity not found', 404);
    respond(['message' => 'Opportunity deleted']);
}

function list_tasks(int $contactId): void
{
    ensure_contact_exists($contactId);
    $stmt = db()->prepare('SELECT * FROM tasks WHERE contact_id = :id ORDER BY created_at DESC');
    $stmt->execute([':id' => $contactId]);
    $rows = $stmt->fetchAll();
    respond(['data' => $rows, 'count' => count($rows)]);
}

function create_task(int $contactId, array $body): void
{
    ensure_contact_exists($contactId);
    $stmt = db()->prepare(
        'INSERT INTO tasks (contact_id, title, status, due_date) VALUES (:c, :title, :status, :due)'
    );
    $stmt->execute([
        ':c' => $contactId,
        ':title' => normalize_optional($body['title'] ?? null) ?? 'New task',
        ':status' => in_array($body['status'] ?? '', ['Pending', 'Done'], true) ? $body['status'] : 'Pending',
        ':due' => normalize_optional($body['due_date'] ?? null) ?? '',
    ]);
    respond(['data' => ['id' => (int)db()->lastInsertId()], 'message' => 'Task created'], 201);
}

/**
 * Resolve the parent contact of a child row and run the standard access guard.
 *
 * Tasks, notes, appointments and opportunities are addressed by their own id, so
 * without this a caller could read or delete any dealer's rows by guessing ids.
 * Returns the parent contact id, or 404s.
 */
function require_child_contact_access(string $table, int $id): int
{
    // $table is never user input - every call site passes a literal.
    $stmt = db()->prepare("SELECT contact_id FROM {$table} WHERE id = :id");
    $stmt->execute([':id' => $id]);
    $contactId = $stmt->fetchColumn();
    if ($contactId === false) fail('Not found', 404);
    require_contact_access((int)$contactId);
    return (int)$contactId;
}

function delete_task(int $id): void
{
    require_child_contact_access('tasks', $id);
    $stmt = db()->prepare('DELETE FROM tasks WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if ($stmt->rowCount() === 0) fail('Task not found', 404);
    respond(['message' => 'Task deleted']);
}

function list_notes(int $contactId): void
{
    ensure_contact_exists($contactId);
    $stmt = db()->prepare('SELECT * FROM notes WHERE contact_id = :id ORDER BY created_at DESC');
    $stmt->execute([':id' => $contactId]);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) {
        $row['attachments'] = $row['attachments'] !== '' && $row['attachments'] !== null
            ? array_values(array_filter(array_map('trim', explode(',', $row['attachments']))))
            : [];
    }

    respond(['data' => $rows, 'count' => count($rows)]);
}

function create_note(int $contactId, array $body): void
{
    ensure_contact_exists($contactId);

    $attachments = array_values(array_filter(
        array_map(fn($a) => trim((string)$a), (array)($body['attachments'] ?? [])),
        fn($a) => $a !== ''
    ));

    $stmt = db()->prepare(
        'INSERT INTO notes (contact_id, title, content, author, note_color, attachments, associated_to)
         VALUES (:c, :title, :content, :author, :color, :attachments, :assoc)'
    );
    $stmt->execute([
        ':c' => $contactId,
        ':title' => normalize_optional($body['title'] ?? null) ?? 'Note',
        ':content' => normalize_optional($body['content'] ?? null) ?? '',
        ':author' => normalize_optional($body['author'] ?? null) ?? 'Asad B Zaman',
        ':color' => normalize_optional($body['note_color'] ?? null) ?? '',
        ':attachments' => $attachments ? implode(',', $attachments) : '',
        ':assoc' => normalize_optional($body['associated_to'] ?? null) ?? '',
    ]);
    respond(['data' => ['id' => (int)db()->lastInsertId()], 'message' => 'Note created'], 201);
}

function delete_note(int $id): void
{
    require_child_contact_access('notes', $id);
    $stmt = db()->prepare('DELETE FROM notes WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if ($stmt->rowCount() === 0) fail('Note not found', 404);
    respond(['message' => 'Note deleted']);
}

function list_appointments(int $contactId): void
{
    ensure_contact_exists($contactId);
    $stmt = db()->prepare('SELECT * FROM appointments WHERE contact_id = :id ORDER BY created_at DESC');
    $stmt->execute([':id' => $contactId]);
    $rows = $stmt->fetchAll();
    respond(['data' => $rows, 'count' => count($rows)]);
}

function create_appointment(int $contactId, array $body): void
{
    ensure_contact_exists($contactId);
    $stmt = db()->prepare(
        'INSERT INTO appointments (contact_id, title, calendar, host, date, start_time, end_time,
                                   location, status, notes, category)
         VALUES (:c, :title, :cal, :host, :date, :st, :et, :loc, :status, :notes, :cat)'
    );
    $stmt->execute([
        ':c' => $contactId,
        ':title' => normalize_optional($body['title'] ?? null) ?? 'Appointment',
        ':cal' => normalize_optional($body['calendar'] ?? null) ?? '',
        ':host' => normalize_optional($body['host'] ?? null) ?? '',
        ':date' => normalize_optional($body['date'] ?? null) ?? '',
        ':st' => normalize_optional($body['start_time'] ?? null) ?? '',
        ':et' => normalize_optional($body['end_time'] ?? null) ?? '',
        ':loc' => normalize_optional($body['location'] ?? null) ?? '',
        ':status' => normalize_optional($body['status'] ?? null) ?? 'Completed',
        ':notes' => normalize_optional($body['notes'] ?? null),
        ':cat' => ($body['category'] ?? 'past') === 'upcoming' ? 'upcoming' : 'past',
    ]);
    respond(['data' => ['id' => (int)db()->lastInsertId()], 'message' => 'Appointment created'], 201);
}

function delete_appointment(int $id): void
{
    require_child_contact_access('appointments', $id);
    $stmt = db()->prepare('DELETE FROM appointments WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if ($stmt->rowCount() === 0) fail('Appointment not found', 404);
    respond(['message' => 'Appointment deleted']);
}

/**
 * List every appointment (used by the Sites analytics tab to count test-ride
 * bookings).
 *
 * Appointments carry customer names, notes and locations, so an unfiltered
 * dump is a cross-tenant read. Non-Admins get only the appointments belonging
 * to contacts they own or follow.
 */
function list_all_appointments(): void
{
    $params = [];
    $where = '';
    if (!is_api_admin()) {
        $params[':owner'] = current_user_id();
        $params[':follower'] = current_user_id();
        $where = 'WHERE a.contact_id IN (
            SELECT c.id FROM contacts c
             WHERE c.deleted_at IS NULL
               AND (c.assigned_to = :owner
                    OR c.id IN (SELECT contact_id FROM contact_followers WHERE staff_id = :follower))
        )';
    }

    $stmt = db()->prepare(
        'SELECT a.id, a.contact_id, a.title, a.calendar, a.host, a.date, a.start_time, a.end_time,
                a.location, a.status, a.notes, a.category, a.created_at
           FROM appointments a ' . $where . ' ORDER BY a.created_at DESC'
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    respond(['data' => $rows, 'count' => count($rows)]);
}

/* ------------------- STAFF USERS (My Staff) ------------------- */

/** Decode a stored JSON text column into a PHP array (or [] when empty). */
function decode_json_field(?string $raw): array
{
    if ($raw === null || $raw === '') return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/** Encode a PHP structure to JSON text (or null when empty). */
function encode_json_field($value): ?string
{
    if ($value === null) return null;
    if (is_array($value) && count($value) === 0) return null;
    $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return $json === false ? null : $json;
}

function list_staff(): void
{
    ensure_approval_column();

    // The staff directory carries emails, phones and permission JSON, so a full
    // dump is Admin-only. Everyone else gets a minimal picker list (id, name,
    // role) which is all the UI needs to show a name next to a record.
    if (!is_api_admin()) {
        $rows = db()->query(
            'SELECT id, first_name, last_name, full_name, user_type, avatar_data
               FROM staff_users
              WHERE approved = 1 OR approved IS NULL
              ORDER BY full_name'
        )->fetchAll();
        respond(['data' => $rows, 'count' => count($rows)]);
    }

    $rows = db()->query('SELECT * FROM staff_users ORDER BY full_name')->fetchAll();

    $payload = array_map('staff_payload', $rows);

    respond(['data' => $payload, 'count' => count($payload)]);
}

/** Common INSERT/UPDATE for a staff user; returns the staff id. */
function upsert_staff(array $body, ?int $existingId = null): int
{
    $firstName = normalize_optional($body['first_name'] ?? null);
    if ($firstName === null || $firstName === '') {
        fail('First name is required');
    }

    $phone = normalize_optional($body['phone'] ?? null);
    $email = normalize_optional($body['email'] ?? null);
    $lastName = normalize_optional($body['last_name'] ?? null);
    $extension = normalize_optional($body['extension'] ?? null);
    $calendar = normalize_optional($body['calendar'] ?? null);
    $systemId = normalize_optional($body['system_id'] ?? null);
    $signature = $body['signature'] ?? null;
    $avatarData = $body['avatar_data'] ?? null; // base64 data URI
    $restrictData = !empty($body['restrict_data']) ? 1 : 0;
    $userType = in_array($body['user_type'] ?? '', ['Admin', 'Dealer', 'Follower'], true) ? $body['user_type'] : 'Follower';
    // A Follower belongs to the Dealer who created them. Anyone else gets NULL.
    $managerId = null;
    if (isset($body['manager_id'])) {
        $managerId = $body['manager_id'] === null ? null : to_int((string)$body['manager_id']);
        if ($managerId !== null && $managerId <= 0) $managerId = null;
    }
    $rawPassword = isset($body['password']) && $body['password'] !== ''
        ? (string)$body['password']
        : null;
    $password = $rawPassword !== null ? hash_password($rawPassword) : null;
    if ($password !== null) ensure_password_plain_column();

    // No two staff users (admin/dealer/follower) may share an email or phone
    // number, so duplicate dealer/follower accounts can never be created.
    // The form can store several values ("a@x.com, b@y.com"), so every part is
    // checked; phones are compared digits-only to ignore formatting. Existing
    // accounts are never re-validated so legacy rows keep saving fine.
    $selfId = $existingId ?? 0;
    $splitValues = static function (?string $raw): array {
        if ($raw === null || trim($raw) === '') return [];
        return array_values(array_filter(array_map('trim', explode(',', $raw)), static fn($v) => $v !== ''));
    };
    $newEmails = $existingId === null ? $splitValues($email) : [];
    $newPhones = $existingId === null ? $splitValues($phone) : [];
    if ($newEmails || $newPhones) {
        $rows = db()->prepare('SELECT full_name, email, phone FROM staff_users WHERE id <> :self');
        $rows->execute([':self' => $selfId]);
        $takenEmails = [];
        $takenPhones = [];
        foreach ($rows->fetchAll() as $r) {
            foreach ($splitValues($r['email'] ?? null) as $e) {
                $takenEmails[strtolower($e)] = $r['full_name'];
            }
            foreach ($splitValues($r['phone'] ?? null) as $p) {
                $digits = preg_replace('/\D+/', '', $p);
                if ($digits !== '') $takenPhones[$digits] = $r['full_name'];
            }
        }
        foreach ($newEmails as $e) {
            $key = strtolower($e);
            if (isset($takenEmails[$key])) {
                fail('This email (' . $e . ') is already used by "' . trim((string)$takenEmails[$key]) . '". Please use a different email.', 409);
            }
        }
        foreach ($newPhones as $p) {
            $digits = preg_replace('/\D+/', '', $p);
            if ($digits !== '' && isset($takenPhones[$digits])) {
                fail('This phone number (' . $p . ') is already used by "' . trim((string)$takenPhones[$digits]) . '". Please use a different phone number.', 409);
            }
        }
    }

    $pdo = db();
    $fullName = trim($firstName . ' ' . ($lastName ?? ''));
    // Generated columns may not be assigned; let the DB compute full_name.
    $setFullName = !staff_full_name_generated();

    if ($existingId !== null) {
        // manager_id is only touched when explicitly provided so a follower's
        // own profile edit never detaches them from their dealer.
        $hasManager = array_key_exists('manager_id', $body);
        $stmt = $pdo->prepare(
            'UPDATE staff_users SET first_name = :fn, last_name = :ln'
                    . ($setFullName ? ', full_name = :full' : '') .
                    ', email = :email, phone = :phone,
                    extension = :ext, calendar = :cal, system_id = :sid, signature = :sig,
                    avatar_data = :avatar, restrict_data = :rd, user_type = :type'
                    . ($hasManager ? ', manager_id = :mgr' : '') .
                    ', call_voicemail = :cv, availability = :av, calendar_config = :cc, permissions = :perm
                    ' . ($password !== null ? ', password = :password, password_plain = :ppassword' : '') . '
             WHERE id = :id'
        );
        $params = [
            ':fn' => $firstName,
            ':ln' => $lastName,
            ':email' => $email,
            ':phone' => $phone,
            ':ext' => $extension,
            ':cal' => $calendar,
            ':sid' => $systemId,
            ':sig' => $signature,
            ':avatar' => $avatarData,
            ':rd' => $restrictData,
            ':type' => $userType,
            ':cv' => encode_json_field($body['call_voicemail'] ?? null),
            ':av' => encode_json_field($body['availability'] ?? null),
            ':cc' => encode_json_field($body['calendar_config'] ?? null),
            ':perm' => encode_json_field($body['permissions'] ?? null),
        ];
        if ($setFullName) $params[':full'] = $fullName;
        if ($hasManager) $params[':mgr'] = $managerId;
        if ($password !== null) {
            $params[':password'] = $password;
            $params[':ppassword'] = $rawPassword;
        }
        $params[':id'] = $existingId;
        $stmt->execute($params);
        if ($stmt->rowCount() === 0) {
            // Still succeeded if no columns changed, so verify existence.
            $check = $pdo->prepare('SELECT id FROM staff_users WHERE id = :id');
            $check->execute([':id' => $existingId]);
            if (!$check->fetch()) fail('Staff user not found', 404);
        }
        return $existingId;
    }

    $stmt = $pdo->prepare(
        'INSERT INTO staff_users (first_name, last_name'
                . ($setFullName ? ', full_name' : '') .
                ', email, phone, extension, calendar, system_id,
                                  signature, avatar_data, restrict_data, user_type, manager_id,
                                  call_voicemail, availability, calendar_config, permissions'
                                . ($password !== null ? ', password, password_plain' : '') . ')
         VALUES (:fn, :ln'
                . ($setFullName ? ', :full' : '') .
                ', :email, :phone, :ext, :cal, :sid, :sig, :avatar, :rd, :type, :mgr,
                 :cv, :av, :cc, :perm'
                . ($password !== null ? ', :password, :ppassword' : '') . ')'
    );
    $insertParams = [
        ':fn' => $firstName,
        ':ln' => $lastName,
        ':email' => $email,
        ':phone' => $phone,
        ':ext' => $extension,
        ':cal' => $calendar,
        ':sid' => $systemId,
        ':sig' => $signature,
        ':avatar' => $avatarData,
        ':rd' => $restrictData,
        ':type' => $userType,
        ':mgr' => $managerId,
        ':cv' => encode_json_field($body['call_voicemail'] ?? null),
        ':av' => encode_json_field($body['availability'] ?? null),
        ':cc' => encode_json_field($body['calendar_config'] ?? null),
        ':perm' => encode_json_field($body['permissions'] ?? null),
    ];
    if ($password !== null) {
        $insertParams[':password'] = $password;
        $insertParams[':ppassword'] = $rawPassword;
    }
    $stmt->execute($insertParams);
    return (int)$pdo->lastInsertId();
}

function create_staff(array $body): void
{
    require_api_admin();
    try {
        $id = upsert_staff($body, null);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') fail('Duplicate email already exists', 409);
        fail('Database error: ' . $e->getMessage(), 500);
    }
    respond(['data' => ['id' => $id], 'message' => 'Staff user created'], 201);
}

function update_staff(int $id, array $body): void
{
    // Editing somebody is Admin's job — except your own profile, which the
    // Settings page uses the same endpoint for. A non-Admin may only edit
    // themselves, and may never change their own role or approval state.
    $caller = require_api_user();
    if (($caller['user_type'] ?? '') !== 'Admin') {
        if ($id !== (int)$caller['id']) {
            fail('You can only update your own profile.', 403);
        }
        if (array_key_exists('user_type', $body) && (string)$body['user_type'] !== (string)$caller['user_type']) {
            fail('Only an administrator can change a user role.', 403);
        }
        if (array_key_exists('approved', $body) && (int)$body['approved'] !== (int)($caller['approved'] ?? 1)) {
            fail('Only an administrator can approve accounts.', 403);
        }
    }
    try {
        $updated = upsert_staff($body, $id);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') fail('Duplicate email already exists', 409);
        fail('Database error: ' . $e->getMessage(), 500);
    }
    respond(['data' => ['id' => $updated], 'message' => 'Staff user updated']);
}

function delete_staff(int $id): void
{
    require_api_admin();
    $stmt = db()->prepare('DELETE FROM staff_users WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if ($stmt->rowCount() === 0) fail('Staff user not found', 404);
    respond(['message' => 'Staff user deleted']);
}

/** Update a contact: mainly for assigning a staff owner (assigned_to). */
function update_contact(int $id, array $body): void
{
    ensure_contact_exists($id);

    // Verify assigned staff exists when provided.
    $assignedTo = null;
    if (array_key_exists('assigned_to', $body)) {
        $assignedTo = $body['assigned_to'] === null ? null : to_int((string)$body['assigned_to']);
        if ($assignedTo !== null && $assignedTo > 0) {
            $check = db()->prepare('SELECT id FROM staff_users WHERE id = :id');
            $check->execute([':id' => $assignedTo]);
            if (!$check->fetch()) fail('Assigned staff user not found', 404);
        }
    }

    // Reassigning a contact decides who owns it, so it is an Admin-only move.
    // Without this a dealer could hand (or dump) a contact into somebody else's
    // pipeline, or strip the owner to make it vanish from the dealer's list.
    if (array_key_exists('assigned_to', $body) && !is_api_admin()) {
        fail('Only an administrator can assign or reassign a contact.', 403);
    }

    $allowed = ['first_name', 'last_name', 'phone', 'email', 'business_name', 'contact_type', 'notes', 'avatar_data'];
    $sets = [];
    $params = [':id' => $id];

    foreach ($allowed as $field) {
        if (array_key_exists($field, $body)) {
            $value = normalize_optional($body[$field]);
            if ($field === 'contact_type') {
                $value = in_array($value ?? '', ['Lead', 'Customer', 'Vendor', 'Partner'], true) ? $value : '';
            }
            $sets[] = "$field = :$field";
            $params[":$field"] = $value;
        }
    }

    if (array_key_exists('custom_fields', $body)) {
        $sets[] = 'custom_fields = :custom_fields';
        $params[':custom_fields'] = normalize_custom_fields($body['custom_fields']);
    }

    // Replace the full tag set when the request includes a "tags" list.
    if (array_key_exists('tags', $body)) {
        $tagInput = array_values(array_filter(
            array_map(fn($t) => trim((string)$t), (array)$body['tags']),
            fn($t) => $t !== ''
        ));
        $pdo = db();
        $pdo->prepare('DELETE FROM contact_tags WHERE contact_id = :id')->execute([':id' => $id]);
        foreach ($tagInput as $tagName) {
            $tagId = ensure_tag($pdo, $tagName);
            if ($tagId > 0) {
                $pdo->prepare('INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (:c, :t)')
                    ->execute([':c' => $id, ':t' => $tagId]);
            }
        }
        // Keep is_lead consistent with the new tag set / contact type.
        $lead = ($body['contact_type'] ?? '') === 'Lead'
            || in_array('warm lead', $tagInput, true)
            || in_array('hot lead', $tagInput, true)
            || in_array('cold lead', $tagInput, true);
        $sets[] = 'is_lead = :is_lead';
        $params[':is_lead'] = $lead ? 1 : 0;
    }

    if ($assignedTo !== null || array_key_exists('assigned_to', $body)) {
        $sets[] = 'assigned_to = :assigned_to';
        $params[':assigned_to'] = $assignedTo;
    }

    if (!$sets) fail('No fields to update');

    $pdo = db();
    $pdo->beginTransaction();
    try {
        // Capture the previous owner + contact name so we only notify on change.
        $prev = $pdo->prepare('SELECT assigned_to, full_name FROM contacts WHERE id = :id');
        $prev->execute([':id' => $id]);
        $prevRow = $prev->fetch();
        $prevOwner = $prevRow ? (int)($prevRow['assigned_to'] ?? 0) : 0;
        $contactName = $prevRow['full_name'] ?? 'Contact';

        $stmt = $pdo->prepare('UPDATE contacts SET ' . implode(', ', $sets) . ' WHERE id = :id');
        $stmt->execute($params);

        // Mutual exclusion: the new owner can no longer be a follower.
        if ($assignedTo !== null && $assignedTo > 0) {
            $pdo->prepare('DELETE FROM contact_followers WHERE contact_id = :c AND staff_id = :s')
                ->execute([':c' => $id, ':s' => $assignedTo]);
        }

        $pdo->commit();

        // Notify the new owner only when the assignment actually changed.
        if ($assignedTo !== null && $assignedTo > 0 && $assignedTo !== $prevOwner) {
            notify_staff(
                $assignedTo,
                $id,
                'lead_assigned',
                'New lead assigned to you',
                $contactName . ' has been assigned to you.'
            );
        }
    } catch (PDOException $e) {
        $pdo->rollBack();
        fail('Database error: ' . $e->getMessage(), 500);
    }

    respond(['data' => ['id' => $id], 'message' => 'Contact updated']);
}

/** List the staff users following a contact. */
function list_followers(int $contactId): void
{
    ensure_contact_exists($contactId);
    $rows = db()->prepare(
        'SELECT s.id, s.first_name, s.last_name, s.full_name, s.user_type, s.avatar_data
           FROM contact_followers cf
           JOIN staff_users s ON s.id = cf.staff_id
          WHERE cf.contact_id = :id
          ORDER BY s.full_name'
    );
    $rows->execute([':id' => $contactId]);
    respond(['data' => $rows->fetchAll(), 'count' => $rows->rowCount()]);
}

/**
 * Add a follower.
 *
 * Admin-only, and deliberately refuses to strip an existing owner. Follower
 * rows are what grant a Dealer/Follower visibility of somebody else's contact,
 * so letting anyone add themselves as a follower would have made the whole
 * tenancy rule meaningless (and nulling assigned_to hid the contact from its
 * owner as a side effect).
 */
function add_follower(int $contactId, array $body): void
{
    require_api_admin();
    ensure_contact_exists($contactId);
    $staffId = to_int((string)($body['staff_id'] ?? 0));
    if ($staffId <= 0) fail('staff_id is required');

    $check = db()->prepare('SELECT id FROM staff_users WHERE id = :id');
    $check->execute([':id' => $staffId]);
    if (!$check->fetch()) fail('Staff user not found', 404);

    $pdo = db();
    $nmStmt = $pdo->prepare('SELECT full_name, assigned_to FROM contacts WHERE id = :id');
    $nmStmt->execute([':id' => $contactId]);
    $nmRow = $nmStmt->fetch();
    $contactName = $nmRow['full_name'] ?? 'Contact';

    // Owner and follower are mutually exclusive. Ask the Admin to reassign the
    // contact first rather than silently cancelling the ownership.
    if ((int)($nmRow['assigned_to'] ?? 0) === $staffId) {
        fail('This person already owns the contact. Reassign it before sharing it as a follower.', 409);
    }

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('INSERT IGNORE INTO contact_followers (contact_id, staff_id) VALUES (:c, :s)');
        $stmt->execute([':c' => $contactId, ':s' => $staffId]);
        $added = $stmt->rowCount() > 0;
        $pdo->commit();

        if ($added) {
            notify_staff(
                $staffId,
                $contactId,
                'follower_added',
                'You are now following a contact',
                'You have been added as a follower of ' . $contactName . '.'
            );
        }
    } catch (PDOException $e) {
        $pdo->rollBack();
        fail('Database error: ' . $e->getMessage(), 500);
    }

    respond(['message' => 'Follower added'], 201);
}

/** Remove a follower. Admin-only. */
function remove_follower(int $contactId, int $staffId): void
{
    require_api_admin();
    ensure_contact_exists($contactId);
    $stmt = db()->prepare('DELETE FROM contact_followers WHERE contact_id = :c AND staff_id = :s');
    $stmt->execute([':c' => $contactId, ':s' => $staffId]);
    if ($stmt->rowCount() === 0) fail('Follower not found', 404);
    respond(['message' => 'Follower removed']);
}

/** List persisted activity entries for a contact. */
function list_activities(int $contactId): void
{
    ensure_contact_exists($contactId);
    $rows = db()->prepare(
        'SELECT id, type, title, detail, created_at
           FROM contact_activities
          WHERE contact_id = :id
          ORDER BY created_at DESC, id DESC'
    );
    $rows->execute([':id' => $contactId]);
    respond(['data' => $rows->fetchAll(), 'count' => $rows->rowCount()]);
}

/** Persist an activity entry for a contact (date/time + URL detail). */
function create_activity(int $contactId, array $body): void
{
    ensure_contact_exists($contactId);
    $type = normalize_optional($body['type'] ?? null) ?? 'contact';
    $title = normalize_optional($body['title'] ?? null);
    $detail = normalize_optional($body['detail'] ?? null);
    if ($title === null) fail('title is required');

    $pdo = db();
    $stmt = $pdo->prepare(
        'INSERT INTO contact_activities (contact_id, type, title, detail, created_at)
         VALUES (:c, :type, :title, :detail, NOW())'
    );
    $stmt->execute([':c' => $contactId, ':type' => $type, ':title' => $title, ':detail' => $detail]);

    respond(['data' => ['id' => (int)$pdo->lastInsertId()], 'message' => 'Activity logged']);
}

/* ----------------------- AUTH & NOTIFICATIONS ----------------------- */

/* ------------------- SERVER-SIDE IDENTITY (multi-tenancy) -------------------
 *
 * Every read and write below is scoped from these helpers. The identity comes
 * from a bearer token minted at login — never from a query string — so a
 * Dealer or Follower cannot widen their own visibility by editing a URL.
 *
 * Rules enforced here:
 *   Admin    -> sees and manages everything.
 *   Dealer   -> sees only contacts assigned to them, plus contacts an Admin
 *               has explicitly shared with them as a follower.
 *   Follower -> same rule as Dealer. A Follower never inherits their manager's
 *               (the Dealer's) book, so "apna data" means exactly that.
 *
 * Contacts with no assigned_to are invisible to everyone except Admins. That
 * is the unassigned pool: public website forms and CSV imports land there and
 * stay there until an Admin assigns them to a dealer.
 */

/** Create the tables the scoping rules depend on. Idempotent, runs once/request. */
function ensure_identity_tables(): void
{
    static $done = false;
    if ($done) return;
    $done = true;

    db()->exec(
        'CREATE TABLE IF NOT EXISTS contact_followers (
            contact_id INT NOT NULL,
            staff_id   INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (contact_id, staff_id),
            INDEX idx_cf_staff (staff_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );

    db()->exec(
        'CREATE TABLE IF NOT EXISTS staff_sessions (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            staff_id   INT NOT NULL,
            token_hash CHAR(64) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NULL,
            UNIQUE KEY uq_staff_sessions_token (token_hash),
            INDEX idx_staff_sessions_staff (staff_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
}

/** Mint a session token for a staff user. Only the SHA-256 is stored. */
function issue_api_token(int $staffId): string
{
    ensure_identity_tables();
    $token = bin2hex(random_bytes(32));
    $stmt = db()->prepare(
        'INSERT INTO staff_sessions (staff_id, token_hash, expires_at)
         VALUES (:sid, :hash, DATE_ADD(NOW(), INTERVAL 30 DAY))'
    );
    $stmt->execute([':sid' => $staffId, ':hash' => hash('sha256', $token)]);
    return $token;
}

/** Revoke a session token (used by /auth/logout). */
function revoke_api_token(string $token): void
{
    ensure_identity_tables();
    db()->prepare('DELETE FROM staff_sessions WHERE token_hash = :hash')
        ->execute([':hash' => hash('sha256', $token)]);
}

/** Read the bearer token off the request, if the browser sent one. */
function api_bearer_token(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach ($headers as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) {
                $header = (string)$value;
                break;
            }
        }
    }
    if (stripos($header, 'Bearer ') !== 0) return null;
    $token = trim(substr($header, 7));
    return $token === '' ? null : $token;
}

/**
 * Resolve the caller from the bearer token, honouring an Admin's "Login as"
 * impersonation. Returns null when there is no valid session.
 *
 * Impersonation is request-scoped rather than a second token: the Admin's own
 * token stays in play and X-Acting-As only takes effect for an Admin, so a
 * Dealer cannot smuggle in somebody else's identity.
 */
function api_current_user(): ?array
{
    static $resolved = false;
    static $user = null;
    if ($resolved) return $user;
    $resolved = true;

    $token = api_bearer_token();
    if ($token === null) return null;

    ensure_identity_tables();
    $stmt = db()->prepare(
        'SELECT s.* FROM staff_sessions ss
           JOIN staff_users s ON s.id = ss.staff_id
          WHERE ss.token_hash = :hash
            AND (ss.expires_at IS NULL OR ss.expires_at > NOW())'
    );
    $stmt->execute([':hash' => hash('sha256', $token)]);
    $actor = $stmt->fetch();
    if (!$actor) return null;
    // A deactivated or re-typed account loses access immediately.
    if (isset($actor['approved']) && (int)$actor['approved'] !== 1) return null;

    $actingId = (int)($_SERVER['HTTP_X_ACTING_AS'] ?? 0);
    if ($actingId > 0 && $actingId !== (int)$actor['id']) {
        if (($actor['user_type'] ?? '') !== 'Admin') {
            fail('Only an Admin may view the CRM as another user.', 403);
        }
        $imp = db()->prepare('SELECT * FROM staff_users WHERE id = :id');
        $imp->execute([':id' => $actingId]);
        $target = $imp->fetch();
        if (!$target) fail('The user being viewed no longer exists.', 404);
        if (isset($target['approved']) && (int)$target['approved'] !== 1) {
            fail('That account is pending approval and cannot be viewed.', 403);
        }
        $target['_impersonated_by'] = (int)$actor['id'];
        $user = $target;
    } else {
        $user = $actor;
    }
    return $user;
}

/** The caller, or 401. Use at the top of every non-public endpoint. */
function require_api_user(): array
{
    $user = api_current_user();
    if ($user === null) {
        fail('Your session has expired. Please sign in again.', 401);
    }
    return $user;
}

/** The caller, or 403 unless they are an Admin. */
function require_api_admin(): array
{
    $user = require_api_user();
    if (($user['user_type'] ?? '') !== 'Admin') {
        fail('This action is restricted to administrators.', 403);
    }
    return $user;
}

/** Effective staff id of the caller (the impersonated user when acting). */
function current_user_id(): int
{
    $user = require_api_user();
    return (int)$user['id'];
}

function is_api_admin(): bool
{
    $user = api_current_user();
    return $user !== null && ($user['user_type'] ?? '') === 'Admin';
}

/* -------------------------- contact tenancy rules -------------------------- */

/**
 * SQL fragment (with its placeholders) limiting a contacts query to what the
 * caller may see. Admins get an always-true clause; everyone else is limited
 * to rows assigned to them or shared with them as a follower, so unassigned
 * leads stay out of sight until an Admin hands them over.
 *
 * $alias is the contacts table/view alias in the calling query.
 */
function contact_scope_clause(string $alias, int $userId, array &$params, string $prefix): string
{
    // Fail CLOSED, never open. An unknown user id (an anonymous caller, or a
    // session that resolved to nothing) must see nothing - returning 1 = 1
    // here would hand the whole book to anybody who reached this function.
    if ($userId <= 0) return '1 = 0';
    if (is_api_admin()) return '1 = 1';

    // The prefix names the placeholders; the leading colon is ours to add.
    // Callers used to pass ':scope', and the leading colon ended up in the SQL
    // too ('::scopeowner'), which is a syntax error. Strip it here.
    $prefix = ltrim($prefix, ':');
    // Likewise the alias needs its dot ('c' -> 'c.'), or the column comes out
    // as one long name ('cassigned_to').
    if ($alias !== '') $alias = rtrim($alias, '.') . '.';

    $params[':' . $prefix . 'owner'] = $userId;
    $params[':' . $prefix . 'follower'] = $userId;
    // Two distinct placeholder names: native prepares reject a reused name.
    return "({$alias}assigned_to = :{$prefix}owner"
        . " OR {$alias}id IN (SELECT contact_id FROM contact_followers WHERE staff_id = :{$prefix}follower))";
}

/**
 * True when the caller may touch this contact.
 *
 * An anonymous caller (the public website form) gets false rather than a 401,
 * so it simply never merges into an existing record - it always files a fresh
 * lead instead of overwriting somebody else's.
 */
function caller_can_access_contact(int $contactId): bool
{
    $user = api_current_user();
    if ($user === null) return false;
    if (($user['user_type'] ?? '') === 'Admin') return true;
    $params = [':cid' => $contactId];
    $clause = contact_scope_clause('c', (int)$user['id'], $params, 'who');
    $stmt = db()->prepare("SELECT 1 FROM contacts c WHERE c.id = :cid AND {$clause} LIMIT 1");
    $stmt->execute($params);
    return (bool)$stmt->fetchColumn();
}

/** Guard for a single-contact route; 404s so ids cannot be probed. */
function require_contact_access(int $contactId): void
{
    if (!caller_can_access_contact($contactId)) {
        fail('Contact not found', 404);
    }
}

/** Ids of every contact the caller may see — used to trim shared lists. */
function accessible_contact_ids(int $userId): array
{
    // Fail closed: an unresolved user sees nothing (see contact_scope_clause).
    if ($userId <= 0) return [];
    if (is_api_admin()) {
        $rows = db()->query('SELECT id FROM contacts WHERE deleted_at IS NULL')->fetchAll();
        return array_map(static fn($r) => (int)$r['id'], $rows);
    }
    $stmt = db()->prepare(
        'SELECT c.id FROM contacts c
          WHERE c.deleted_at IS NULL
            AND (c.assigned_to = :owner
                 OR c.id IN (SELECT contact_id FROM contact_followers WHERE staff_id = :follower))'
    );
    $stmt->execute([':owner' => $userId, ':follower' => $userId]);
    return array_map(static fn($r) => (int)$r['id'], $stmt->fetchAll());
}

/** Shape a staff row for API responses: decode JSON fields, hide password. */
function staff_payload(array $row): array
{
    unset($row['password'], $row['password_plain']);
    $row['call_voicemail'] = decode_json_field($row['call_voicemail'] ?? null);
    $row['availability'] = decode_json_field($row['availability'] ?? null);
    $row['calendar_config'] = decode_json_field($row['calendar_config'] ?? null);
    $row['permissions'] = decode_json_field($row['permissions'] ?? null);
    return $row;
}

/**
 * Signed, stateless one-click login token for approval emails.
 * Payload = email|expiry|HMAC(password_hash). Valid for 30 minutes and
 * automatically invalidated the moment the account's password changes.
 */
function make_login_token(array $row): string
{
    $expires = (string)(time() + 1800);
    $payload = ($row['email'] ?? '') . '|' . $expires;
    $sig = hash_hmac('sha256', $payload, ($row['password'] ?? '') . '|yadea-magic-login');
    return rtrim(strtr(base64_encode($payload . '|' . $sig), '+/', '-_'), '=');
}

/** Validate a magic login token; returns the staff row or null. */
function verify_login_token(string $token): ?array
{
    $raw = base64_decode(strtr($token, '-_', '+/'), true);
    if ($raw === false) return null;
    $parts = explode('|', $raw);
    if (count($parts) !== 3) return null;
    [$email, $expires, $sig] = $parts;
    if (!ctype_digit($expires) || (int)$expires < time() || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return null;
    }
    $stmt = db()->prepare('SELECT * FROM staff_users WHERE email = :email LIMIT 1');
    $stmt->execute([':email' => $email]);
    $row = $stmt->fetch();
    if (!$row) return null;
    $expected = hash_hmac('sha256', $email . '|' . $expires, ($row['password'] ?? '') . '|yadea-magic-login');
    if (!hash_equals($expected, $sig)) return null;
    return $row;
}

/** POST /auth/magic-login { token } -> session payload like /auth/login. */
function magic_login(array $body): void
{
    $token = trim((string)($body['token'] ?? ''));
    if ($token === '') fail('Token is required', 400);
    $row = verify_login_token($token);
    if (!$row) fail('This login link is invalid or has expired. Please sign in manually.', 401);
    if ((int)($row['approved'] ?? 1) !== 1) {
        fail('Your account is pending admin approval.', 403);
    }
    respond([
        'data' => staff_payload($row),
        'token' => issue_api_token((int)$row['id']),
        'message' => 'Login successful',
    ]);
}

/** POST /auth/login  { email, password } -> the staff user, a token, or 401. */
function login(array $body): void
{
    $email = normalize_optional($body['email'] ?? null);
    $password = (string)($body['password'] ?? '');
    if ($email === null || $password === '') {
        fail('Email and password are required', 400);
    }

    $stmt = db()->prepare('SELECT * FROM staff_users WHERE email = :email LIMIT 1');
    $stmt->execute([':email' => $email]);
    $row = $stmt->fetch();
    if (!$row || !verify_password($password, $row['password'] ?? null)) {
        fail('Invalid email or password', 401);
    }
    // Accounts created through public registration stay locked until an
    // Admin approves them under Settings -> My Staff.
    if (isset($row['approved']) && (int)$row['approved'] !== 1) {
        fail('Your account is pending admin approval. You will receive an email once it is approved.', 403);
    }

    respond([
        'data' => staff_payload($row),
        'token' => issue_api_token((int)$row['id']),
        'message' => 'Login successful',
    ]);
}

/** POST /auth/logout -> drop the presented session token. */
function logout(): void
{
    $token = api_bearer_token();
    if ($token !== null) revoke_api_token($token);
    respond(['message' => 'Signed out']);
}

/** GET /auth/me -> the caller, so the client can rehydrate a stale session. */
function auth_me(): void
{
    respond(['data' => staff_payload(require_api_user())]);
}

/**
 * Lazy migration: staff_users.password_plain keeps a recoverable copy of the
 * password so auto-provisioned dealers can see it again in account settings.
 */
function ensure_password_plain_column(): void
{
    static $done = false;
    if ($done) return;
    $done = true;
    $check = db()->prepare(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME   = 'staff_users'
            AND COLUMN_NAME  = 'password_plain'"
    );
    $check->execute();
    if ((int)$check->fetchColumn() === 0) {
        db()->exec(
            "ALTER TABLE staff_users ADD COLUMN password_plain VARCHAR(255) DEFAULT NULL AFTER password"
        );
    }
}

/**
 * Lazy migration: staff_users.approved gates logins. Defaults to 1 so
 * admin-created staff are never locked out; public registrations insert 0
 * and wait for an Admin to approve them under Settings -> My Staff.
 */
function ensure_approval_column(): void
{
    static $done = false;
    if ($done) return;
    $done = true;
    $check = db()->prepare(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME   = 'staff_users'
            AND COLUMN_NAME  = 'approved'"
    );
    $check->execute();
    if ((int)$check->fetchColumn() === 0) {
        db()->exec(
            "ALTER TABLE staff_users ADD COLUMN approved TINYINT(1) NOT NULL DEFAULT 1 AFTER password_plain"
        );
    }
}

/**
 * True when staff_users.full_name is a GENERATED column on this server. In
 * that case INSERT/UPDATE must NOT supply a value for it (MariaDB errors with
 * the value being "ignored"); the server computes it from first/last name.
 * Schema-agnostic so local XAMPP and production stay in sync.
 */
function staff_full_name_generated(): bool
{
    static $gen = null;
    if ($gen !== null) return $gen;
    $gen = false;
    try {
        $col = db()->prepare("SHOW COLUMNS FROM staff_users LIKE 'full_name'");
        $col->execute();
        $row = $col->fetch();
        $gen = $row !== false && stripos((string)($row['Extra'] ?? ''), 'generated') !== false;
    } catch (Throwable $e) {
        // Column/table missing or locked: fall back to explicit writes.
    }
    return $gen;
}

/**
 * Soft-delete support for contacts: DELETE always keeps the row, it just stamps
 * deleted_at so the live views hide it. Idempotent migration (safe to run on
 * every request) that (1) adds contacts.deleted_at when missing and (2) rebuilds
 * v_contacts_with_tags / v_leads to exclude soft-deleted rows. The rebuilt views
 * match the production shape (custom_fields + assigned_to staff join).
 */
function ensure_soft_delete_support(): void
{
    static $done = false;
    if ($done) return;
    $done = true;

    $pdo = db();

    // 1) Column migration.
    $colCheck = $pdo->prepare(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME   = 'contacts'
            AND COLUMN_NAME  = 'deleted_at'"
    );
    $colCheck->execute();
    if ((int)$colCheck->fetchColumn() === 0) {
        $pdo->exec('ALTER TABLE contacts ADD COLUMN deleted_at DATETIME DEFAULT NULL AFTER notes');
    }

    // 2) View migration: rebuild only when the view still lacks deleted_at (idempotent).
    $viewCheck = $pdo->prepare(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME   = 'v_contacts_with_tags'
            AND COLUMN_NAME  = 'deleted_at'"
    );
    $viewCheck->execute();
    if ((int)$viewCheck->fetchColumn() > 0) return;

    $pdo->exec('DROP VIEW IF EXISTS v_leads');
    $pdo->exec('DROP VIEW IF EXISTS v_contacts_with_tags');
    $pdo->exec(
        "CREATE VIEW v_contacts_with_tags AS
         SELECT
           c.id,
           c.full_name            AS name,
           c.first_name,
           c.last_name,
           c.phone,
           c.email,
           c.business_name,
           c.contact_type,
           c.is_lead,
           c.avatar_color,
           c.avatar_data,
           c.assigned_to,
           CONCAT(s.first_name, ' ', s.last_name) AS assigned_to_name,
           s.avatar_data AS assigned_to_avatar,
           c.notes,
           c.deleted_at,
           c.custom_fields,
           c.created_at,
           c.last_activity_at,
           c.updated_at,
           COALESCE(GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ','), '') AS tags,
           COALESCE(GROUP_CONCAT(t.id   ORDER BY t.name SEPARATOR ','), '') AS tag_ids
         FROM contacts c
         LEFT JOIN staff_users s ON s.id = c.assigned_to
         LEFT JOIN contact_tags ct ON ct.contact_id = c.id
         LEFT JOIN tags t         ON t.id         = ct.tag_id
         WHERE c.deleted_at IS NULL
         GROUP BY c.id"
    );
    $pdo->exec(
        "CREATE VIEW v_leads AS
         SELECT *
         FROM v_contacts_with_tags
         WHERE is_lead = 1
            OR contact_type = 'Lead'
            OR FIND_IN_SET('warm lead', tags)
            OR FIND_IN_SET('hot lead',  tags)
            OR FIND_IN_SET('cold lead', tags)"
    );
}

/**
 * Branded confirmation email sent to a dealer right after they submit the
 * dealership form. Includes their website credentials (when known) and tells
 * them whether they can already log in or must wait for admin approval.
 */
function send_dealer_registration_mail(string $email, string $name, ?string $plain, bool $approved): void
{
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        mail_debug_log('dealer-credentials SKIPPED invalid email ' . $email);
        return;
    }
    $esc = static fn ($v): string => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');

    $p = 'style="margin:0 0 12px 0;font-size:14px;line-height:22px;color:#334155;"';
    $html = '<p ' . $p . '>Hi ' . $esc($name !== '' ? $name : 'there') . ',</p>'
        . '<p ' . $p . '>Thank you for registering as a dealer with <strong>Yadea Pakistan</strong>. '
        . 'We have received your dealership registration form successfully.</p>';

    if ($plain !== null && $plain !== '') {
        $html .= '<p style="margin:0 0 8px 0;font-size:14px;color:#334155;">Your website account details:</p>'
            . '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 16px 0;">'
            . '<tr><td style="padding:10px 14px 4px 14px;font-size:13px;color:#334155;"><strong>Email:</strong> ' . $esc($email) . '</td></tr>'
            . '<tr><td style="padding:4px 14px 10px 14px;font-size:13px;color:#334155;"><strong>Password:</strong> ' . $esc($plain) . '</td></tr>'
            . '</table>';
    }

    if ($approved) {
        $html .= '<p ' . $p . '>Your account is already <strong style="color:#059669;">active</strong> — you can log in anytime using the details above.</p>';
    } else {
        $html .= '<p ' . $p . '>Your account is currently <strong style="color:#B45309;">pending administrator approval</strong>. '
            . 'Login stays disabled until our team approves your registration — you will receive a second email '
            . 'with a login button as soon as that happens.</p>';
    }

    $credsOk = send_app_mail($email, $name, 'We received your dealership registration', $html);
    mail_debug_log('dealer-credentials mail to ' . $email . ' -> ' . ($credsOk ? 'SENT' : 'FAILED'));

    // Team-facing copy: the CRM mailbox (and any configured notify addresses)
    // always learn about a new dealer registration (Admins are already
    // notified separately in register_dealer).
    if (mail_notify_recipients() !== []) {
        $teamHtml = '<p style="margin:0 0 12px 0;font-size:14px;line-height:22px;color:#334155;">A new dealership registration was received from <strong>'
            . $esc($name !== '' ? $name : 'a visitor') . '</strong> (' . $esc($email) . ').</p>'
            . ($approved
                ? '<p style="margin:0;font-size:14px;line-height:22px;color:#334155;">The account is already <strong style="color:#059669;">active</strong> and the submitter was emailed their login credentials.</p>'
                : '<p style="margin:0;font-size:14px;line-height:22px;color:#334155;">The account is <strong style="color:#B45309;">awaiting approval</strong>. Approve it under Settings -&gt; My Staff so the submitter can log in.</p>');
        foreach (mail_notify_recipients() as $notifyTo) {
            $regOk = send_app_mail(
                $notifyTo,
                'Yadea Pakistan CRM',
                'New dealership registration — ' . ($name !== '' ? $name : $email),
                $teamHtml
            );
            mail_debug_log('dealer-notify ' . ($email !== '' ? $email : 'no-email') . ' -> ' . $notifyTo . ' (ok=' . ($regOk ? '1' : '0') . ')');
        }
    }
}

/**
 * Team-facing email for ANY website/submission form. Sends a detail copy to
 * the CRM mailbox (SMTP_USER) and notifies every Admin (portal bell + email).
 * $fields is a flat ['label' => value] map (empty values skipped).
 * $skipAdmin suppresses the Admin notifications for callers that already
 * notify admins themselves (e.g. dealer registration).
 */
function notify_form_submission_mail(array $fields, string $label, string $ref, string $type, bool $skipAdmin = false): void
{
    $esc = static fn ($v): string => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');

    $rows = '';
    foreach ($fields as $field => $value) {
        if ($value === null || trim((string)$value) === '') continue;
        $rows .= '<tr>'
            . '<td style="padding:8px 12px;font-size:13px;color:#475569;white-space:nowrap;vertical-align:top;">' . $esc($field) . '</td>'
            . '<td style="padding:8px 12px;font-size:13px;color:#1e293b;word-break:break-word;">' . $esc($value) . '</td>'
            . '</tr>';
    }

    $who = trim((string)($fields['Name'] ?? ''));
    if ($who === '') $who = trim((string)($fields['Business'] ?? ''));
    if ($who === '') $who = 'Unnamed submitter';

    $notifyHtml = '<p style="margin:0 0 14px 0;font-size:14px;line-height:22px;color:#334155;">A new '
        . $label . ' was just submitted' . ($ref !== '' ? ' (' . $esc($ref) . ')' : '') . ':</p>'
        . '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 16px 0;">'
        . $rows . '</table>'
        . '<p style="margin:0;font-size:13px;line-height:20px;color:#64748b;">Open the CRM to review, assign, and manage this submission.</p>';

    foreach (mail_notify_recipients() as $notifyTo) {
        $okFormMail = send_app_mail(
            $notifyTo,
            'Yadea Pakistan CRM',
            $label . ($ref !== '' ? ' ' . $esc($ref) : '') . ' — ' . $who,
            $notifyHtml
        );
        mail_debug_log('form-notify ' . ($ref !== '' ? $ref : $label) . ' -> ' . $notifyTo . ' (ok=' . ($okFormMail ? '1' : '0') . ')');
    }

    if ($skipAdmin) return;

    $loc = trim((string)($fields['City'] ?? ''));
    $detail = $who . ($loc !== '' ? ', ' . $loc : '')
        . ' — ' . $label . ' submitted. Open the CRM to review.';
    $adminIds = db()->query("SELECT id FROM staff_users WHERE user_type = 'Admin'")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($adminIds as $adminId) {
        notify_staff((int)$adminId, null, $type, $label, $detail);
    }
}

/**
 * Bridge between a public custom form (create_contact with a form_submissions
 * custom field) and notify_form_submission_mail. Builds the field map from
 * the submitted values plus the contact-level name/email/phone/business.
 */
function notify_form_submission_from_contact(
    string $formName,
    array $submission,
    ?string $firstName,
    ?string $lastName,
    ?string $email,
    ?string $phone,
    ?string $business
): void {
    $fields = ['Form' => $formName];
    if (is_array($submission['values'] ?? null)) {
        foreach ($submission['values'] as $k => $v) {
            $fields[(string)$k] = $v;
        }
    }
    if (trim((string)($fields['Name'] ?? '')) === '') {
        $full = trim(($firstName ?? '') . ' ' . ($lastName ?? ''));
        if ($full !== '') $fields['Name'] = $full;
    }
    if (!isset($fields['Email'])) $fields['Email'] = $email ?? '';
    if (!isset($fields['Phone'])) $fields['Phone'] = $phone ?? '';
    if (!isset($fields['Business'])) $fields['Business'] = $business ?? '';

    // Dealer-named forms already notify Admins themselves (register_dealer),
    // so skip the duplicate Admin notification there; mailbox copy still goes.
    notify_form_submission_mail(
        $fields,
        'Form submission — ' . $formName,
        '',
        'form_submitted',
        (bool)preg_match('/dealer/i', $formName)
    );
}

/**
 * POST /auth/register-dealer
 * Public endpoint used by the Dealership Registration form: finds or creates
 * a Dealer staff account for the submitted email and returns it together with
 * the working password so the website can log the dealer in automatically.
 */
function register_dealer(array $body): void
{
    $email = normalize_optional($body['email'] ?? null);
    if ($email === null || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail('A valid email is required', 400);
    }
    $firstName = normalize_optional($body['first_name'] ?? null) ?? 'New';
    $lastName = normalize_optional($body['last_name'] ?? null) ?? 'Dealer';
    $phone = normalize_optional($body['phone'] ?? null);
    // "Dealership Code" from the form is stored as the staff system_id so it
    // shows up in My Staff and the sidebar workspace box.
    $systemId = normalize_optional($body['dealership_code'] ?? null);

    ensure_password_plain_column();
    ensure_approval_column();
    $pdo = db();

    $findByEmail = $pdo->prepare('SELECT * FROM staff_users WHERE email = :email LIMIT 1');
    $findByEmail->execute([':email' => $email]);
    $existing = $findByEmail->fetch();

    /* EXISTING ACCOUNT - read-only, and deliberately quiet.
     *
     * This endpoint is unauthenticated, so it used to be a full account
     * takeover for anybody who knew an email address: it returned the stored
     * plaintext password for that account (Admins included), and when no
     * plaintext copy existed it overwrote the password instead, locking the
     * real owner out. Both are gone.
     *
     * The registration flow still works: the credentials are emailed to the
     * account's own registered address, and the response simply omits them. The
     * response is identical whether or not the address exists, so this endpoint
     * cannot be used to enumerate staff accounts either.
     */
    if ($existing) {
        send_dealer_registration_mail(
            $email,
            trim($firstName . ' ' . $lastName),
            $existing['password_plain'] ?? null,
            (int)($existing['approved'] ?? 1) === 1
        );
        respond([
            'data' => null,
            'password' => null,
            'message' => 'If this email can be registered, the details have been sent to it.',
        ]);
    }

    try {
        $ins = $pdo->prepare(
            'INSERT INTO staff_users (first_name, last_name'
                    . (staff_full_name_generated() ? '' : ', full_name') .
                    ', email, phone, system_id,
                                      user_type, restrict_data, password, password_plain, approved)
             VALUES (:fn, :ln'
                    . (staff_full_name_generated() ? '' : ', :full') .
                    ', :email, :phone, :sid, \'Dealer\', 0, :p, :pp, 0)'
        );
        $insParams = [
            ':fn' => $firstName,
            ':ln' => $lastName,
            ':email' => $email,
            ':phone' => $phone,
            ':sid' => $systemId,
            ':p' => $hash,
            ':pp' => $plain,
        ];
        if (!staff_full_name_generated()) $insParams[':full'] = trim($firstName . ' ' . $lastName);
        $ins->execute($insParams);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            // Raced with another submission for the same email. Same rule as
            // the lookup above: mail the credentials to the account's own
            // address, but never hand them back over HTTP.
            $findByEmail->execute([':email' => $email]);
            $row = $findByEmail->fetch();
            send_dealer_registration_mail(
                $email,
                trim($firstName . ' ' . $lastName),
                $row['password_plain'] ?? null,
                (int)($row['approved'] ?? 1) === 1
            );
            respond([
                'data' => null,
                'password' => null,
                'message' => 'If this email can be registered, the details have been sent to it.',
            ]);
        }
        fail('Database error: ' . $e->getMessage(), 500);
    }

    $get = $pdo->prepare('SELECT * FROM staff_users WHERE id = :id');
    $get->execute([':id' => (int)$pdo->lastInsertId()]);
    $created = $get->fetch();

    // Every Admin learns about the pending registration on their portal
    // (notifications bell) and by email, so they can approve it quickly.
    $dealerName = trim($firstName . ' ' . $lastName);
    $detail = 'New dealer registration: ' . $dealerName . ' (' . $email . ')'
        . ' is waiting for approval under Settings -> My Staff.';
    $admins = $pdo->query("SELECT id FROM staff_users WHERE user_type = 'Admin'")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($admins as $adminId) {
        notify_staff((int)$adminId, null, 'dealer_registration', 'New dealer registration', $detail);
    }

    // Confirmation + credentials email to the dealer who filled the form.
    send_dealer_registration_mail($email, $dealerName, $plain, false);

    respond([
        'data' => staff_payload($created),
        'password' => $plain,
        'message' => 'Dealer account created and pending approval',
    ], 201);
}

/**
 * POST /staff/{id}/approve
 * Admin action from Settings -> My Staff: unlocks the account, drops a
 * portal notification for the user and emails them a login link.
 */
function approve_staff(int $id): void
{
    // Granting an account access to the CRM is an Admin decision.
    require_api_admin();
    ensure_approval_column();
    $pdo = db();
    $stmt = $pdo->prepare('SELECT * FROM staff_users WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) fail('Staff user not found', 404);

    if ((int)($row['approved'] ?? 1) !== 1) {
        $upd = $pdo->prepare('UPDATE staff_users SET approved = 1 WHERE id = :id');
        $upd->execute([':id' => $id]);
    }

    $name = trim(($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? ''));
    $loginUrl = (defined('APP_URL') ? APP_URL : '') . '/';

    // One-click signed login link: opens the CRM already signed in as this
    // user. Falls back to the normal login page when the token is expired.
    $magicUrl = $loginUrl . '#/magic-login/' . make_login_token($row);

    // Portal notification for the approved user.
    notify_staff($id, null, 'account_approved', 'Account approved', 'Your account has been approved. You can now log in to the website.');

    // Richer approval email with the one-click login button.
    if (!empty($row['email'])) {
        $bodyHtml = '<p style="margin:0 0 12px 0;font-size:14px;line-height:22px;color:#334155;">Hi '
            . htmlspecialchars($name !== '' ? $name : 'there', ENT_QUOTES, 'UTF-8') . ',</p>'
            . '<p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#334155;">Good news! Your dealership registration has been <strong style="color:#059669;">approved</strong>. Click the button below and you will be signed in to your account right away.</p>'
            . '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;"><tr><td style="background-color:#EB5F1B;border-radius:8px;">'
            . '<a href="' . htmlspecialchars($magicUrl, ENT_QUOTES, 'UTF-8') . '" style="display:inline-block;padding:11px 26px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">Login to your account</a>'
            . '</td></tr></table>'
            . '<p style="margin:0;font-size:13px;line-height:20px;color:#64748b;">The button signs you in directly. If it has expired or does not work, sign in with your email and password at:<br>'
            . '<a href="' . htmlspecialchars($loginUrl, ENT_QUOTES, 'UTF-8') . '" style="color:#EB5F1B;word-break:break-all;">' . htmlspecialchars($loginUrl, ENT_QUOTES, 'UTF-8') . '</a></p>';
        send_app_mail(
            (string)$row['email'],
            $name,
            'Your dealership registration is approved',
            $bodyHtml
        );
    }

    $stmt->execute([':id' => $id]);
    respond(['data' => staff_payload($stmt->fetch()), 'message' => 'User approved']);
}

/**
 * POST /auth/reveal-password { email } -> stored plain password (or null).
 *
 * This used to be reachable without a session, so anyone who guessed an email
 * could read that account's password. It now requires signing in, and only
 * returns your own password (Admins may look up any account).
 */
function reveal_password(array $body): void
{
    $caller = require_api_user();
    $email = normalize_optional($body['email'] ?? null);
    if ($email === null) fail('Email is required');
    if (($caller['user_type'] ?? '') !== 'Admin'
        && strcasecmp((string)($caller['email'] ?? ''), $email) !== 0) {
        fail('You can only view your own password.', 403);
    }
    ensure_password_plain_column();
    $stmt = db()->prepare('SELECT password_plain FROM staff_users WHERE email = :email LIMIT 1');
    $stmt->execute([':email' => $email]);
    $row = $stmt->fetch();
    respond(['data' => ['password' => $row['password_plain'] ?? null]]);
}

/**
 * Create a notification row for a staff user and attempt a best-effort
 * email. $contactId may be null (e.g. generic messages). Returns the id.
 */
function notify_staff(int $staffId, ?int $contactId, string $type, string $title, string $detail): int
{
    $pdo = db();
    $stmt = $pdo->prepare(
        'INSERT INTO notifications (staff_id, contact_id, type, title, detail, created_at)
         VALUES (:sid, :cid, :type, :title, :detail, NOW())'
    );
    $stmt->execute([
        ':sid' => $staffId,
        ':cid' => $contactId,
        ':type' => $type,
        ':title' => text_clip($title, 250),
        ':detail' => text_clip($detail, 495),
    ]);
    $id = (int)$pdo->lastInsertId();

    // Best-effort email copy of the notification.
    $recipient = $pdo->prepare('SELECT email, first_name, last_name FROM staff_users WHERE id = :id');
    $recipient->execute([':id' => $staffId]);
    $r = $recipient->fetch();
    if ($r && ($r['email'] ?? null) !== null) {
        $name = trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? ''));
        $body = '<p>Hi ' . htmlspecialchars($name ?: 'there') . ',</p>'
            . '<p>' . htmlspecialchars($title) . '</p>'
            . '<p>' . htmlspecialchars($detail) . '</p>'
            . '<p style="color:#64748b;font-size:12px">Yadea CRM Notification</p>';
        send_notification_email($r['email'], $title, $body);
    }

    return $id;
}

/** GET /notifications[?unread=1] -> the caller's own notifications. */
function list_notifications(array $filters): void
{
    // The owner is the signed-in user. A ?staff_id= parameter is ignored so a
    // notification cannot be read by passing somebody else's id.
    $staffId = current_user_id();

    $where = 'n.staff_id = :sid';
    $params = [':sid' => $staffId];
    if (!empty($filters['unread'])) {
        $where .= ' AND n.is_read = 0';
    }

    $rows = db()->prepare(
        'SELECT n.id, n.contact_id, n.type, n.title, n.detail, n.is_read, n.created_at,
                c.full_name AS contact_name
           FROM notifications n
           LEFT JOIN contacts c ON c.id = n.contact_id
          WHERE ' . $where . '
          ORDER BY n.created_at DESC, n.id DESC
          LIMIT 100'
    );
    $rows->execute($params);
    $data = $rows->fetchAll();

    // Timestamps are stored in the MySQL server's own timezone; tag them
    // with that UTC offset so browsers compute "x minutes ago" correctly
    // no matter which timezone the client is in.
    $offRow = db()->query(
        'SELECT SEC_TO_TIME(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW())) AS o'
    )->fetch();
    $raw = (string)($offRow['o'] ?? '00:00:00');
    $sign = $raw !== '' && $raw[0] === '-' ? '-' : '+';
    $parts = array_pad(explode(':', ltrim($raw, '-')), 3, '0');
    $off = sprintf('%s%02d:%02d', $sign, (int)$parts[0], (int)$parts[1]);
    foreach ($data as &$row) {
        if (!empty($row['created_at'])) {
            $row['created_at'] = date('Y-m-d\TH:i:s', strtotime($row['created_at'])) . $off;
        }
    }
    unset($row);

    respond(['data' => $data, 'count' => count($data)]);
}

/** GET /notifications/unread-count -> the caller's own unread count. */
function notifications_unread_count(int $staffId = 0): void
{
    $staffId = current_user_id();
    $stmt = db()->prepare('SELECT COUNT(*) FROM notifications WHERE staff_id = :sid AND is_read = 0');
    $stmt->execute([':sid' => $staffId]);
    respond(['data' => ['unread' => (int)$stmt->fetchColumn()]]);
}

/** POST /notifications/{id}/read -> only the caller's own notification. */
function mark_notification_read(int $id): void
{
    $stmt = db()->prepare('UPDATE notifications SET is_read = 1 WHERE id = :id AND staff_id = :sid');
    $stmt->execute([':id' => $id, ':sid' => current_user_id()]);
    if ($stmt->rowCount() === 0) fail('Notification not found', 404);
    respond(['message' => 'Notification marked as read']);
}

/** POST /notifications/read-all -> clears the caller's own notifications. */
function mark_all_notifications_read(array $body): void
{
    db()->prepare('UPDATE notifications SET is_read = 1 WHERE staff_id = :sid AND is_read = 0')
        ->execute([':sid' => current_user_id()]);
    respond(['message' => 'All notifications marked as read']);
}

/**
 * POST /notifications  { staff_ids: [], contact_id?, type?, title, detail }
 * Generic client-side notification (e.g. @mention in an internal comment,
 * or a message sent to a contact whose owner/followers should be notified).
 */
function create_notification(array $body): void
{
    $staffIds = array_values(array_unique(array_map(
        'to_int',
        array_filter((array)($body['staff_ids'] ?? []), fn($s) => (int)$s > 0)
    )));
    if (!$staffIds) fail('staff_ids are required');

    $contactId = isset($body['contact_id']) && (int)$body['contact_id'] > 0
        ? (int)$body['contact_id'] : null;

    if ($contactId !== null) {
        // The caller must be able to see the contact, and the recipient list is
        // trimmed to people who can see it too. Without this any signed-in user
        // could drop an arbitrary message into any colleague's bell.
        require_contact_access($contactId);
        if (!is_api_admin()) {
            $staffIds = array_values(array_filter(
                $staffIds,
                static fn($sid) => staff_can_access_contact($sid, $contactId)
            ));
            if (!$staffIds) fail('No recipients can be notified about that contact.', 403);
        }
    } else {
        // A notification with no contact behind it has no tenancy to check, so
        // only an Admin may raise one.
        require_api_admin();
    }

    $type = normalize_optional($body['type'] ?? null) ?? 'assignment';
    $title = text_clip(normalize_optional($body['title'] ?? null) ?? 'New notification', 250);
    $detail = text_clip(normalize_optional($body['detail'] ?? null) ?? '', 495);

    $ids = [];
    foreach ($staffIds as $sid) {
        $ids[] = notify_staff($sid, $contactId, $type, $title, $detail);
    }
    respond(['data' => ['ids' => $ids, 'count' => count($ids)], 'message' => 'Notification(s) created'], 201);
}

/** True when this specific staff user may see the given contact. */
function staff_can_access_contact(int $staffId, int $contactId): bool
{
    $stmt = db()->prepare(
        'SELECT 1 FROM contacts c
          WHERE c.id = :c AND c.deleted_at IS NULL
            AND (c.assigned_to = :s
                 OR c.id IN (SELECT contact_id FROM contact_followers WHERE staff_id = :s2))
          LIMIT 1'
    );
    $stmt->execute([':c' => $contactId, ':s' => $staffId, ':s2' => $staffId]);
    return (bool)$stmt->fetchColumn();
}

/* ----------------------- DEALER / FRANCHISE DASHBOARD ----------------------- */

/**
 * Per-dealer lead counts plus the size of the unassigned pool.
 *
 * This is the owner's control panel — it aggregates every dealer at once — so
 * it is Admin-only. A Dealer/Follower gets their own numbers from
 * my_dealer_leads() instead.
 */
function dealer_dashboard_summary(): void
{
    require_api_admin();
    $rows = db()->query(
        "SELECT s.id AS dealer_id, s.full_name, s.email, s.phone, s.avatar_data,
                COUNT(v.id) AS total,
                SUM(CASE WHEN v.id IS NOT NULL AND COALESCE(dls.status, 'non_contacted') = 'non_contacted' THEN 1 ELSE 0 END) AS non_contacted,
                SUM(CASE WHEN v.id IS NOT NULL AND COALESCE(dls.status, 'non_contacted') = 'contacted' THEN 1 ELSE 0 END) AS contacted,
                SUM(CASE WHEN v.id IS NOT NULL AND COALESCE(dls.status, 'non_contacted') = 'closed' THEN 1 ELSE 0 END) AS closed,
                SUM(CASE WHEN v.id IS NOT NULL AND COALESCE(dls.status, 'non_contacted') = 'customer' THEN 1 ELSE 0 END) AS customer,
                SUM(CASE WHEN v.id IS NOT NULL AND COALESCE(dls.status, 'non_contacted') = 'rejected' THEN 1 ELSE 0 END) AS rejected
           FROM staff_users s
           LEFT JOIN v_leads v ON v.assigned_to = s.id
           LEFT JOIN dealer_lead_status dls ON dls.contact_id = v.id AND dls.dealer_id = s.id
          WHERE s.user_type = 'Dealer'
          GROUP BY s.id, s.full_name, s.email, s.phone, s.avatar_data
          ORDER BY s.full_name"
    )->fetchAll();

    foreach ($rows as &$r) {
        foreach (['total', 'non_contacted', 'contacted', 'closed', 'customer', 'rejected'] as $k) {
            $r[$k] = (int)$r[$k];
        }
    }

    $un = db()->query(
        "SELECT COUNT(*) AS c FROM v_leads v
          WHERE v.assigned_to IS NULL
            AND NOT EXISTS (SELECT 1 FROM dealer_lead_status d WHERE d.contact_id = v.id)"
    )->fetch();
    $unassigned = (int)($un['c'] ?? 0);

    respond(['data' => ['dealers' => $rows, 'unassigned' => $unassigned]]);
}

/**
 * Leads assigned to one dealer (with their tracking status).
 * Admin-only: reading another dealer's pipeline by id is exactly the leak this
 * whole change exists to close, so the id no longer comes from the browser.
 */
function dealer_leads(int $dealerId, ?string $status = null): void
{
    require_api_admin();
    $sql = "SELECT v.id AS contact_id, v.name, v.phone, v.email, v.business_name, v.created_at,
                   COALESCE(dls.status, 'non_contacted') AS status,
                   COALESCE(dls.response_channel, '') AS response_channel,
                   dls.response_note,
                   dls.contacted_at, dls.responded_at, dls.closed_at, dls.updated_at,
                   v.tags, v.tag_ids
              FROM v_leads v
              LEFT JOIN dealer_lead_status dls
                ON dls.contact_id = v.id AND dls.dealer_id = :dealer
             WHERE v.assigned_to = :dealer2";
    $params = [':dealer' => $dealerId, ':dealer2' => $dealerId];
    if ($status !== null && $status !== '') {
        $sql .= ' AND COALESCE(dls.status, \'non_contacted\') = :status';
        $params[':status'] = $status;
    }
    $sql .= ' ORDER BY COALESCE(dls.updated_at, v.created_at) DESC';

    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$row) {
        $row['created_at'] = $row['created_at'] ?? null;
        $row['tags'] = $row['tags'] !== '' ? explode(',', $row['tags']) : [];
        $row['tag_ids'] = $row['tag_ids'] !== '' ? array_map('to_int', explode(',', $row['tag_ids'])) : [];
    }
    respond(['data' => $rows, 'count' => count($rows)]);
}

/**
 * The signed-in user's OWN leads only.
 *
 * The staff id comes from the session, never from ?staff_id=, which previously
 * let anyone read any other user's pipeline by changing the URL.
 *
 *  - Dealer   -> leads assigned to them.
 *  - Follower -> leads assigned to them OR that they follow. They never inherit
 *                their manager's (the Dealer's) whole book; the manager is only
 *                used as the pipeline owner whose status column is shown.
 */
function my_dealer_leads(int $staffId, ?string $status = null): void
{
    // Ignore the caller-supplied id and use the authenticated user.
    $staffId = current_user_id();
    $row = db()->prepare('SELECT user_type, manager_id FROM staff_users WHERE id = :id');
    $row->execute([':id' => $staffId]);
    $u = $row->fetch();
    if (!$u) fail('Staff user not found', 404);

    if (($u['user_type'] ?? '') === 'Dealer') {
        $trackDealer = $staffId;
        $where = 'v.assigned_to = :me';
        $params = [':me' => $staffId];
    } else {
        $trackDealer = (int)($u['manager_id'] ?? $staffId);
        $where = '(v.assigned_to = :me OR v.id IN (SELECT contact_id FROM contact_followers WHERE staff_id = :me2))';
        $params = [':me' => $staffId, ':me2' => $staffId];
    }
    $params[':track'] = $trackDealer;

    $sql = "SELECT v.id AS contact_id, v.name, v.phone, v.email, v.business_name, v.created_at,
                   COALESCE(dls.status, 'non_contacted') AS status,
                   COALESCE(dls.response_channel, '') AS response_channel,
                   dls.response_note,
                   dls.contacted_at, dls.responded_at, dls.closed_at, dls.updated_at,
                   v.tags, v.tag_ids
              FROM v_leads v
              LEFT JOIN dealer_lead_status dls
                ON dls.contact_id = v.id AND dls.dealer_id = :track
             WHERE " . $where;
    if ($status !== null && $status !== '') {
        $sql .= ' AND COALESCE(dls.status, \'non_contacted\') = :status';
        $params[':status'] = $status;
    }
    $sql .= ' ORDER BY COALESCE(dls.updated_at, v.created_at) DESC';

    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$row2) {
        $row2['created_at'] = $row2['created_at'] ?? null;
        $row2['tags'] = $row2['tags'] !== '' ? explode(',', $row2['tags']) : [];
        $row2['tag_ids'] = $row2['tag_ids'] !== '' ? array_map('to_int', explode(',', $row2['tag_ids'])) : [];
    }
    respond(['data' => $rows, 'count' => count($rows)]);
}

/**
 * The unassigned lead pool. Admin-only: these leads belong to nobody yet, and
 * dealers/followers must not be able to see or claim them before an Admin
 * assigns them.
 */
function dealer_unassigned_leads(): void
{
    require_api_admin();
    $stmt = db()->prepare(
        "SELECT v.* FROM v_leads v
          WHERE v.assigned_to IS NULL
            AND NOT EXISTS (SELECT 1 FROM dealer_lead_status d WHERE d.contact_id = v.id)
          ORDER BY v.created_at DESC"
    );
    $stmt->execute();
    $rows = $stmt->fetchAll();
    foreach ($rows as &$row) {
        $row['tags'] = $row['tags'] !== '' ? explode(',', $row['tags']) : [];
        $row['tag_ids'] = $row['tag_ids'] !== '' ? array_map('to_int', explode(',', $row['tag_ids'])) : [];
        $row['custom_fields'] = decode_custom_fields($row['custom_fields'] ?? null);
    }
    respond(['data' => $rows, 'count' => count($rows)]);
}

/**
 * Assign leads to a dealer.
 * Either explicit ids (checkbox selection) OR a date filter:
 *   { "filter": { "type": "days"|"weeks"|"months"|"years", "value": N } }
 *   { "filter": { "type": "range", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } }
 *   { "filter": { "type": "all" } }
 */
function assign_leads_to_dealer(array $body): void
{
    // Handing leads out is the owner's job. Previously anyone could post here
    // and drain the unassigned pool into a dealer of their choosing.
    require_api_admin();
    $dealerId = to_int((string)($body['dealer_id'] ?? 0));
    if ($dealerId <= 0) fail('dealer_id is required');

    $d = db()->prepare('SELECT id, user_type FROM staff_users WHERE id = :id');
    $d->execute([':id' => $dealerId]);
    $drow = $d->fetch();
    if (!$drow) fail('Dealer not found', 404);
    if (($drow['user_type'] ?? '') !== 'Dealer') fail('Selected user is not a Dealer', 400);

    $pdo = db();
    $contactIds = [];

    if (!empty($body['contact_ids']) && is_array($body['contact_ids'])) {
        $contactIds = array_values(array_filter(
            array_map(fn($c) => to_int((string)$c), $body['contact_ids']),
            fn($c) => $c > 0
        ));
    } elseif (isset($body['filter']) && is_array($body['filter'])) {
        $f = $body['filter'];
        $type = (string)($f['type'] ?? 'all');
        $where = 'is_lead = 1';
        if (in_array($type, ['days', 'weeks', 'months', 'years'], true)) {
            $value = max(1, (int)($f['value'] ?? 1));
            $where .= " AND created_at >= DATE_SUB(NOW(), INTERVAL $value $type)";
        } elseif ($type === 'range') {
            $from = trim((string)($f['from'] ?? ''));
            $to = trim((string)($f['to'] ?? ''));
            if ($from !== '') {
                $where .= ' AND created_at >= :from';
                $fromParam[':from'] = $from;
            }
            if ($to !== '') {
                $where .= ' AND created_at <= :to';
                $toParam[':to'] = $to;
            }
        }
        // Only leads that aren't already assigned to a dealer.
        $sql = "SELECT id FROM v_leads WHERE $where AND v_leads.assigned_to IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM dealer_lead_status d WHERE d.contact_id = v_leads.id)";
        $stmt = $pdo->prepare($sql);
        $stmt->execute(($fromParam ?? []) + ($toParam ?? []));
        $contactIds = array_map(fn($r) => (int)$r['id'], $stmt->fetchAll());
    }

    if (!$contactIds) {
        respond(['data' => ['assigned' => 0], 'message' => 'No leads to assign']);
    }

    $pdo->beginTransaction();
    try {
        $assigned = 0;
        $assignedIds = [];
        $ins = $pdo->prepare('INSERT INTO dealer_lead_status (contact_id, dealer_id) VALUES (:c, :d)');
        $upd = $pdo->prepare('UPDATE contacts SET assigned_to = :d, last_activity_at = NOW() WHERE id = :c');
        foreach ($contactIds as $cid) {
            $exists = $pdo->prepare('SELECT id FROM contacts WHERE id = :id');
            $exists->execute([':id' => $cid]);
            if (!$exists->fetch()) continue;

            $taken = $pdo->prepare('SELECT dealer_id FROM dealer_lead_status WHERE contact_id = :c LIMIT 1');
            $taken->execute([':c' => $cid]);
            $cur = $taken->fetchColumn();
            if ($cur !== false) {
                if ((int)$cur === $dealerId) continue;
                $pdo->prepare('DELETE FROM dealer_lead_status WHERE contact_id = :c')->execute([':c' => $cid]);
            }

            $ins->execute([':c' => $cid, ':d' => $dealerId]);
            $upd->execute([':d' => $dealerId, ':c' => $cid]);
            $assigned++;
            $assignedIds[] = $cid;
        }
        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        fail('Database error: ' . $e->getMessage(), 500);
    }

    // Tell the dealer they got new leads so the bell lights up.
    if ($assigned > 0) {
        $contactName = null;
        if ($assigned === 1 && isset($assignedIds[0])) {
            $nm = $pdo->prepare('SELECT full_name FROM contacts WHERE id = :id');
            $nm->execute([':id' => $assignedIds[0]]);
            $contactName = $nm->fetchColumn() ?: null;
        }
        notify_staff(
            $dealerId,
            $assigned === 1 ? ($assignedIds[0] ?? null) : null,
            'lead_assigned',
            $assigned === 1 ? 'New lead assigned to you' : "$assigned leads assigned to you",
            $assigned === 1
                ? ($contactName ?: 'A lead') . ' has been assigned to you.'
                : "$assigned new lead(s) have been assigned to you. Open your dashboard to start contacting them."
        );
    }

    respond(['data' => ['assigned' => $assigned], 'message' => "$assigned lead(s) assigned"]);
}

/** A dealer updates the tracking status of one of their assigned leads. */
function update_dealer_lead_status(int $contactId, array $body): void
{
    $dealerId = to_int((string)($body['dealer_id'] ?? 0));
    if ($dealerId <= 0) fail('dealer_id is required');

    // A dealer may only move leads on their own pipeline. Admins may act for
    // any dealer (that is what the dashboard does). Without this check a dealer
    // could post somebody else's dealer_id and rewrite their lead statuses.
    if (!is_api_admin() && $dealerId !== current_user_id()) {
        fail('You can only update leads on your own pipeline.', 403);
    }
    require_contact_access($contactId);

    $allowed = ['non_contacted', 'contacted', 'closed', 'customer', 'rejected'];
    $status = (string)($body['status'] ?? '');
    if (!in_array($status, $allowed, true)) fail('Invalid status');

    $channel = (string)($body['response_channel'] ?? '');
    $note = $body['response_note'] ?? null;
    if ($note !== null && trim((string)$note) === '') $note = null;

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $chk = $pdo->prepare(
            'SELECT c.id FROM contacts c
              WHERE c.id = :c
                AND (c.assigned_to = :d OR EXISTS (
                       SELECT 1 FROM dealer_lead_status dl WHERE dl.contact_id = c.id AND dl.dealer_id = :d2))'
        );
        $chk->execute([':c' => $contactId, ':d' => $dealerId, ':d2' => $dealerId]);
        if (!$chk->fetch()) fail('Lead not assigned to this dealer', 404);

        $ins = $pdo->prepare(
            'INSERT INTO dealer_lead_status (contact_id, dealer_id, status, response_channel, response_note)
             VALUES (:c, :d, :status, :channel, :note)
             ON DUPLICATE KEY UPDATE status = VALUES(status), response_channel = VALUES(response_channel), response_note = VALUES(response_note)'
        );
        $params = [
            ':c' => $contactId,
            ':d' => $dealerId,
            ':status' => $status,
            ':channel' => $channel,
            ':note' => $note,
        ];
        $ins->execute($params);

        $sets = ['status = :status', 'response_channel = :channel', 'response_note = :note'];
        if (in_array($status, ['contacted', 'closed', 'customer', 'rejected'], true)) {
            $sets[] = 'contacted_at = COALESCE(contacted_at, NOW())';
        }
        if (in_array($status, ['closed', 'customer', 'rejected'], true)) {
            $sets[] = 'responded_at = COALESCE(responded_at, NOW())';
        }
        if (in_array($status, ['customer', 'rejected'], true)) {
            $sets[] = 'closed_at = COALESCE(closed_at, NOW())';
        }

        $pdo->prepare(
            'UPDATE dealer_lead_status SET ' . implode(', ', $sets)
            . ' WHERE contact_id = :c AND dealer_id = :d'
        )->execute($params);
        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        fail('Database error: ' . $e->getMessage(), 500);
    }

    // Everyone following this lead (other than the dealer doing the update)
    // gets a heads-up so the team stays in the loop.
    $statusLabels = [
        'non_contacted' => 'Non-Contacted',
        'contacted' => 'Contacted',
        'closed' => 'Closed',
        'customer' => 'Customer',
        'rejected' => 'Rejected',
    ];
    $nm = $pdo->prepare('SELECT full_name FROM contacts WHERE id = :id');
    $nm->execute([':id' => $contactId]);
    $cname = $nm->fetchColumn() ?: 'A lead';
    $dn = $pdo->prepare('SELECT full_name FROM staff_users WHERE id = :id');
    $dn->execute([':id' => $dealerId]);
    $dname = $dn->fetchColumn() ?: 'A team member';
    $actorId = to_int((string)($body['actor_id'] ?? 0));
    if ($actorId > 0 && $actorId !== $dealerId) {
        $an = $pdo->prepare('SELECT full_name FROM staff_users WHERE id = :id');
        $an->execute([':id' => $actorId]);
        $actorName = $an->fetchColumn() ?: $dname;
        $detail = $actorName . ' marked ' . $cname . ' as ' . $label . '.';
    } else {
        $detail = $dname . ' marked ' . $cname . ' as ' . $label . '.';
    }

    // Everyone following this lead (other than the dealer doing the update)
    // gets a heads-up so the team stays in the loop.
    $followers = $pdo->prepare('SELECT staff_id FROM contact_followers WHERE contact_id = :c AND staff_id <> :d');
    $followers->execute([':c' => $contactId, ':d' => $dealerId]);
    foreach ($followers->fetchAll() as $f) {
        notify_staff((int)$f['staff_id'], $contactId, 'lead_assigned', 'Lead status updated', $detail);
    }

    // Admins are told too so they see pipeline movement without checking manually.
    $admins = $pdo->query("SELECT id FROM staff_users WHERE user_type = 'Admin'")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($admins as $aid) {
        notify_staff((int)$aid, $contactId, 'lead_assigned', 'Lead status updated', $detail);
    }

    respond(['message' => 'Lead status updated']);
}

/** Move many leads into a bucket at once (checkbox selection). */
function bulk_update_dealer_lead_status(array $body): void
{
    $dealerId = to_int((string)($body['dealer_id'] ?? 0));
    if ($dealerId <= 0) fail('dealer_id is required');

    // Same rule as update_dealer_lead_status: your own pipeline, or Admin.
    if (!is_api_admin() && $dealerId !== current_user_id()) {
        fail('You can only update leads on your own pipeline.', 403);
    }

    $allowed = ['non_contacted', 'contacted', 'closed', 'customer', 'rejected'];
    $status = (string)($body['status'] ?? '');
    if (!in_array($status, $allowed, true)) fail('Invalid status');

    $channel = (string)($body['response_channel'] ?? '');
    $note = $body['response_note'] ?? null;
    if ($note !== null && trim((string)$note) === '') $note = null;

    $ids = $body['contact_ids'] ?? null;
    if (!is_array($ids) || !$ids) fail('contact_ids are required');

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $updated = 0;
        $ins = $pdo->prepare(
            'INSERT INTO dealer_lead_status (contact_id, dealer_id, status, response_channel, response_note)
             VALUES (:c, :d, :status, :channel, :note)
             ON DUPLICATE KEY UPDATE status = VALUES(status), response_channel = VALUES(response_channel), response_note = VALUES(response_note)'
        );
        $upd = $pdo->prepare(
            'UPDATE dealer_lead_status SET status = :status, response_channel = :channel, response_note = :note,
                    contacted_at = CASE WHEN :contacted THEN COALESCE(contacted_at, NOW()) ELSE contacted_at END,
                    responded_at = CASE WHEN :responded THEN COALESCE(responded_at, NOW()) ELSE responded_at END,
                    closed_at = CASE WHEN :closed THEN COALESCE(closed_at, NOW()) ELSE closed_at END
             WHERE contact_id = :c AND dealer_id = :d'
        );
        foreach ($ids as $raw) {
            $cid = to_int((string)$raw);
            if ($cid <= 0) continue;
            $chk = $pdo->prepare(
                'SELECT c.id FROM contacts c
                  WHERE c.id = :c
                    AND (c.assigned_to = :d OR EXISTS (
                           SELECT 1 FROM dealer_lead_status dl WHERE dl.contact_id = c.id AND dl.dealer_id = :d2))'
            );
            $chk->execute([':c' => $cid, ':d' => $dealerId, ':d2' => $dealerId]);
            if (!$chk->fetch()) continue;

            $ins->execute([
                ':c' => $cid,
                ':d' => $dealerId,
                ':status' => $status,
                ':channel' => $channel,
                ':note' => $note,
            ]);
            $upd->execute([
                ':status' => $status,
                ':channel' => $channel,
                ':note' => $note,
                ':contacted' => in_array($status, ['contacted', 'closed', 'customer', 'rejected'], true) ? 1 : 0,
                ':responded' => in_array($status, ['closed', 'customer', 'rejected'], true) ? 1 : 0,
                ':closed' => in_array($status, ['customer', 'rejected'], true) ? 1 : 0,
                ':c' => $cid,
                ':d' => $dealerId,
            ]);
            $updated++;
        }
        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        fail('Database error: ' . $e->getMessage(), 500);
    }

    respond(['data' => ['updated' => $updated], 'message' => "$updated lead(s) moved to $status"]);
}

/* ------------------- SMART LISTS (server-side, multi-user) ------------------- */

/**
 * The staff id a smart-list operation runs as.
 *
 * This used to read `user_id` from the request body/query, which meant anyone
 * could act as an Admin (bypassing every ownership check downstream) or read a
 * colleague's lists. The identity now comes from the session token and any
 * `user_id` in the request is ignored.
 */
function smart_list_user(array $filters = [], array $body = []): int
{
    return current_user_id();
}

/**
 * Build the array representation of a smart list row + its shares.
 *
 * `members` is trimmed to the contacts the caller may see. A shared list keeps
 * its name and structure for everyone, but the ids inside it are the only thing
 * that can leak another dealer's book, so they are filtered here rather than
 * trusted from the caller.
 */
function smart_list_payload(array $row): array
{
    $shares = db()->prepare(
        'SELECT user_id FROM smart_list_shares WHERE smart_list_id = :id ORDER BY user_id'
    );
    $shares->execute([':id' => $row['id']]);
    $shareIds = array_map(fn($s) => (int)$s['user_id'], $shares->fetchAll());

    $members = decode_json_field($row['members'] ?? null);
    $members = array_values(array_filter(array_map(
        static fn($m) => is_numeric($m) ? (int)$m : 0,
        is_array($members) ? $members : []
    ), static fn($id) => $id > 0));
    if (!is_api_admin()) {
        $allowed = array_fill_keys(accessible_contact_ids(current_user_id()), true);
        $members = array_values(array_filter($members, static fn($id) => isset($allowed[$id])));
    }

    // The share roster is staff metadata, not lead data, and only the owner (or
    // an Admin) can change it. Showing it to everybody would tell a dealer who
    // else a colleague's list is shared with, for no benefit.
    $admin = is_api_admin();
    if (!$admin) $shareIds = [];

    return [
        'id' => (int)$row['id'],
        'name' => $row['name'],
        'filters' => decode_json_field($row['filters'] ?? null),
        'sort_by' => $row['sort_by'] ?? '',
        'fields' => decode_json_field($row['fields'] ?? null),
        'members' => $members,
        'dealer_id' => $row['dealer_id'] !== null ? (int)$row['dealer_id'] : null,
        'dealer_name' => $row['dealer_name'] ?? null,
        'shared_all' => (int)($row['shared_all'] ?? 0) === 1,
        'shared_user_ids' => $admin ? $shareIds : [],
        'created_by' => (int)$row['created_by'],
        'created_by_name' => $row['created_by_name'] ?? '',
        'created_at' => $row['created_at'] ?? null,
        'updated_at' => $row['updated_at'] ?? null,
    ];
}

/** Visibility: a list is visible when owned, assigned to the caller, shared explicitly, or shared with everyone. */
function smart_lists_visible(int $userId): PDOStatement
{
    return db()->prepare(
        'SELECT sl.*, s.full_name AS created_by_name, d.full_name AS dealer_name
           FROM smart_lists sl
           LEFT JOIN staff_users s ON s.id = sl.created_by
           LEFT JOIN staff_users d ON d.id = sl.dealer_id
          WHERE sl.created_by = :me
             OR sl.dealer_id = :assigned
             OR sl.shared_all = 1
             OR sl.id IN (SELECT smart_list_id FROM smart_list_shares WHERE user_id = :me2)
          ORDER BY sl.created_at DESC, sl.id DESC'
    );
}

/** GET /smart-lists?user_id=N -> every list visible to the user. */
function list_smart_lists(array $filters): void
{
    $userId = smart_list_user($filters);
    $stmt = smart_lists_visible($userId);
    $stmt->execute([':me' => $userId, ':me2' => $userId, ':assigned' => $userId]);
    $rows = $stmt->fetchAll();

    $rows = filter_smart_lists_for_staff($rows, $userId);

    respond(['data' => array_map('smart_list_payload', $rows), 'count' => count($rows)]);
}

/** Contact ids a staff user owns (assigned) or follows. */
function staff_accessible_contact_ids(int $userId): array
{
    $stmt = db()->prepare(
        'SELECT id FROM contacts
          WHERE assigned_to = :me
             OR id IN (SELECT contact_id FROM contact_followers WHERE staff_id = :me2)'
    );
    $stmt->execute([':me' => $userId, ':me2' => $userId]);
    return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * Dealers and followers start with a clean slate: until leads are assigned to
 * them they see no smart lists at all. Afterwards a list appears only when the
 * Admin assigned it to them (dealer_id), shared it with them by name
 * (smart_list_shares), or they created it themselves. Admins are unaffected.
 *
 * Two older rules used to flood every dealer's tab strip with the whole list
 * library: `shared_all = 1` (a global list) and "the list contains one of my
 * contacts" - the second one fired the moment an Admin assigned leads out of a
 * list, which is exactly the moment a dealer should NOT inherit it. Both are
 * deliberately gone for non-admins.
 */
function filter_smart_lists_for_staff(array $rows, int $userId): array
{
    if (!$rows) return $rows;

    // Only a real Admin bypasses the filter. An empty/unknown user_type used to
    // be treated as Admin here ("$type === ''"), so a dealer whose type came
    // back blank sailed straight through and saw the whole library. Unknown
    // types now fall through to the restrictive branch: they keep only what was
    // assigned to them, shared with them, or created by them.
    if (is_api_admin()) return $rows;

    $shared = db()->prepare('SELECT smart_list_id FROM smart_list_shares WHERE user_id = :u');
    $shared->execute([':u' => $userId]);
    $sharedSet = array_fill_keys(array_map('intval', $shared->fetchAll(PDO::FETCH_COLUMN)), true);

    $out = [];
    foreach ($rows as $row) {
        if ((int)$row['created_by'] === $userId
            || (int)($row['dealer_id'] ?? 0) === $userId
            || isset($sharedSet[(int)$row['id']])) {
            $out[] = $row;
        }
    }
    return $out;
}

/** Validate and normalize the JSON-column inputs of a smart list. */
function smart_list_input(array $body): array
{
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '') fail('name is required');

    $asIntArray = function ($value): array {
        if (!is_array($value)) return [];
        return array_values(array_unique(array_filter(
            array_map(fn($v) => to_int((string)$v), $value),
            fn($v) => $v > 0
        )));
    };
    $asStrArray = function ($value): array {
        if (!is_array($value)) return [];
        return array_values(array_filter(array_map(fn($v) => trim((string)$v), $value), fn($v) => $v !== ''));
    };

    $dealerId = $body['dealer_id'] ?? null;

    // Sharing is an Admin decision. Without this a dealer could set shared_all
    // and push their own list into everybody's sidebar (revealing that it
    // exists), or assign a list to a colleague.
    $admin = is_api_admin();
    $shareIds = $admin ? $asIntArray($body['shared_user_ids'] ?? null) : [];
    if (!$admin) $dealerId = null;

    // Members are stored trimmed to what the caller may actually see, so the
    // saved JSON never holds another tenant's contact ids even though the read
    // path filters them anyway.
    $members = $asIntArray($body['members'] ?? null);
    if (!$admin) {
        $allowed = array_fill_keys(accessible_contact_ids(current_user_id()), true);
        $members = array_values(array_filter($members, static fn($id) => isset($allowed[$id])));
    }

    return [
        'name' => $name,
        'filters' => encode_json_field($asStrArray($body['filters'] ?? null)),
        'sort_by' => (($body['sort_by'] ?? '') !== '') ? trim((string)$body['sort_by']) : null,
        'fields' => encode_json_field($asStrArray($body['fields'] ?? null)),
        'members' => encode_json_field($members),
        'dealer_id' => ($dealerId === null || $dealerId === '' || (int)$dealerId <= 0) ? null : (int)$dealerId,
        'shared_all' => ($admin && !empty($body['shared_all'])) ? 1 : 0,
        'share_ids' => $shareIds,
    ];
}

/** Replace the share rows for a smart list (owner always keeps access). */
function smart_list_set_shares(int $listId, array $shareIds, int $ownerId): void
{
    $pdo = db();
    $pdo->prepare('DELETE FROM smart_list_shares WHERE smart_list_id = :id')->execute([':id' => $listId]);
    $ins = $pdo->prepare('INSERT INTO smart_list_shares (smart_list_id, user_id) VALUES (:l, :u)');
    foreach ($shareIds as $uid) {
        if ((int)$uid === $ownerId) continue;
        $ins->execute([':l' => $listId, ':u' => (int)$uid]);
    }
}

/** Fetch a smart list row with creator/dealer names. */
function smart_list_fetch(int $id): array
{
    $row = db()->prepare(
        'SELECT sl.*, s.full_name AS created_by_name, d.full_name AS dealer_name
           FROM smart_lists sl
           LEFT JOIN staff_users s ON s.id = sl.created_by
           LEFT JOIN staff_users d ON d.id = sl.dealer_id
          WHERE sl.id = :id'
    );
    $row->execute([':id' => $id]);
    return $row->fetch() ?: [];
}

/** POST /smart-lists  { user_id, name, filters?, sort_by?, fields?, members?, dealer_id?, shared_all?, shared_user_ids? } */
function create_smart_list(array $body): void
{
    $userId = smart_list_user([], $body);
    $input = smart_list_input($body);
    $pdo = db();

    $dup = $pdo->prepare('SELECT id FROM smart_lists WHERE created_by = :me AND name = :name');
    $dup->execute([':me' => $userId, ':name' => $input['name']]);
    if ($dup->fetch()) fail('A smart list with this name already exists');

    $stmt = $pdo->prepare(
        'INSERT INTO smart_lists (name, filters, sort_by, fields, members, dealer_id, shared_all, created_by)
         VALUES (:name, :filters, :sort_by, :fields, :members, :dealer_id, :shared_all, :created_by)'
    );
    $stmt->execute([
        ':name' => $input['name'],
        ':filters' => $input['filters'],
        ':sort_by' => $input['sort_by'],
        ':fields' => $input['fields'],
        ':members' => $input['members'],
        ':dealer_id' => $input['dealer_id'],
        ':shared_all' => $input['shared_all'],
        ':created_by' => $userId,
    ]);
    $id = (int)$pdo->lastInsertId();
    smart_list_set_shares($id, $input['share_ids'], $userId);

    respond(['data' => smart_list_payload(smart_list_fetch($id)), 'message' => 'Smart list created'], 201);
}

/** PUT /smart-lists/{id}  { user_id, name, ... } -> only the owner may edit. */
function update_smart_list(int $id, array $body): void
{
    $userId = smart_list_user([], $body);
    $input = smart_list_input($body);
    $pdo = db();

    $existing = $pdo->prepare('SELECT id, created_by FROM smart_lists WHERE id = :id');
    $existing->execute([':id' => $id]);
    $row = $existing->fetch();
    if (!$row) fail('Smart list not found', 404);
    if ((int)$row['created_by'] !== $userId) fail('Only the owner can edit this smart list', 403);

    $dup = $pdo->prepare('SELECT id FROM smart_lists WHERE created_by = :me AND name = :name AND id <> :id');
    $dup->execute([':me' => $userId, ':name' => $input['name'], ':id' => $id]);
    if ($dup->fetch()) fail('A smart list with this name already exists');

    $pdo->prepare(
        'UPDATE smart_lists
            SET name = :name, filters = :filters, sort_by = :sort_by, fields = :fields,
                members = :members, dealer_id = :dealer_id, shared_all = :shared_all
          WHERE id = :id'
    )->execute([
        ':name' => $input['name'],
        ':filters' => $input['filters'],
        ':sort_by' => $input['sort_by'],
        ':fields' => $input['fields'],
        ':members' => $input['members'],
        ':dealer_id' => $input['dealer_id'],
        ':shared_all' => $input['shared_all'],
        ':id' => $id,
    ]);
    smart_list_set_shares($id, $input['share_ids'], $userId);

    respond(['data' => smart_list_payload(smart_list_fetch($id)), 'message' => 'Smart list updated']);
}

/** DELETE /smart-lists/{id}?user_id=N -> only the owner may delete. */
function delete_smart_list(int $id, array $filters): void
{
    $userId = smart_list_user($filters);
    $pdo = db();

    $existing = $pdo->prepare('SELECT id, created_by FROM smart_lists WHERE id = :id');
    $existing->execute([':id' => $id]);
    $row = $existing->fetch();
    if (!$row) fail('Smart list not found', 404);
    if ((int)$row['created_by'] !== $userId) fail('Only the owner can delete this smart list', 403);

    $pdo->prepare('DELETE FROM smart_lists WHERE id = :id')->execute([':id' => $id]);
    respond(['message' => 'Smart list deleted']);
}

/**
 * POST /smart-lists/{id}/duplicate -> a copy owned by the caller.
 *
 * The source list must be one the caller can actually see, and the copy only
 * carries the members the caller may see. Previously any list id could be
 * copied verbatim, which handed one tenant another tenant's member ids.
 */
function duplicate_smart_list(int $id, array $body): void
{
    $userId = smart_list_user([], $body);
    $pdo = db();

    // Reuse the normal visibility rule for the source list.
    $visible = smart_lists_visible($userId);
    $visible->execute([':me' => $userId, ':me2' => $userId, ':assigned' => $userId]);
    $candidates = array_values(array_filter(
        $visible->fetchAll(),
        static fn($r) => (int)$r['id'] === $id
    ));
    $candidates = filter_smart_lists_for_staff($candidates, $userId);
    if (!$candidates) fail('Smart list not found', 404);
    $row = $candidates[0];

    $name = $row['name'] . ' (copy)';
    $dup = $pdo->prepare('SELECT id FROM smart_lists WHERE created_by = :me AND name = :name');
    $dup->execute([':me' => $userId, ':name' => $name]);
    if ($dup->fetch()) fail('A smart list named "' . $name . '" already exists');

    // Copy only the members the caller is allowed to see, so the new list never
    // stores another tenant's contact ids.
    $allowed = array_fill_keys(accessible_contact_ids($userId), true);
    $members = array_values(array_filter(array_map(
        static fn($m) => is_numeric($m) ? (int)$m : 0,
        decode_json_field($row['members'] ?? null) ?: []
    ), static fn($mid) => $mid > 0 && isset($allowed[$mid])));

    $pdo->prepare(
        'INSERT INTO smart_lists (name, filters, sort_by, fields, members, dealer_id, shared_all, created_by)
         VALUES (:name, :filters, :sort_by, :fields, :members, :dealer_id, 0, :created_by)'
    )->execute([
        ':name' => $name,
        ':filters' => $row['filters'],
        ':sort_by' => $row['sort_by'],
        ':fields' => $row['fields'],
        ':members' => json_encode($members),
        ':dealer_id' => $row['dealer_id'],
        ':created_by' => $userId,
    ]);
    $newId = (int)$pdo->lastInsertId();

    respond(['data' => smart_list_payload(smart_list_fetch($newId)), 'message' => 'Smart list duplicated']);
}

/* ------------- OUTLET -> SMART LIST AUTO-LINKING ------------- */

/**
 * Owner of the auto-created outlet smart lists: the first Admin account.
 * Returns 0 when no admin exists (linking is then skipped).
 */
function outlet_smart_list_owner(): int
{
    try {
        $id = db()->query("SELECT id FROM staff_users WHERE user_type = 'Admin' ORDER BY id ASC LIMIT 1")
            ->fetchColumn();
        return $id !== false ? (int)$id : 0;
    } catch (Throwable $e) {
        return 0;
    }
}

/** Collect every outlet (child option) configured on a form's local dropdown fields. */
function extract_form_outlets($elements): array
{
    if (!is_array($elements)) return [];
    $outlets = [];
    foreach ($elements as $el) {
        if (!is_array($el) || ($el['type'] ?? '') !== 'local_dropdown') continue;
        foreach (($el['rows'] ?? []) as $row) {
            if (!is_array($row)) continue;
            foreach (($row['rules'] ?? []) as $rule) {
                if (!is_array($rule)) continue;
                foreach (($rule['options'] ?? []) as $opt) {
                    $name = trim((string)$opt);
                    if ($name !== '') $outlets[$name] = true;
                }
            }
        }
    }
    return array_keys($outlets);
}

/**
 * Make sure one global smart list exists for every outlet configured on a form.
 * Called whenever a form is created/updated, so a newly added outlet instantly
 * gets its own smart list (outlet <-> smart list stay connected).
 */
function ensure_outlet_smart_lists(array $outlets): void
{
    $outlets = array_values(array_unique(array_filter(
        array_map(fn($o) => trim((string)$o), $outlets),
        fn($o) => $o !== ''
    )));
    if (!$outlets) return;
    $owner = outlet_smart_list_owner();
    if ($owner <= 0) return;
    try {
        $ins = db()->prepare(
            'INSERT IGNORE INTO smart_lists
                (name, filters, sort_by, fields, members, dealer_id, shared_all, created_by)
             VALUES (:name, NULL, NULL, NULL, NULL, NULL, 1, :owner)'
        );
        foreach ($outlets as $name) {
            $ins->execute([':name' => $name, ':owner' => $owner]);
        }
    } catch (Throwable $e) {
        // Outlet smart lists are best-effort; never block a form save.
    }
}

/**
 * After a contact is created/updated from a form submission, add it to the
 * smart list of the outlet it selected. The outlet value is matched against
 * smart list names, preferring the child ("... Outlet") value of any
 * local dropdown field. Safe to call repeatedly (idempotent).
 */
function sync_contact_outlet_smart_lists(int $contactId): void
{
    if ($contactId <= 0) return;
    try {
        $stmt = db()->prepare('SELECT custom_fields FROM contacts WHERE id = :id');
        $stmt->execute([':id' => $contactId]);
        $raw = $stmt->fetchColumn();
        if ($raw === false || $raw === null || $raw === '') return;

        $cf = decode_custom_fields((string)$raw);
        $subs = $cf['form_submissions'] ?? null;
        if (!is_array($subs)) return;

        $preferred = [];
        $fallback = [];
        foreach ($subs as $sub) {
            if (!is_array($sub) || !is_array($sub['values'] ?? null)) continue;
            foreach ($sub['values'] as $key => $val) {
                if (!is_string($val)) continue;
                $val = trim($val);
                if ($val === '') continue;
                $fallback[$val] = true;
                // The stored key is "<element label> · <child label>". Only the
                // child label tells us this is the outlet dropdown (the element
                // label itself may also say "Outlet", e.g. "Outlet · Select City").
                $sep = strrpos((string)$key, '·');
                $childLabel = $sep !== false ? substr((string)$key, $sep) : (string)$key;
                if (stripos($childLabel, 'outlet') !== false) $preferred[$val] = true;
            }
        }
        $names = array_keys($preferred ?: $fallback);
        if (!$names) return;

        $pdo = db();
        $ph = implode(',', array_fill(0, count($names), '?'));
        $q = $pdo->prepare("SELECT id, members FROM smart_lists WHERE name IN ($ph)");
        $q->execute($names);
        $upd = $pdo->prepare('UPDATE smart_lists SET members = :members WHERE id = :id');
        foreach ($q->fetchAll() as $row) {
            $members = decode_json_field($row['members'] ?? null);
            $ids = [];
            foreach ((array)$members as $m) {
                if (is_numeric($m)) $ids[] = (int)$m;
            }
            if (in_array($contactId, $ids, true)) continue;
            $ids[] = $contactId;
            $ids = array_values(array_unique($ids));
            $upd->execute([':members' => encode_json_field($ids), ':id' => (int)$row['id']]);
        }
    } catch (Throwable $e) {
        // Never let smart-list syncing break a form submission.
    }
}

/* ----------------------- FORM IMAGES (short form links) ----------------------- */

/** Ensure the form_images table exists (created lazily so no manual SQL is needed). */
function ensure_form_images_table(): void
{
    static $done = false;
    if ($done) return;
    $done = true;
    db()->exec(
        'CREATE TABLE IF NOT EXISTS form_images (
            id INT AUTO_INCREMENT PRIMARY KEY,
            data MEDIUMTEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
}

/** POST /form-images { image: "<base64 data URI>" } -> store, return { id }. */
function store_form_image(array $body): void
{
    $image = $body['image'] ?? '';
    if (!is_string($image) || $image === '' || !preg_match('~^data:image/[a-zA-Z0-9.+-]+;base64,~', $image)) {
        fail('Valid base64 image data URI required');
    }
    if (strlen($image) > 12 * 1024 * 1024) {
        fail('Image too large (max 12 MB)');
    }
    ensure_form_images_table();
    $stmt = db()->prepare('INSERT INTO form_images (data) VALUES (:data)');
    $stmt->execute([':data' => $image]);
    respond(['data' => ['id' => (int)db()->lastInsertId()]]);
}

/** GET /form-images/{id} -> raw image bytes with the right content type. */
function get_form_image(int $id): void
{
    ensure_form_images_table();
    $stmt = db()->prepare('SELECT data FROM form_images WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) {
        http_response_code(404);
        exit;
    }
    if (!preg_match('~^data:image/([a-zA-Z0-9.+-]+);base64,(.+)$~s', $row['data'], $m)) {
        http_response_code(404);
        exit;
    }
    $ext = strtolower($m[1]);
    $mime = $ext === 'jpeg' ? 'image/jpeg' : 'image/' . $ext;
    $bytes = base64_decode($m[2], true);
    if ($bytes === false) {
        http_response_code(404);
        exit;
    }
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . strlen($bytes));
    header('Cache-Control: public, max-age=31536000, immutable');
    echo $bytes;
    exit;
}

/* ----------------------- FORM BUILDER (persisted) ----------------------- */

/** Create the forms table on first use so no manual SQL step is required. */
function ensure_forms_table(): void
{
    static $done = false;
    if ($done) return;
    $done = true;
    db()->exec(
        'CREATE TABLE IF NOT EXISTS forms (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(191) NOT NULL,
            updated_by VARCHAR(191) DEFAULT "",
            elements MEDIUMTEXT NULL,
            header MEDIUMTEXT NULL,
            cols TINYINT NOT NULL DEFAULT 1,
            campaign_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
}

/** Decode JSON columns of a form row for the API response. */
function form_payload(array $row): array
{
    $row['elements'] = decode_json_field($row['elements'] ?? null);
    $row['header'] = decode_json_field($row['header'] ?? null);
    $row['cols'] = (int)$row['cols'] === 2 ? 2 : 1;
    return $row;
}

/** GET /forms -> every saved builder form. */
function list_forms(): void
{
    ensure_forms_table();
    $rows = db()->query('SELECT * FROM forms ORDER BY updated_at DESC, id DESC')->fetchAll();
    $rows = array_map('form_payload', $rows);
    respond(['data' => $rows, 'count' => count($rows)]);
}

/**
 * GET /forms/{id} -> one saved form. Public on purpose: short share links
 * (#/f/{id}) must render for visitors who are not signed in.
 */
function get_form(int $id): void
{
    ensure_forms_table();
    $stmt = db()->prepare('SELECT * FROM forms WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) fail('Form not found', 404);
    $payload = form_payload($row);
    // Internal bookkeeping - which staff member last edited the form - is not
    // part of the rendering contract and this endpoint needs no session.
    unset($payload['updated_by']);
    respond(['data' => $payload]);
}

/** POST /forms { name, updated_by?, elements?, header?, cols?, campaign_id? } */
function create_form(array $body): void
{
    // Form definitions are global: every public link points at them, so editing
    // the set is an Admin-level operation rather than a personal one.
    require_api_admin();
    ensure_forms_table();
    $name = normalize_optional($body['name'] ?? null);
    if ($name === null || $name === '') fail('Form name is required');

    $stmt = db()->prepare(
        'INSERT INTO forms (name, updated_by, elements, header, cols, campaign_id)
         VALUES (:name, :updated_by, :elements, :header, :cols, :campaign_id)'
    );
    $stmt->execute([
        ':name' => $name,
        ':updated_by' => normalize_optional($body['updated_by'] ?? null) ?? '',
        ':elements' => encode_json_field($body['elements'] ?? null),
        ':header' => encode_json_field($body['header'] ?? null),
        ':cols' => ((int)($body['cols'] ?? 1)) === 2 ? 2 : 1,
        ':campaign_id' => isset($body['campaign_id']) && (int)$body['campaign_id'] > 0 ? (int)$body['campaign_id'] : null,
    ]);
    $id = (int)db()->lastInsertId();
    $stmt = db()->prepare('SELECT * FROM forms WHERE id = :id');
    $stmt->execute([':id' => $id]);
    // Every outlet configured on the form gets its own smart list.
    ensure_outlet_smart_lists(extract_form_outlets($body['elements'] ?? null));
    respond(['data' => form_payload($stmt->fetch() ?: ['id' => $id]), 'message' => 'Form saved'], 201);
}

/** PUT /forms/{id} — full update of the builder form. */
function update_form(int $id, array $body): void
{
    require_api_admin();
    ensure_forms_table();
    $stmt = db()->prepare('SELECT id FROM forms WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if ($stmt->fetchColumn() === false) fail('Form not found', 404);

    $sets = [];
    $params = [':id' => $id];
    if (array_key_exists('name', $body)) {
        $name = normalize_optional($body['name']);
        if ($name === null || $name === '') fail('Form name is required');
        $sets[] = 'name = :name';
        $params[':name'] = $name;
    }
    if (array_key_exists('updated_by', $body)) {
        $sets[] = 'updated_by = :updated_by';
        $params[':updated_by'] = normalize_optional($body['updated_by']) ?? '';
    }
    if (array_key_exists('elements', $body)) {
        $sets[] = 'elements = :elements';
        $params[':elements'] = encode_json_field($body['elements']);
    }
    if (array_key_exists('header', $body)) {
        $sets[] = 'header = :header';
        $params[':header'] = encode_json_field($body['header']);
    }
    if (array_key_exists('cols', $body)) {
        $sets[] = 'cols = :cols';
        $params[':cols'] = ((int)$body['cols']) === 2 ? 2 : 1;
    }
    if (array_key_exists('campaign_id', $body)) {
        $sets[] = 'campaign_id = :campaign_id';
        $params[':campaign_id'] = $body['campaign_id'] !== null && (int)$body['campaign_id'] > 0 ? (int)$body['campaign_id'] : null;
    }
    if (!$sets) fail('No fields to update');

    db()->prepare('UPDATE forms SET ' . implode(', ', $sets) . ' WHERE id = :id')->execute($params);
    $stmt = db()->prepare('SELECT * FROM forms WHERE id = :id');
    $stmt->execute([':id' => $id]);
    // A newly added outlet on the form instantly gets its own smart list.
    if (array_key_exists('elements', $body)) {
        ensure_outlet_smart_lists(extract_form_outlets($body['elements']));
    }
    respond(['data' => form_payload($stmt->fetch() ?: []), 'message' => 'Form updated']);
}

/** DELETE /forms/{id} */
function delete_form(int $id): void
{
    require_api_admin();
    ensure_forms_table();
    $stmt = db()->prepare('DELETE FROM forms WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if ($stmt->rowCount() === 0) fail('Form not found', 404);
    respond(['message' => 'Form deleted']);
}

/* ----------------------- SALES TAX INVOICES ----------------------- */

/** Create the invoices table on first use so no manual SQL step is required. */
function ensure_invoices_table(): void
{
    static $done = false;
    if ($done) return;
    $done = true;
    db()->exec(
        'CREATE TABLE IF NOT EXISTS invoices (
            id INT AUTO_INCREMENT PRIMARY KEY,
            invoice_no VARCHAR(191) NOT NULL,
            dated VARCHAR(20) DEFAULT "",
            strn VARCHAR(64) DEFAULT "",
            address VARCHAR(255) DEFAULT "",
            customer_name VARCHAR(255) DEFAULT "",
            qty INT NOT NULL DEFAULT 1,
            motorcycle VARCHAR(255) DEFAULT "",
            model_year VARCHAR(20) DEFAULT "",
            colour VARCHAR(100) DEFAULT "",
            engine_no VARCHAR(100) DEFAULT "",
            chassis_no VARCHAR(100) DEFAULT "",
            value_excl DECIMAL(12,2) NOT NULL DEFAULT 0,
            tax_rate DECIMAL(6,2) NOT NULL DEFAULT 18,
            tax_payable DECIMAL(12,2) NOT NULL DEFAULT 0,
            value_incl DECIMAL(12,2) NOT NULL DEFAULT 0,
            created_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_invoices_invoice_no (invoice_no),
            INDEX idx_invoices_created_by (created_by)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );

    // Lazy migration for installs created before the editable seller address.
    $col = db()->prepare(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME   = 'invoices'
            AND COLUMN_NAME  = 'address'"
    );
    $col->execute();
    if ((int)$col->fetchColumn() === 0) {
        db()->exec('ALTER TABLE invoices ADD COLUMN address VARCHAR(255) DEFAULT "" AFTER strn');
    }

    // Per-invoice editable copy + manual amount overrides. One JSON column
    // covers every free-text node on the sheet and the three computed totals,
    // so making the whole document editable needs no further migrations.
    $col2 = db()->prepare(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME   = 'invoices'
            AND COLUMN_NAME  = 'content'"
    );
    $col2->execute();
    if ((int)$col2->fetchColumn() === 0) {
        db()->exec('ALTER TABLE invoices ADD COLUMN content MEDIUMTEXT NULL AFTER value_incl');
    }
}

/** Cast an invoice row's numeric columns for the API response. */
function invoice_payload(array $row): array
{
    foreach (['id', 'qty'] as $k) {
        $row[$k] = (int)$row[$k];
    }
    foreach (['value_excl', 'tax_rate', 'tax_payable', 'value_incl'] as $k) {
        $row[$k] = (float)$row[$k];
    }
    $row['content'] = decode_json_field($row['content'] ?? null);
    $row['created_by'] = isset($row['created_by']) && $row['created_by'] !== null ? (int)$row['created_by'] : null;
    return $row;
}

/**
 * GET /invoices[?search=]
 *
 * Newest first; optional search across number/customer/bike/engine/chassis.
 * Invoices hold customer names and amounts, so `created_by` is taken from the
 * session: an Admin sees everything, anyone else only the invoices they raised.
 * A `?created_by=` parameter is ignored for the same reason `restrict_to` was.
 */
function list_invoices(array $filters): void
{
    ensure_invoices_table();
    $where = [];
    $params = [];

    if (!empty($filters['search'])) {
        $term = '%' . $filters['search'] . '%';
        $cols = ['invoice_no', 'customer_name', 'motorcycle', 'engine_no', 'chassis_no'];
        $pats = [];
        foreach ($cols as $i => $col) {
            $pname = ':search' . $i;
            $params[$pname] = $term;
            $pats[] = "$col LIKE $pname";
        }
        $where[] = '(' . implode(' OR ', $pats) . ')';
    }
    if (!is_api_admin()) {
        $where[] = 'created_by = :mine';
        $params[':mine'] = current_user_id();
    }

    $sql = 'SELECT * FROM invoices';
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    $sql .= ' ORDER BY id DESC';

    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    respond(['data' => array_map('invoice_payload', $rows), 'count' => count($rows)]);
}

/**
 * GET /invoices/next-number
 * Suggests the next sequential invoice number from the highest numeric
 * invoice_no already saved ("084" -> "085", keeping the digit width).
 */
function next_invoice_number(): void
{
    ensure_invoices_table();
    $rows = db()->query('SELECT invoice_no FROM invoices')->fetchAll(PDO::FETCH_COLUMN);
    $max = 0;
    $width = 3;
    foreach ($rows as $no) {
        $digits = preg_replace('/\D+/', '', (string)$no);
        if ($digits !== '' && (int)$digits >= $max) {
            $max = (int)$digits;
            $width = max($width, strlen(ltrim($digits, '0')) ?: 1);
        }
    }
    respond(['data' => ['invoice_no' => str_pad((string)($max + 1), $width, '0', STR_PAD_LEFT)]]);
}

/** Shared insert/update column list for an invoice request body. */
function invoice_columns(array $body): array
{
    $qty = max(1, to_int((string)($body['qty'] ?? 1)));
    $num = static function ($v): float {
        $cleaned = preg_replace('/[^0-9.\-]/', '', (string)($v ?? 0));
        return (float)($cleaned === '' ? 0 : $cleaned);
    };

    return [
        'invoice_no' => trim((string)($body['invoice_no'] ?? '')),
        'dated' => normalize_optional($body['dated'] ?? null) ?? '',
        'strn' => normalize_optional($body['strn'] ?? null) ?? '',
        'address' => normalize_optional($body['address'] ?? null) ?? '',
        'customer_name' => normalize_optional($body['customer_name'] ?? null) ?? '',
        'qty' => $qty,
        'motorcycle' => normalize_optional($body['motorcycle'] ?? null) ?? '',
        'model_year' => normalize_optional($body['model_year'] ?? null) ?? '',
        'colour' => normalize_optional($body['colour'] ?? null) ?? '',
        'engine_no' => normalize_optional($body['engine_no'] ?? null) ?? '',
        'chassis_no' => normalize_optional($body['chassis_no'] ?? null) ?? '',
        'value_excl' => $num($body['value_excl'] ?? 0),
        'tax_rate' => $num($body['tax_rate'] ?? 0),
        'tax_payable' => $num($body['tax_payable'] ?? 0),
        'value_incl' => $num($body['value_incl'] ?? 0),
        'content' => encode_json_field($body['content'] ?? null),
    ];
}

/** POST /invoices — save a new sales tax invoice. */
function create_invoice(array $body): void
{
    ensure_invoices_table();
    $c = invoice_columns($body);
    if ($c['invoice_no'] === '') fail('Invoice number is required');

    // Never allow two invoices with the same visible number.
    $dup = db()->prepare('SELECT id FROM invoices WHERE invoice_no = :no');
    $dup->execute([':no' => $c['invoice_no']]);
    if ($dup->fetchColumn() !== false) {
        fail('An invoice with number "' . $c['invoice_no'] . '" already exists', 409);
    }

    // Ownership comes from the session. Honouring a body `created_by` would let
    // a dealer file an invoice against a colleague, and since the list is scoped
    // by this column it is also a way to hide your own invoices.
    $createdBy = current_user_id();

    $stmt = db()->prepare(
        'INSERT INTO invoices (invoice_no, dated, strn, address, customer_name, qty, motorcycle, model_year,
                               colour, engine_no, chassis_no, value_excl, tax_rate, tax_payable,
                               value_incl, content, created_by)
         VALUES (:no, :dated, :strn, :address, :cust, :qty, :moto, :year, :colour, :engine, :chassis,
                 :vexcl, :rate, :tpay, :vincl, :content, :created_by)'
    );
    $stmt->execute([
        ':no' => $c['invoice_no'],
        ':dated' => $c['dated'],
        ':strn' => $c['strn'],
        ':address' => $c['address'],
        ':cust' => $c['customer_name'],
        ':qty' => $c['qty'],
        ':moto' => $c['motorcycle'],
        ':year' => $c['model_year'],
        ':colour' => $c['colour'],
        ':engine' => $c['engine_no'],
        ':chassis' => $c['chassis_no'],
        ':vexcl' => $c['value_excl'],
        ':rate' => $c['tax_rate'],
        ':tpay' => $c['tax_payable'],
        ':vincl' => $c['value_incl'],
        ':content' => $c['content'],
        ':created_by' => $createdBy,
    ]);
    $id = (int)db()->lastInsertId();

    $get = db()->prepare('SELECT * FROM invoices WHERE id = :id');
    $get->execute([':id' => $id]);
    respond(['data' => invoice_payload($get->fetch() ?: ['id' => $id]), 'message' => 'Invoice saved'], 201);
}

/**
 * Confirm the caller may touch this invoice.
 *
 * Admins may edit anything; anybody else only the invoices they created. The
 * check is done in the UPDATE/DELETE statement itself so a race cannot slip an
 * edit through between the read and the write.
 */
function require_invoice_access(int $id): void
{
    if (is_api_admin()) return;
    $stmt = db()->prepare('SELECT 1 FROM invoices WHERE id = :id AND created_by = :me LIMIT 1');
    $stmt->execute([':id' => $id, ':me' => current_user_id()]);
    if (!$stmt->fetchColumn()) fail('Invoice not found', 404);
}

/** PUT /invoices/{id} — update an existing sales tax invoice. */
function update_invoice(int $id, array $body): void
{
    ensure_invoices_table();
    require_invoice_access($id);
    $existing = db()->prepare('SELECT id FROM invoices WHERE id = :id');
    $existing->execute([':id' => $id]);
    if ($existing->fetchColumn() === false) fail('Invoice not found', 404);

    $c = invoice_columns($body);
    if ($c['invoice_no'] === '') fail('Invoice number is required');

    // The duplicate check must ignore the invoice being edited itself.
    $dup = db()->prepare('SELECT id FROM invoices WHERE invoice_no = :no AND id <> :id');
    $dup->execute([':no' => $c['invoice_no'], ':id' => $id]);
    if ($dup->fetchColumn() !== false) {
        fail('An invoice with number "' . $c['invoice_no'] . '" already exists', 409);
    }

    db()->prepare(
        'UPDATE invoices SET invoice_no = :no, dated = :dated, strn = :strn, address = :address,
                customer_name = :cust, qty = :qty, motorcycle = :moto, model_year = :year, colour = :colour,
                engine_no = :engine, chassis_no = :chassis, value_excl = :vexcl, tax_rate = :rate,
                tax_payable = :tpay, value_incl = :vincl, content = :content
          WHERE id = :id'
    )->execute([
        ':no' => $c['invoice_no'],
        ':dated' => $c['dated'],
        ':strn' => $c['strn'],
        ':address' => $c['address'],
        ':cust' => $c['customer_name'],
        ':qty' => $c['qty'],
        ':moto' => $c['motorcycle'],
        ':year' => $c['model_year'],
        ':colour' => $c['colour'],
        ':engine' => $c['engine_no'],
        ':chassis' => $c['chassis_no'],
        ':vexcl' => $c['value_excl'],
        ':rate' => $c['tax_rate'],
        ':tpay' => $c['tax_payable'],
        ':vincl' => $c['value_incl'],
        ':content' => $c['content'],
        ':id' => $id,
    ]);

    $get = db()->prepare('SELECT * FROM invoices WHERE id = :id');
    $get->execute([':id' => $id]);
    respond(['data' => invoice_payload($get->fetch() ?: []), 'message' => 'Invoice updated']);
}

/** DELETE /invoices/{id} */
function delete_invoice(int $id): void
{
    ensure_invoices_table();
    require_invoice_access($id);
    $stmt = db()->prepare('DELETE FROM invoices WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if ($stmt->rowCount() === 0) fail('Invoice not found', 404);
    respond(['message' => 'Invoice deleted']);
}

/* ----------------------- EMAILS (SMTP campaign sender) ----------------------- */

/**
 * POST /emails/send { to: string|string[], cc?, bcc?, subject, html, from_name? }
 * Sends the composed message through the crm@yadea.com.pk SMTP account.
 */
function send_email_campaign(array $body): void
{
    $to = $body['to'] ?? ($body['recipients'] ?? null);
    if ($to === null) fail('"to" (string or array of emails) is required');
    if (trim((string)($body['subject'] ?? '')) === '') fail('Subject is required');
    if (trim((string)($body['html'] ?? '')) === '') fail('Message body (html) is required');

    $result = send_crm_mail([
        'to' => $to,
        'cc' => $body['cc'] ?? null,
        'bcc' => $body['bcc'] ?? null,
        'subject' => (string)$body['subject'],
        'html' => (string)$body['html'],
        'from_name' => $body['from_name'] ?? null,
    ]);

    respond([
        'data' => [
            'sent_count' => count($result['sent']),
            'failed_count' => count($result['failed']),
            'sent' => $result['sent'],
            'failed' => $result['failed'],
        ],
        'message' => count($result['sent']) . ' email(s) sent via SMTP',
    ]);
}

/**
 * POST /emails/test { to, subject?, html? } -> quick deliverability check.
 */
function send_test_email(array $body): void
{
    $to = trim((string)($body['to'] ?? ''));
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) fail('A valid "to" email is required');

    $subject = trim((string)($body['subject'] ?? '')) ?: 'Yadea CRM — SMTP test email';
    $html = trim((string)($body['html'] ?? ''))
        ?: '<p style="margin:0 0 10px 0;font-size:14px;color:#334155;">This is a test message from Yadea CRM.</p>'
            . '<p style="margin:0;font-size:13px;color:#64748b;">If you received this, the SMTP account '
            . htmlspecialchars(defined('SMTP_USER') ? SMTP_USER : '', ENT_QUOTES, 'UTF-8')
            . ' is working correctly.</p>';

    $result = send_crm_mail(['to' => $to, 'subject' => $subject, 'html' => $html]);
    if (count($result['sent']) === 1) {
        respond(['data' => ['sent' => $result['sent'], 'failed' => $result['failed']], 'message' => "Test email sent to {$to}"]);
    }
    fail('SMTP send failed: ' . (reset($result['failed']) ?: 'unknown error'));
}

/* ----------------------- PORTAL SUBMISSIONS (dealership + inquiries) ----------------------- */

/**
 * Shared store for the two public-style portal forms: dealership
 * applications and customer support inquiries. Admins can assign inquiries
 * to Dealer staff accounts.
 */
function ensure_portal_submissions_table(): void
{
    static $done = false;
    if ($done) return;
    $done = true;
    db()->exec(
        'CREATE TABLE IF NOT EXISTS portal_submissions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            type VARCHAR(20) NOT NULL,
            code VARCHAR(24) DEFAULT "",
            name VARCHAR(255) DEFAULT "",
            email VARCHAR(255) DEFAULT "",
            phone VARCHAR(64) DEFAULT "",
            business_name VARCHAR(255) DEFAULT "",
            address VARCHAR(255) DEFAULT "",
            years_in_business VARCHAR(16) DEFAULT "",
            oem_dealer VARCHAR(16) DEFAULT "",
            province VARCHAR(64) DEFAULT "",
            city VARCHAR(64) DEFAULT "",
            property_ownership VARCHAR(64) DEFAULT "",
            structure VARCHAR(64) DEFAULT "",
            file_name VARCHAR(255) DEFAULT "",
            chassis_number VARCHAR(100) DEFAULT "",
            order_number VARCHAR(100) DEFAULT "",
            problem_category VARCHAR(120) DEFAULT "",
            reason TEXT,
            assigned_to INT NULL,
            status VARCHAR(20) NOT NULL DEFAULT "new",
            created_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_ps_type (type),
            INDEX idx_ps_assigned (assigned_to)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
}

/** Normalise every submission text field in one place. */
function portal_submission_fields(array $body): array
{
    $t = static fn ($v): string => normalize_optional($v ?? null) ?? '';
    return [
        'name' => $t($body['name'] ?? ''),
        'email' => $t($body['email'] ?? ''),
        'phone' => $t($body['phone'] ?? ''),
        'business_name' => $t($body['business_name'] ?? ''),
        'address' => $t($body['address'] ?? ''),
        'years_in_business' => $t($body['years_in_business'] ?? ''),
        'oem_dealer' => $t($body['oem_dealer'] ?? ''),
        'province' => $t($body['province'] ?? ''),
        'city' => $t($body['city'] ?? ''),
        'property_ownership' => $t($body['property_ownership'] ?? ''),
        'structure' => $t($body['structure'] ?? ''),
        'file_name' => $t($body['file_name'] ?? ''),
        'chassis_number' => $t($body['chassis_number'] ?? ''),
        'order_number' => $t($body['order_number'] ?? ''),
        'problem_category' => $t($body['problem_category'] ?? ''),
        'reason' => $t($body['reason'] ?? ''),
    ];
}

function portal_submission_payload(array $row): array
{
    $row['id'] = (int)$row['id'];
    $row['assigned_to'] = $row['assigned_to'] !== null ? (int)$row['assigned_to'] : null;
    $row['created_by'] = $row['created_by'] !== null ? (int)$row['created_by'] : null;
    return $row;
}

/** POST /submissions - create a dealership application or inquiry ticket. */
function create_submission(array $body): void
{
    ensure_portal_submissions_table();
    $type = ($body['type'] ?? '') === 'inquiry' ? 'inquiry' : 'dealership';
    $f = portal_submission_fields($body);

    if ($f['name'] === '' && $f['business_name'] === '') fail('Name is required');
    if ($type === 'inquiry' && $f['chassis_number'] === '') fail('Chassis number is required');

    // Human-friendly reference code, retried on the rare duplicate.
    $prefix = $type === 'inquiry' ? 'TCK-' : 'DLR-';
    $code = '';
    for ($i = 0; $i < 5; $i++) {
        $candidate = $prefix . random_int(1000, 9999);
        $chk = db()->prepare('SELECT id FROM portal_submissions WHERE code = :c LIMIT 1');
        $chk->execute([':c' => $candidate]);
        if ($chk->fetchColumn() === false) {
            $code = $candidate;
            break;
        }
    }
    if ($code === '') $code = $prefix . time();

    $stmt = db()->prepare(
        'INSERT INTO portal_submissions
            (type, code, name, email, phone, business_name, address, years_in_business,
             oem_dealer, province, city, property_ownership, structure, file_name,
             chassis_number, order_number, problem_category, reason, created_by)
         VALUES (:type, :code, :name, :email, :phone, :biz, :address, :years,
                 :oem, :province, :city, :prop, :structure, :file,
                 :chassis, :order, :problem, :reason, :created_by)'
    );
    $stmt->execute([
        ':type' => $type,
        ':code' => $code,
        ':name' => $f['name'],
        ':email' => $f['email'],
        ':phone' => $f['phone'],
        ':biz' => $f['business_name'],
        ':address' => $f['address'],
        ':years' => $f['years_in_business'],
        ':oem' => $f['oem_dealer'],
        ':province' => $f['province'],
        ':city' => $f['city'],
        ':prop' => $f['property_ownership'],
        ':structure' => $f['structure'],
        ':file' => $f['file_name'],
        ':chassis' => $f['chassis_number'],
        ':order' => $f['order_number'],
        ':problem' => $f['problem_category'],
        ':reason' => $f['reason'],
        // Recorded from the session, never from the body: this endpoint is
        // public, so a caller-supplied created_by would let anyone forge the
        // audit trail ("this was submitted by staff #7").
        ':created_by' => api_current_user() !== null ? current_user_id() : null,
    ]);

    // Always acknowledge the person who filled in the form on THEIR email
    // (the one they wrote into the form), not just on the CRM inbox side.
    $subHtml = '<p style="margin:0 0 14px 0;font-size:14px;line-height:22px;color:#334155;">Thank you '
        . htmlspecialchars(trim($f['name']), ENT_QUOTES, 'UTF-8') . ',</p>'
        . '<p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#334155;">We have received your '
        . ($type === 'inquiry' ? 'inquiry' : 'dealership application')
        . '. Our team will review it and get back to you shortly.</p>'
        . '<p style="margin:0;font-size:13px;line-height:20px;color:#64748b;">Your reference code is <strong style="color:#EB5F1B;">'
        . htmlspecialchars((string)$code, ENT_QUOTES, 'UTF-8') . '</strong>.</p>';
    send_app_mail(
        (string)$f['email'],
        trim($f['name']),
        $type === 'inquiry' ? 'We received your inquiry' : 'We received your dealership application',
        $subHtml
    );

    // Notify the CRM team with the full submission details (CRM mailbox copy
    // + Admin portal/email notification), so a form never lands silently.
    $label = $type === 'inquiry' ? 'Support inquiry' : 'Dealership application';
    $notifyFields = [
        'Reference' => $code,
        'Type' => $label,
        'Name' => $f['name'],
        'Email' => $f['email'],
        'Phone' => $f['phone'],
        'Business' => $f['business_name'],
        'Address' => $f['address'],
        'Years in business' => $f['years_in_business'],
        'OEM dealer' => $f['oem_dealer'],
        'Province' => $f['province'],
        'City' => $f['city'],
        'Property ownership' => $f['property_ownership'],
        'Structure' => $f['structure'],
        'Chassis number' => $f['chassis_number'],
        'Order number' => $f['order_number'],
        'Problem category' => $f['problem_category'],
        'Reason / details' => $f['reason'],
    ];
    notify_form_submission_mail(
        $notifyFields,
        $label,
        $code,
        $type === 'inquiry' ? 'inquiry_received' : 'application_received'
    );

    $get = db()->prepare(
        'SELECT s.*, u.full_name AS assigned_to_name FROM portal_submissions s
         LEFT JOIN staff_users u ON u.id = s.assigned_to WHERE s.id = :id'
    );
    $get->execute([':id' => (int)db()->lastInsertId()]);
    respond(['data' => portal_submission_payload($get->fetch() ?: []), 'message' => 'Submission saved'], 201);
}

/**
 * GET /submissions?type=&assigned_to=&search=
 *
 * Dealers/followers see only the inquiries assigned to them; unassigned
 * submissions stay with the Admin until somebody hands them over. The lock is
 * applied from the session, not from a `restrict_to` parameter.
 */
function list_submissions(array $filters): void
{
    ensure_portal_submissions_table();
    $where = [];
    $params = [];

    if (!empty($filters['type'])) {
        $where[] = 's.type = :type';
        $params[':type'] = $filters['type'] === 'inquiry' ? 'inquiry' : 'dealership';
    }
    if (!empty($filters['assigned_to'])) {
        $aid = to_int((string)$filters['assigned_to']);
        if ($aid > 0) {
            $where[] = 's.assigned_to = :aid';
            $params[':aid'] = $aid;
        }
    }
    // Tenancy from the session; a ?restrict_to= parameter is ignored.
    if (!is_api_admin()) {
        $where[] = 's.assigned_to = :rid';
        $params[':rid'] = current_user_id();
    }
    if (!empty($filters['search'])) {
        $term = '%' . $filters['search'] . '%';
        $cols = ['s.code', 's.name', 's.email', 's.phone', 's.business_name', 's.city', 's.chassis_number', 's.problem_category'];
        $pats = [];
        foreach ($cols as $i => $col) {
            $pname = ':search' . $i;
            $params[$pname] = $term;
            $pats[] = "$col LIKE $pname";
        }
        $where[] = '(' . implode(' OR ', $pats) . ')';
    }

    $sql = 'SELECT s.*, u.full_name AS assigned_to_name FROM portal_submissions s
            LEFT JOIN staff_users u ON u.id = s.assigned_to';
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    $sql .= ' ORDER BY s.id DESC';

    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    respond(['data' => array_map('portal_submission_payload', $stmt->fetchAll()), 'count' => $stmt->rowCount()]);
}

/** POST /submissions/{id}/assign { assigned_to } -> assign/unassign a dealer. */
function assign_submission(int $id, array $body): void
{
    // Handing an inquiry to a dealer decides whose book it lands in, so only an
    // Admin may do it.
    require_api_admin();
    ensure_portal_submissions_table();
    $dealerId = to_int((string)($body['assigned_to'] ?? 0));

    if ($dealerId > 0) {
        $chk = db()->prepare("SELECT id FROM staff_users WHERE id = :id AND user_type IN ('Admin','Dealer') LIMIT 1");
        $chk->execute([':id' => $dealerId]);
        if ($chk->fetchColumn() === false) fail('Dealer not found', 404);
    }

    $stmt = db()->prepare(
        'UPDATE portal_submissions SET assigned_to = :aid, status = :status WHERE id = :id'
    );
    $stmt->execute([
        ':aid' => $dealerId > 0 ? $dealerId : null,
        ':status' => $dealerId > 0 ? 'assigned' : 'new',
        ':id' => $id,
    ]);
    if ($stmt->rowCount() === 0) {
        $exists = db()->prepare('SELECT id FROM portal_submissions WHERE id = :id');
        $exists->execute([':id' => $id]);
        if ($exists->fetchColumn() === false) fail('Submission not found', 404);
    }

    // Portal bell + email notification so the dealer instantly knows about
    // the new assignment (email rides on notify_staff's SMTP path).
    if ($dealerId > 0) {
        $get = db()->prepare('SELECT * FROM portal_submissions WHERE id = :id');
        $get->execute([':id' => $id]);
        $s = $get->fetch();
        if ($s) {
            $isInquiry = ($s['type'] ?? '') === 'inquiry';
            $who = $s['name'] !== '' ? $s['name'] : ($s['business_name'] ?: 'A customer');
            $place = $s['city'] !== '' ? ', ' . $s['city'] : '';
            $title = $isInquiry
                ? 'New support ticket assigned to you'
                : 'New dealership application assigned to you';
            $detail = $isInquiry
                ? "Ticket {$s['code']} — {$s['problem_category']} for {$who}{$place} (chassis {$s['chassis_number']}). Open Customer Inquiries to follow up."
                : "Application {$s['code']} from {$who}{$place} ({$s['business_name']}). Open Dealership Page to review.";
            notify_staff($dealerId, null, $isInquiry ? 'inquiry_assigned' : 'application_assigned', $title, $detail);
        }
    }

    $get = db()->prepare(
        'SELECT s.*, u.full_name AS assigned_to_name FROM portal_submissions s
         LEFT JOIN staff_users u ON u.id = s.assigned_to WHERE s.id = :id'
    );
    $get->execute([':id' => $id]);
    respond([
        'data' => portal_submission_payload($get->fetch() ?: []),
        'message' => $dealerId > 0 ? 'Inquiry assigned' : 'Assignment removed',
    ]);
}

/** DELETE /submissions/{id} */
function delete_submission(int $id): void
{
    ensure_portal_submissions_table();
    // A non-Admin may only discard an inquiry sitting in their own book.
    if (!is_api_admin()) {
        $own = db()->prepare('SELECT 1 FROM portal_submissions WHERE id = :id AND assigned_to = :me LIMIT 1');
        $own->execute([':id' => $id, ':me' => current_user_id()]);
        if (!$own->fetchColumn()) fail('Submission not found', 404);
    }
    db()->prepare('DELETE FROM portal_submissions WHERE id = :id')->execute([':id' => $id]);
    respond(['message' => 'Submission deleted']);
}

/**
 * Repair contacts whose name fell back to "Imported Lead".
 * Their real name lives inside custom_fields.import_data (and, for very old
 * imports, nested again under import_data.custom_fields as a JSON string).
 * Idempotent: skips rows that no longer carry the placeholder name.
 */
function repair_imported_names(): void
{
    $pdo = db();
    $rows = $pdo->query(
        "SELECT id, custom_fields FROM contacts WHERE first_name = 'Imported' AND last_name = 'Lead'"
    )->fetchAll();

    $fixed = 0;
    $skipped = 0;
    foreach ($rows as $row) {
        $id = (int)$row['id'];
        $cf = decode_custom_fields($row['custom_fields'] ?? null);
        $imp = $cf['import_data'] ?? null;

        $first = null;
        $last = null;

        if (is_array($imp)) {
            // Direct snapshot shape: first_name / last_name at top level.
            $probeFirst = trim((string)($imp['first_name'] ?? ''));
            $probeLast = trim((string)($imp['last_name'] ?? ''));
            if ($probeFirst !== '' && $probeFirst !== 'Imported' && $probeLast !== 'Lead') {
                $first = $probeFirst;
                $last = $probeLast;
            }
        }

        if ($first === null && is_array($imp) && is_string($imp['custom_fields'] ?? null)) {
            // Very old imports nested a JSON string with the ORIGINAL sheet row.
            $nested = decode_json_field($imp['custom_fields']);
            $nestedImp = is_array($nested) ? ($nested['import_data'] ?? null) : null;
            if (is_array($nestedImp)) {
                $name = trim((string)($nestedImp['NAME'] ?? $nestedImp['name'] ?? ''));
                if ($name !== '') {
                    $space = strpos($name, ' ');
                    if ($space === false) {
                        $first = $name;
                    } else {
                        $first = substr($name, 0, $space);
                        $last = substr($name, $space + 1);
                    }
                }
            }
        }

        if ($first === null || $first === '' || $first === 'Imported') {
            $skipped++;
            continue;
        }

        $upd = $pdo->prepare('UPDATE contacts SET first_name = :first, last_name = :last WHERE id = :id');
        $upd->execute([':first' => $first, ':last' => $last ?? '', ':id' => $id]);
        $fixed++;
    }

    respond([
        'data' => ['matched' => count($rows), 'fixed' => $fixed, 'skipped' => $skipped],
        'message' => 'Imported-name repair finished',
    ]);
}

/* ----------------------- ROUTER ----------------------- */

$method = $_SERVER['REQUEST_METHOD'];
$parts = route_parts();
$filters = $_GET;

$resource = $parts[0] ?? 'contacts';

/* ------------------------- AUTH GATE -------------------------
 *
 * Everything below the switch is CRM data, so it requires a session. The
 * only exceptions are the endpoints a public website form or a dealer
 * registration page has to reach without logging in.
 *
 * Before this gate the API trusted a `restrict_to` / `user_id` query
 * parameter for its visibility rules, so any caller — signed in or not —
 * could ask for somebody else's data or read the whole book.
 */
$publicRoutes = [
    // Signed-in endpoints under /auth (logout, me, reveal-password) still
    // require a session; these three are reachable without one.
    'auth'          => ['login', 'magic-login', 'register-dealer'],
    'public'        => [null],
    'submissions'   => [null],   // POST only; see below
    'form-images'   => [null],
    'forms'         => [null],
    'health'        => [null],
];
$publicSub = $publicRoutes[$resource] ?? null;
$isPublic = $publicSub !== null;
if ($isPublic && $resource === 'submissions' && $method !== 'POST') {
    // Reading, assigning or deleting submissions is CRM work.
    $isPublic = false;
}
if ($isPublic && $resource === 'public' && !($method === 'POST' && ($parts[1] ?? null) === 'leads')) {
    // Only "post a website form lead" is public; nothing else under /public.
    fail('Not found', 404);
}
if ($isPublic && $resource === 'forms' && !($method === 'GET' && isset($parts[1]))) {
    // Only fetching one form definition by id is public (the renderer needs it).
    // Listing, creating, editing and deleting forms are all CRM work.
    $isPublic = false;
}
if ($isPublic && $resource === 'form-images' && $method === 'POST') {
    // Uploading an image belongs to the form builder, not the public form.
    $isPublic = false;
}
if ($isPublic && $resource === 'auth' && $sub = ($parts[1] ?? null)) {
    // /auth/logout, /auth/me and /auth/reveal-password are session endpoints,
    // so they fall through to the normal gate; anything else unknown 404s.
    if (in_array($sub, ['logout', 'me', 'reveal-password'], true)) {
        $isPublic = false;
    } elseif (!in_array($sub, $publicSub, true)) {
        fail('Unknown auth endpoint', 404);
    }
}
if (!$isPublic) {
    require_api_user();
}

// Soft-delete support: DELETE keeps the DB row (deleted_at), views hide it.
if (in_array($resource, ['contacts', 'leads', 'maintenance'], true)) {
    ensure_soft_delete_support();
}

switch ($resource) {
    case 'public':
        if ($method === 'POST' && ($parts[1] ?? null) === 'leads') {
            create_public_lead(json_body());
        }
        break;

    case 'contacts':
        if ($method === 'GET') {
            $id = $parts[1] ?? null;
            $sub = $parts[2] ?? null;
            if ($id && $sub) {
                switch ($sub) {
                    case 'opportunities': list_opportunities(to_int($id)); break;
                    case 'tasks':         list_tasks(to_int($id));         break;
                    case 'notes':         list_notes(to_int($id));         break;
                    case 'appointments':  list_appointments(to_int($id));  break;
                    case 'followers':     list_followers(to_int($id));     break;
                    case 'activities':    list_activities(to_int($id));    break;
                    default: fail('Unknown sub-resource', 404);
                }
            }
            $id ? get_contact(to_int($id)) : list_contacts($filters);
        } elseif ($method === 'POST') {
            $body = json_body();
            if (($parts[1] ?? null) === 'bulk-delete') bulk_delete($body);
            elseif (($parts[2] ?? null) !== null) {
                $cid = to_int($parts[1]);
                switch ($parts[2]) {
                    case 'opportunities': create_opportunity($cid, $body); break;
                    case 'tasks':         create_task($cid, $body);        break;
                    case 'notes':         create_note($cid, $body);        break;
                    case 'appointments':  create_appointment($cid, $body); break;
                    case 'followers':     add_follower($cid, $body);       break;
                    case 'activities':    create_activity($cid, $body);    break;
                    default: fail('Unknown sub-resource', 404);
                }
            } else {
                create_contact($body);
            }
        } elseif ($method === 'PUT') {
            $id = $parts[1] ?? null;
            if (!$id) fail('Contact id required');
            update_contact(to_int($id), json_body());
        } elseif ($method === 'DELETE') {
            $id = $parts[1] ?? null;
            $sub = $parts[2] ?? null;
            if (!$id) fail('Contact id required');
            if ($sub === 'followers') {
                $staffId = to_int($parts[3] ?? 0);
                if ($staffId <= 0) fail('staff_id required');
                remove_follower(to_int($id), $staffId);
            } else {
                delete_contact(to_int($id));
            }
        }
        break;

    case 'leads':
        if ($method === 'GET') list_leads($filters);
        break;

    case 'tags':
        if ($method === 'GET') list_tags();
        break;

    case 'campaigns':
        if ($method === 'GET') list_campaigns($filters);
        break;

    case 'workflows':
        if ($method === 'GET') list_workflows($filters);
        break;

    case 'staff':
        $id = $parts[1] ?? null;
        if ($method === 'GET') {
            if ($id) {
                // Fetching a staff row returns permissions and profile data, so
                // it is Admin-only; the client's own row comes from /auth/me.
                require_api_admin();
                $rows = db()->query('SELECT * FROM staff_users WHERE id = ' . (int)$id)->fetchAll();
                if (!$rows) fail('Staff user not found', 404);
                respond(['data' => staff_payload($rows[0])]);
            }
            list_staff();
        } elseif ($method === 'POST') {
            if ($id && ($parts[2] ?? null) === 'approve') {
                approve_staff(to_int($id));
            } else {
                create_staff(json_body());
            }
        } elseif ($method === 'PUT') {
            if (!$id) fail('Staff id required');
            update_staff(to_int($id), json_body());
        } elseif ($method === 'DELETE') {
            if (!$id) fail('Staff id required');
            delete_staff(to_int($id));
        }
        break;

    case 'opportunities':
        if ($method === 'DELETE') {
            $id = $parts[1] ?? null;
            if (!$id) fail('Opportunity id required');
            delete_opportunity(to_int($id));
        }
        break;

    case 'tasks':
        if ($method === 'DELETE') {
            $id = $parts[1] ?? null;
            if (!$id) fail('Task id required');
            delete_task(to_int($id));
        }
        break;

    case 'notes':
        if ($method === 'DELETE') {
            $id = $parts[1] ?? null;
            if (!$id) fail('Note id required');
            delete_note(to_int($id));
        }
        break;

    case 'maintenance':
        // Global data surgery (mass renames, restoring anybody's deleted record,
        // reading the archive across every tenant) is Admin-only.
        require_api_admin();
        if ($method === 'POST' && ($parts[1] ?? null) === 'repair-imported-names') {
            repair_imported_names();
        }
        if ($method === 'POST' && ($parts[1] ?? null) === 'restore-contact') {
            $id = to_int($parts[2] ?? 0);
            if ($id <= 0) fail('Contact id required');
            $stmt = db()->prepare('UPDATE contacts SET deleted_at = NULL WHERE id = :id AND deleted_at IS NOT NULL');
            $stmt->execute([':id' => $id]);
            if ($stmt->rowCount() === 0) fail('Contact not found (or already active)', 404);
            respond(['message' => 'Contact restored']);
        }
        if ($method === 'GET' && ($parts[1] ?? null) === 'deleted-contacts') {
            $rows = db()->query(
                "SELECT id, first_name, last_name, phone, email, deleted_at FROM contacts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
            )->fetchAll();
            respond(['data' => $rows, 'count' => count($rows), 'message' => 'Archived contacts (kept in DB, hidden from live views)']);
        }
        fail('Unknown maintenance action', 404);
        break;

    case 'appointments':
        if ($method === 'GET') {
            list_all_appointments();
        }
        if ($method === 'DELETE') {
            $id = $parts[1] ?? null;
            if (!$id) fail('Appointment id required');
            delete_appointment(to_int($id));
        }
        break;

    case 'auth':
        if ($method === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
        if ($method !== 'POST' && $method !== 'GET') {
            fail('Only POST is allowed on /auth', 405);
        }
        $sub = $parts[1] ?? null;
        if ($sub === null && $method === 'GET') {
            auth_me();
        } elseif ($sub === 'register-dealer') {
            register_dealer(json_body());
        } elseif ($sub === 'reveal-password') {
            reveal_password(json_body());
        } elseif ($sub === 'magic-login') {
            magic_login(json_body());
        } elseif ($sub === 'logout') {
            logout();
        } else {
            login(json_body());
        }
        break;

    case 'dealer-dashboard':
        $sub = $parts[1] ?? null;
        if ($method === 'GET') {
            if ($sub === 'summary') {
                // Admin-only inside: aggregates every dealer at once.
                dealer_dashboard_summary();
            } elseif ($sub === 'unassigned') {
                // Admin-only inside: the pool nobody owns yet.
                dealer_unassigned_leads();
            } elseif ($sub === 'leads') {
                // Admin-only inside: reading another dealer's pipeline.
                $dealerId = to_int((string)($filters['dealer_id'] ?? 0));
                if ($dealerId <= 0) fail('dealer_id is required');
                dealer_leads($dealerId, isset($filters['status']) ? (string)$filters['status'] : null);
            } elseif ($sub === 'my-leads') {
                // The staff id is taken from the session, not from ?staff_id=.
                my_dealer_leads(current_user_id(), isset($filters['status']) ? (string)$filters['status'] : null);
            } else {
                fail('Unknown sub-resource', 404);
            }
        } elseif ($method === 'POST') {
            if ($sub === 'assign') {
                assign_leads_to_dealer(json_body());
            } elseif ($sub === 'bulk-status') {
                bulk_update_dealer_lead_status(json_body());
            } else {
                fail('Unknown sub-resource', 404);
            }
        } elseif ($method === 'PUT') {
            if ($sub === 'leads' && ($parts[3] ?? null) === 'status') {
                update_dealer_lead_status(to_int($parts[2]), json_body());
            } else {
                fail('Unknown sub-resource', 404);
            }
        }
        break;

    case 'smart-lists':
        $id = $parts[1] ?? null;
        $sub = $parts[2] ?? null;
        if ($method === 'GET') {
            list_smart_lists($filters);
        } elseif ($method === 'POST') {
            if ($id && $sub === 'duplicate') {
                duplicate_smart_list(to_int($id), json_body());
            } else {
                create_smart_list(json_body());
            }
        } elseif ($method === 'PUT') {
            if (!$id) fail('Smart list id required');
            update_smart_list(to_int($id), json_body());
        } elseif ($method === 'DELETE') {
            if (!$id) fail('Smart list id required');
            delete_smart_list(to_int($id), $filters);
        }
        break;

    case 'notifications':
        if ($method === 'GET') {
            if (($parts[1] ?? null) === 'unread-count') {
                notifications_unread_count();
            } else {
                list_notifications($filters);
            }
        } elseif ($method === 'POST') {
            if (($parts[1] ?? null) === 'read-all') {
                mark_all_notifications_read(json_body());
            } elseif (isset($parts[1]) && ($parts[2] ?? null) === 'read') {
                mark_notification_read(to_int($parts[1]));
            } else {
                create_notification(json_body());
            }
        }
        break;

    case 'form-images':
        if ($method === 'POST') {
            store_form_image(json_body());
        } elseif ($method === 'GET') {
            $id = $parts[1] ?? null;
            if ($id === null) fail('Image id required');
            get_form_image(to_int($id));
        }
        break;

    case 'forms':
        $id = $parts[1] ?? null;
        if ($method === 'GET') {
            if ($id !== null) {
                get_form(to_int($id));
            } else {
                list_forms();
            }
        } elseif ($method === 'POST') {
            create_form(json_body());
        } elseif ($method === 'PUT') {
            if (!$id) fail('Form id required');
            update_form(to_int($id), json_body());
        } elseif ($method === 'DELETE') {
            if (!$id) fail('Form id required');
            delete_form(to_int($id));
        }
        break;

    case 'invoices':
        $id = $parts[1] ?? null;
        if ($method === 'GET') {
            if ($id === null) list_invoices($filters);
            elseif ($id === 'next-number') next_invoice_number();
            else fail('Unknown invoice endpoint', 404);
        } elseif ($method === 'POST') {
            create_invoice(json_body());
        } elseif ($method === 'PUT') {
            if (!$id) fail('Invoice id required');
            update_invoice(to_int($id), json_body());
        } elseif ($method === 'DELETE') {
            if (!$id) fail('Invoice id required');
            delete_invoice(to_int($id));
        }
        break;

    case 'emails':
        if ($method === 'POST') {
            $sub = $parts[1] ?? null;
            if ($sub === 'test') send_test_email(json_body());
            else send_email_campaign(json_body());
        }
        break;

    case 'submissions':
        if ($method === 'GET') {
            list_submissions($filters);
        } elseif ($method === 'POST') {
            if (($parts[1] ?? null) !== null && ($parts[2] ?? null) === 'assign') {
                assign_submission(to_int($parts[1]), json_body());
            } else {
                create_submission(json_body());
            }
        } elseif ($method === 'DELETE') {
            if (!$parts[1]) fail('Submission id required');
            delete_submission(to_int($parts[1]));
        }
        break;

case 'health':
        // Reachable without a session, so it must not disclose infrastructure:
        // only "is the app alive". No PHP version, no DB host/user, no row
        // counts, no file paths and no exception text.
        $info = [
            'status' => 'ok',
        ];
        try {
            db()->query('SELECT 1');
            $info['database'] = 'ok';
        } catch (Throwable $e) {
            $info['database'] = 'unavailable';
        }
        respond($info);
        break;

    default:
        fail('Unknown endpoint', 404);
}
