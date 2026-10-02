export interface ApiContact {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  business_name: string | null;
  contact_type: string;
  is_lead: number;
  avatar_color: string;
  avatar_data: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  assigned_to_avatar: string | null;
  notes: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string | null;
  last_activity_at: string | null;
  updated_at: string | null;
  tags: string[];
  tag_ids: number[];
  followers: ApiFollower[];
}

export interface StaffCallVoicemail {
  inboundTimeout: number;
  forwardNumber: string;
  missedTextBack: string;
  enableRecording: boolean;
}

export interface StaffAvailabilitySchedule {
  active: boolean;
  start: string;
  end: string;
}

export interface StaffAvailability {
  timezone: string;
  schedule: Record<string, StaffAvailabilitySchedule>;
  bufferTime: string;
  outOfOffice: boolean;
}

export interface StaffCalendarConfig {
  primaryCalendar: string;
  conflictCalendars: string[];
  syncMode: '1-way' | '2-way';
  autoConfirm: boolean;
}

export interface ApiStaffUser {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  extension: string | null;
  password: string | null;
  user_type: 'Admin' | 'Dealer' | 'Follower';
  manager_id: number | null;
  system_id: string | null;
  calendar: string | null;
  restrict_data: number;
  signature: string | null;
  avatar_data: string | null;
  personal_calendar: string | null;
  call_voicemail: StaffCallVoicemail;
  availability: StaffAvailability;
  calendar_config: StaffCalendarConfig;
  permissions: Record<string, boolean>;
  /** 1 = approved (can log in), 0 = waiting for admin approval. */
  approved?: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface StaffInput {
  first_name?: string;
  last_name?: string;
  email?: string;
  password?: string;
  phone?: string;
  extension?: string;
  user_type?: 'Admin' | 'Dealer' | 'Follower';
  manager_id?: number | null;
  system_id?: string;
  calendar?: string;
  restrict_data?: boolean;
  signature?: string;
  avatar_data?: string | null;
  personal_calendar?: string;
  call_voicemail?: StaffCallVoicemail;
  availability?: StaffAvailability;
  calendar_config?: StaffCalendarConfig;
  permissions?: Record<string, boolean>;
}

export interface ApiTag {
  id: number;
  name: string;
  color: string;
}

export interface ApiFollower {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  user_type: 'Admin' | 'Dealer' | 'Follower';
  avatar_data: string | null;
}

export interface ApiNotification {
  id: number;
  contact_id: number | null;
  type: string;
  title: string;
  detail: string;
  is_read: number;
  created_at: string;
  contact_name: string | null;
}

export type DealerLeadStatus = 'non_contacted' | 'contacted' | 'closed' | 'customer' | 'rejected';

export interface DealerDashboardDealer {
  dealer_id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_data: string | null;
  total: number;
  non_contacted: number;
  contacted: number;
  closed: number;
  customer: number;
  rejected: number;
}

export interface DealerLead {
  contact_id: number;
  name: string;
  phone: string | null;
  email: string | null;
  business_name: string | null;
  created_at: string | null;
  status: DealerLeadStatus;
  response_channel: string;
  response_note: string | null;
  contacted_at: string | null;
  responded_at: string | null;
  closed_at: string | null;
  updated_at: string | null;
  tags: string[];
  tag_ids: number[];
}

export interface DealerDashboardSummary {
  dealers: DealerDashboardDealer[];
  unassigned: number;
}

export interface ApiSmartList {
  id: number;
  name: string;
  filters: string[];
  sort_by: string;
  fields: string[];
  members: number[];
  dealer_id: number | null;
  dealer_name: string | null;
  shared_all: boolean;
  shared_user_ids: number[];
  created_by: number;
  created_by_name: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface SmartListInput {
  user_id: number;
  name: string;
  filters?: string[];
  sort_by?: string;
  fields?: string[];
  members?: number[];
  dealer_id?: number | null;
  shared_all?: boolean;
  shared_user_ids?: number[];
}

export interface ApiSmartForm {
  id: number;
  name: string;
  updated_by: string | null;
  elements: unknown[];
  header: Record<string, unknown> | null;
  cols: number;
  campaign_id: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SmartFormInput {
  name: string;
  updated_by?: string;
  elements?: unknown;
  header?: unknown;
  cols?: number;
  campaign_id?: number | null;
}

/**
 * Per-invoice editable overrides. `text` holds edited copy for every
 * free-text node on the sheet keyed by field id; the three amount keys hold a
 * manual replacement for the calculated figure, and an empty value means
 * "calculate automatically".
 */
export interface InvoiceContent {
  text?: Record<string, string>;
  totalExcl?: string;
  taxPayable?: string;
  totalIncl?: string;
}

/** Saved sales tax invoice row (GET /invoices). */
export interface ApiInvoice {
  id: number;
  invoice_no: string;
  dated: string;
  strn: string;
  address: string;
  customer_name: string;
  qty: number;
  motorcycle: string;
  model_year: string;
  colour: string;
  engine_no: string;
  chassis_no: string;
  value_excl: number;
  tax_rate: number;
  tax_payable: number;
  value_incl: number;
  content?: InvoiceContent | null;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Payload for creating/updating a sales tax invoice. */
export interface InvoiceInput {
  invoice_no: string;
  dated?: string;
  strn?: string;
  address?: string;
  customer_name?: string;
  qty?: number;
  motorcycle?: string;
  model_year?: string;
  colour?: string;
  engine_no?: string;
  chassis_no?: string;
  value_excl?: number;
  tax_rate?: number;
  tax_payable?: number;
  value_incl?: number;
  content?: InvoiceContent | null;
  created_by?: number | null;
}

export interface DealerLeadFilter {
  type: 'all' | 'days' | 'weeks' | 'months' | 'years' | 'range';
  value?: number;
  from?: string;
  to?: string;
}

/* ------------------- PORTAL SUBMISSIONS (dealership + inquiries) ------------------- */

export type PortalSubmissionType = 'dealership' | 'inquiry';

/** Row of the shared portal store (dealership applications + support tickets). */
export interface ApiPortalSubmission {
  id: number;
  type: PortalSubmissionType;
  code: string;
  name: string;
  email: string;
  phone: string;
  business_name: string;
  address: string;
  years_in_business: string;
  oem_dealer: string;
  province: string;
  city: string;
  property_ownership: string;
  structure: string;
  file_name: string;
  chassis_number: string;
  order_number: string;
  problem_category: string;
  reason: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  status: string;
  created_by: number | null;
  created_at: string | null;
}

export interface PortalSubmissionInput {
  type: PortalSubmissionType;
  name?: string;
  email?: string;
  phone?: string;
  business_name?: string;
  address?: string;
  years_in_business?: string;
  oem_dealer?: string;
  province?: string;
  city?: string;
  property_ownership?: string;
  structure?: string;
  file_name?: string;
  chassis_number?: string;
  order_number?: string;
  problem_category?: string;
  reason?: string;
  created_by?: number | null;
}

export interface PortalSubmissionFilter {
  type?: PortalSubmissionType;
  assigned_to?: number;
  restrict_to?: number;
  search?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

/** Response of POST /auth/register-dealer (public dealership form signup). */
export interface DealerRegistrationResult {
  data: ApiStaffUser;
  /** Working password for the account (generated or existing). */
  password: string | null;
  message: string;
}

export interface DealerRegistrationInput {
  first_name?: string;
  last_name?: string;
  email: string;
  phone?: string;
  /** Dealership Code field from the registration form (stored as system_id). */
  dealership_code?: string;
}

export interface ApiActivity {
  id: number;
  type: string;
  title: string;
  detail: string | null;
  created_at: string;
}

export type CampaignStatus = 'active' | 'paused' | 'canceled' | 'finished';

export interface ApiCampaign {
  id: number;
  name: string;
  status: CampaignStatus;
  description: string | null;
  created_at: string | null;
}

export interface ApiWorkflow {
  id: number;
  name: string;
  status: WorkflowStatus;
  description: string | null;
  created_at: string | null;
}

export type WorkflowStatus = 'active' | 'finished';

export interface Opportunity {
  id: number;
  contact_id: number;
  name: string;
  pipeline: string;
  stage: string;
  status: string;
  value: string;
  business_name: string;
  source: string | null;
  expected_close_date: string | null;
  tags: string[];
  created_at: string | null;
}

export interface TaskItem {
  id: number;
  contact_id: number;
  title: string;
  status: string;
  due_date: string;
  created_at: string | null;
}

export interface Note {
  id: number;
  contact_id: number;
  title: string;
  content: string | null;
  author: string;
  note_color: string | null;
  attachments: string[];
  associated_to: string | null;
  created_at: string | null;
}

export interface Appointment {
  id: number;
  contact_id: number;
  title: string;
  calendar: string;
  host: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  status: string;
  notes: string | null;
  category: string;
  created_at: string | null;
}

export interface ListParams {
  search?: string;
  tag?: string;
  type?: string;
  lead?: number;
  sort?: string;
  dir?: string;
  /** When set, only contacts assigned to / followed by this staff id are returned. */
  restrict_to?: number;
}

export interface CreateContactInput {
  first_name?: string;
  last_name?: string;
  name?: string;
  phone?: string;
  email?: string;
  business_name?: string;
  contact_type?: string;
  avatar_color?: string;
  avatar_data?: string | null;
  tags?: string[];
  custom_fields?: Record<string, unknown>;
}

export interface UpdateContactInput {
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  business_name?: string;
  contact_type?: string;
  avatar_data?: string | null;
  notes?: string;
  assigned_to?: number | null;
  tags?: string[];
  custom_fields?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Same-origin API base, auto-detecting the app's sub-directory.
 * Derives the path from the current URL so it works regardless of the
 * deployment folder name (e.g. /Yadea/, /Yadea-Pakistan/, or root /).
 */
function detectApiBases(): string[] {
  const path = window.location.pathname;
  const dir = path.substring(0, path.lastIndexOf('/') + 1);
  const bases = [`${dir}api/index.php`, '/api/index.php'];
  return [...new Set(bases)];
}

export const API_BASE = (() => {
  const path = window.location.pathname;
  const dir = path.substring(0, path.lastIndexOf('/') + 1);
  return `${dir}api/index.php`;
})();

let workingBase: string | null = null;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const bases = Array.from(
    new Set([workingBase, API_BASE].concat(detectApiBases()).filter(Boolean) as string[])
  );

  let lastErr: Error | null = null;

  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });

      const text = await res.text();
      let payload: unknown = null;
      let parseFailed = false;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          parseFailed = true;
        }
      }

      if (res.ok) {
        // A 2xx response carrying HTML (e.g. the SPA fallback page) means we
        // did NOT reach the real API — try the next base instead.
        if (parseFailed && text.trim().length > 0) {
          lastErr = new Error(`Non-JSON response from ${base}${path} (HTTP ${res.status})`);
          continue;
        }
        workingBase = base;
        return payload as T;
      }

      // A JSON body means we reached the real API (e.g. a 4xx/5xx error),
      // so surface that error instead of trying other bases.
      if (payload !== null) {
        const msg = (payload as { error?: string })?.error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }

      lastErr = new Error(`Invalid JSON from ${base}${path} (HTTP ${res.status})`);
    } catch (err) {
      lastErr = err as Error;
    }
  }

  throw lastErr ?? new Error(`Unable to reach the CRM API from ${window.location.origin}`);
}

function toQuery(params: ListParams): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== null) q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  listContacts: (params: ListParams = {}) =>
    request<{ data: ApiContact[]; count: number }>(`/contacts${toQuery(params)}`),

  getContact: (id: number) => request<{ data: ApiContact }>(`/contacts/${id}`),

  listLeads: (params: ListParams = {}) =>
    request<{ data: ApiContact[]; count: number }>(`/leads${toQuery(params)}`),

  listTags: () => request<{ data: ApiTag[] }>('/tags'),

  listCampaigns: (status?: CampaignStatus) =>
    request<{ data: ApiCampaign[]; count: number }>(`/campaigns${status ? `?status=${status}` : ''}`),

  listWorkflows: (status?: CampaignStatus) =>
    request<{ data: ApiWorkflow[]; count: number }>(`/workflows${status ? `?status=${status}` : ''}`),

  createContact: (input: CreateContactInput) =>
    request<{ data: { id: number }; message: string }>('/contacts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteContact: (id: number) =>
    request<{ message: string }>(`/contacts/${id}`, { method: 'DELETE' }),

  bulkDelete: (ids: number[]) =>
    request<{ message: string }>('/contacts/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  restoreContact: (id: number) =>
    request<{ message: string }>(`/maintenance/restore-contact/${id}`, { method: 'POST' }),

  listOpportunities: (contactId: number) =>
    request<{ data: Opportunity[]; count: number }>(`/contacts/${contactId}/opportunities`),

  createOpportunity: (contactId: number, input: Partial<Opportunity>) =>
    request<{ data: { id: number }; message: string }>(`/contacts/${contactId}/opportunities`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteOpportunity: (id: number) =>
    request<{ message: string }>(`/opportunities/${id}`, { method: 'DELETE' }),

  listTasks: (contactId: number) =>
    request<{ data: TaskItem[]; count: number }>(`/contacts/${contactId}/tasks`),

  createTask: (contactId: number, input: Partial<TaskItem>) =>
    request<{ data: { id: number }; message: string }>(`/contacts/${contactId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteTask: (id: number) =>
    request<{ message: string }>(`/tasks/${id}`, { method: 'DELETE' }),

  listNotes: (contactId: number) =>
    request<{ data: Note[]; count: number }>(`/contacts/${contactId}/notes`),

  createNote: (contactId: number, input: Partial<Note>) =>
    request<{ data: { id: number }; message: string }>(`/contacts/${contactId}/notes`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteNote: (id: number) =>
    request<{ message: string }>(`/notes/${id}`, { method: 'DELETE' }),

  listAppointments: (contactId: number) =>
    request<{ data: Appointment[]; count: number }>(`/contacts/${contactId}/appointments`),

  listAllAppointments: () =>
    request<{ data: Appointment[]; count: number }>('/appointments'),

  createAppointment: (contactId: number, input: Partial<Appointment>) =>
    request<{ data: { id: number }; message: string }>(`/contacts/${contactId}/appointments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteAppointment: (id: number) =>
    request<{ message: string }>(`/appointments/${id}`, { method: 'DELETE' }),

  listStaff: () => request<{ data: ApiStaffUser[]; count: number }>('/staff'),

  getStaff: (id: number) => request<{ data: ApiStaffUser }>(`/staff/${id}`),

  createStaff: (input: StaffInput) =>
    request<{ data: { id: number }; message: string }>('/staff', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateStaff: (id: number, input: StaffInput) =>
    request<{ data: { id: number }; message: string }>(`/staff/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteStaff: (id: number) =>
    request<{ message: string }>(`/staff/${id}`, { method: 'DELETE' }),

  updateContact: (id: number, input: UpdateContactInput) =>
    request<{ data: { id: number }; message: string }>(`/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  listFollowers: (contactId: number) =>
    request<{ data: ApiFollower[]; count: number }>(`/contacts/${contactId}/followers`),

  addFollower: (contactId: number, staffId: number) =>
    request<{ message: string }>(`/contacts/${contactId}/followers`, {
      method: 'POST',
      body: JSON.stringify({ staff_id: staffId }),
    }),

  removeFollower: (contactId: number, staffId: number) =>
    request<{ message: string }>(`/contacts/${contactId}/followers/${staffId}`, {
      method: 'DELETE',
    }),

  listActivities: (contactId: number) =>
    request<{ data: ApiActivity[]; count: number }>(`/contacts/${contactId}/activities`),

  createActivity: (contactId: number, input: { type: string; title: string; detail?: string }) =>
    request<{ data: { id: number }; message: string }>(`/contacts/${contactId}/activities`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /* ------------------- AUTH ------------------- */

  login: (input: LoginInput) =>
    request<{ data: ApiStaffUser; message: string }>('/auth', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /**
   * Find-or-create the Dealer staff account for a dealership registration
   * submission. Returns the account together with its working password so
   * the public form page can log the new dealer in automatically.
   */
  registerDealer: (input: DealerRegistrationInput) =>
    request<DealerRegistrationResult>('/auth/register-dealer', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /**
   * One-click login from the approval email. Exchanges a signed token for a
   * normal session payload; the server rejects expired/invalid tokens and
   * accounts that are still pending admin approval.
   */
  magicLogin: (token: string) =>
    request<{ data: ApiStaffUser; message: string }>('/auth/magic-login', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  /* ------------------- PORTAL SUBMISSIONS ------------------- */

  listPortalSubmissions: (params: PortalSubmissionFilter = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && v !== null) q.set(k, String(v));
    });
    const qs = q.toString();
    return request<{ data: ApiPortalSubmission[]; count: number }>(
      `/submissions${qs ? `?${qs}` : ''}`
    );
  },

  createPortalSubmission: (input: PortalSubmissionInput) =>
    request<{ data: ApiPortalSubmission; message: string }>('/submissions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  assignPortalSubmission: (id: number, assignedTo: number) =>
    request<{ data: ApiPortalSubmission; message: string }>(`/submissions/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assigned_to: assignedTo }),
    }),

  deletePortalSubmission: (id: number) =>
    request<{ message: string }>(`/submissions/${id}`, { method: 'DELETE' }),

  /** Current plain password of an account (for "view password" in settings). */
  revealPassword: (email: string) =>
    request<{ data: { password: string | null } }>('/auth/reveal-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  /**
   * Admin action (Settings -> My Staff): approve a pending account so its
   * owner can log in. The API also notifies the user on the portal + email.
   */
  approveStaff: (id: number) =>
    request<{ data: ApiStaffUser; message: string }>(`/staff/${id}/approve`, {
      method: 'POST',
    }),

  /* ------------------- NOTIFICATIONS ------------------- */

  listNotifications: (staffId: number, unreadOnly = false) =>
    request<{ data: ApiNotification[]; count: number }>(
      `/notifications?staff_id=${staffId}${unreadOnly ? '&unread=1' : ''}`
    ),

  unreadCount: (staffId: number) =>
    request<{ data: { unread: number } }>(`/notifications/unread-count?staff_id=${staffId}`),

  markNotificationRead: (id: number) =>
    request<{ message: string }>(`/notifications/${id}/read`, {
      method: 'POST',
      body: '{}',
    }),

  markAllNotificationsRead: (staffId: number) =>
    request<{ message: string }>('/notifications/read-all', {
      method: 'POST',
      body: JSON.stringify({ staff_id: staffId }),
    }),

  createNotification: (input: {
    staff_ids: number[];
    contact_id?: number | null;
    type?: string;
    title: string;
    detail?: string;
  }) =>
    request<{ data: { ids: number[]; count: number }; message: string }>('/notifications', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /* ------------------- DEALER / FRANCHISE DASHBOARD ------------------- */

  dealerDashboardSummary: () =>
    request<{ data: DealerDashboardSummary }>('/dealer-dashboard/summary'),

  dealerLeads: (dealerId: number, status?: DealerLeadStatus) =>
    request<{ data: DealerLead[]; count: number }>(
      `/dealer-dashboard/leads?dealer_id=${dealerId}${status ? `&status=${status}` : ''}`
    ),

  myLeads: (staffId: number, status?: DealerLeadStatus) =>
    request<{ data: DealerLead[]; count: number }>(
      `/dealer-dashboard/my-leads?staff_id=${staffId}${status ? `&status=${status}` : ''}`
    ),

  dealerUnassignedLeads: () => request<{ data: ApiContact[]; count: number }>('/dealer-dashboard/unassigned'),

  assignLeadsToDealer: (input: { dealer_id: number; contact_ids?: number[]; filter?: DealerLeadFilter }) =>
    request<{ data: { assigned: number }; message: string }>('/dealer-dashboard/assign', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateDealerLeadStatus: (
    contactId: number,
    input: {
      dealer_id: number;
      status: DealerLeadStatus;
      response_channel?: string;
      response_note?: string | null;
    }
  ) =>
    request<{ message: string }>(`/dealer-dashboard/leads/${contactId}/status`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  bulkUpdateDealerLeadStatus: (input: {
    dealer_id: number;
    contact_ids: number[];
    status: DealerLeadStatus;
    response_channel?: string;
    response_note?: string | null;
  }) =>
    request<{ data: { updated: number }; message: string }>('/dealer-dashboard/bulk-status', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /* ------------------- SMART LISTS ------------------- */

  uploadFormImage: (image: string) =>
    request<{ data: { id: number } }>('/form-images', {
      method: 'POST',
      body: JSON.stringify({ image }),
    }),

  listSmartLists: (userId: number) =>
    request<{ data: ApiSmartList[]; count: number }>(`/smart-lists?user_id=${userId}`),

  createSmartList: (input: SmartListInput) =>
    request<{ data: ApiSmartList; message: string }>('/smart-lists', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateSmartList: (id: number, input: SmartListInput) =>
    request<{ data: ApiSmartList; message: string }>(`/smart-lists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteSmartList: (id: number, userId: number) =>
    request<{ message: string }>(`/smart-lists/${id}?user_id=${userId}`, {
      method: 'DELETE',
    }),

  duplicateSmartList: (id: number, userId: number) =>
    request<{ data: ApiSmartList; message: string }>(`/smart-lists/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),

  /* ------------------- FORM BUILDER (persisted) ------------------- */

  listForms: () => request<{ data: ApiSmartForm[]; count: number }>('/forms'),

  /** Public single-form fetch — powers short share links (#/f/{id}), no login needed. */
  getPublicForm: (id: number) => request<{ data: ApiSmartForm }>(`/forms/${id}`),

  createForm: (input: SmartFormInput) =>
    request<{ data: ApiSmartForm; message: string }>('/forms', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateForm: (id: number, input: SmartFormInput) =>
    request<{ data: ApiSmartForm; message: string }>(`/forms/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteForm: (id: number) =>
    request<{ message: string }>(`/forms/${id}`, { method: 'DELETE' }),

  /* ------------------- SALES TAX INVOICES ------------------- */

  listInvoices: (params: { search?: string; created_by?: number } = {}) =>
    request<{ data: ApiInvoice[]; count: number }>(`/invoices${toQuery(params)}`),

  nextInvoiceNumber: () => request<{ data: { invoice_no: string } }>('/invoices/next-number'),

  createInvoice: (input: InvoiceInput) =>
    request<{ data: ApiInvoice; message: string }>('/invoices', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateInvoice: (id: number, input: InvoiceInput) =>
    request<{ data: ApiInvoice; message: string }>(`/invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteInvoice: (id: number) =>
    request<{ message: string }>(`/invoices/${id}`, { method: 'DELETE' }),
};
