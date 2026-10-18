/** Granular action a feature can be allowed to perform. */
export type PermAction =
  | 'view'
  | 'add'
  | 'edit'
  | 'delete'
  | 'export'
  | 'import'
  | 'assign'
  | 'unassign'
  | 'send';

/** Human-readable label for each granular action. */
export const ACTION_LABELS: Record<PermAction, string> = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
  export: 'Export',
  import: 'Import',
  assign: 'Assign',
  unassign: 'Unassign',
  send: 'Send',
};

export interface PermissionFeature {
  label: string;
  /** Every action this feature carries its own permission key for. */
  actions: PermAction[];
}

export interface PermissionCategory {
  id: string;
  label: string;
  icon: string;
  features: PermissionFeature[];
}

/** Permission key for a single granular action (e.g. `contacts:Contacts:delete`). */
export const permActionKey = (catId: string, label: string, action: PermAction): string =>
  `${catId}:${label}:${action}`;

/** Permission key for the "view" half of a feature (kept for legacy data). */
export const permViewKey = (catId: string, f: PermissionFeature): string | null =>
  f.actions.includes('view') ? `${catId}:${f.label}:view` : null;

/** Permission key for the "edit" half of a feature (kept for legacy data). */
export const permEditKey = (catId: string, f: PermissionFeature): string | null =>
  f.actions.includes('edit') ? `${catId}:${f.label}:edit` : null;

/** All permission keys a category contributes (every action of every feature). */
export const permKeys = (cat: PermissionCategory): string[] =>
  cat.features.flatMap((f) => f.actions.map((a) => permActionKey(cat.id, f.label, a)));

const f = (label: string, actions: PermAction[]): PermissionFeature => ({ label, actions });

/**
 * Convert the legacy "one item per permission" list into features that carry
 * granular actions. Rules:
 *   "View & manage X"   -> feature X with View + Edit
 *   "View X"            -> feature X with View only
 *   anything else       -> feature "X" with Edit only (an action permission)
 */
const fromItems = (items: string[]): PermissionFeature[] =>
  items.map((item) => {
    const m =
      item.match(/^View & ?manage (.+)$/i) ||
      item.match(/^View and manage (.+)$/i) ||
      item.match(/^View & Manage (.+)$/i);
    if (m) return f(m[1].trim(), ['view', 'edit']);
    const v = item.match(/^View (.+)$/i);
    if (v) return f(v[1].trim(), ['view']);
    return f(item, ['edit']);
  });

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: 'ai_agents',
    label: 'AI Agents',
    icon: 'robot',
    features: fromItems([
      'View & manage voice AI agents',
      'View voice AI agent goals',
      'View & manage voice AI agent goals',
      'View voice AI dashboard',
      'View & manage Conversation AI agents',
      'View Conversation AI agent goals',
      'View & manage Conversation AI agent goals',
      'View & manage Conversation AI agent training',
      'View Conversation AI Dashboard',
    ]),
  },
  {
    id: 'audit_logs',
    label: 'Audit Logs',
    icon: 'file-shield',
    features: fromItems(['View audit logs', 'Export audit logs']),
  },
  {
    id: 'account_settings',
    label: 'Account Settings',
    icon: 'sliders',
    features: fromItems(['View & manage tags', 'View & manage settings']),
  },
  {
    id: 'account_tools',
    label: 'Account Tools',
    icon: 'screwdriver-wrench',
    features: fromItems(['View & manage content AI', 'View & manage eliza']),
  },
  {
    id: 'ai_studio',
    label: 'AI Studio',
    icon: 'microchip',
    features: fromItems(['View AI Studio', 'View & manage AI Studio']),
  },
  {
    id: 'automation',
    label: 'Automation',
    icon: 'diagram-project',
    features: fromItems([
      'View campaigns',
      'View & manage campaigns',
      'View workflows',
      'View & manage workflows',
      'View & manage triggers',
    ]),
  },
  {
    id: 'blogs',
    label: 'Blogs',
    icon: 'blog',
    features: fromItems(['View & manage blogs']),
  },
  {
    id: 'calendars',
    label: 'Calendars',
    icon: 'calendar-days',
    features: fromItems([
      'View Calendars',
      'Manage Calendars setup',
      'Manage appointments',
      'Manage groups/categories',
      'Manage associated resources',
      'Manage preferences & global settings',
    ]),
  },
  {
    id: 'certificates',
    label: 'Certificates',
    icon: 'certificate',
    features: fromItems(['View & manage certificates']),
  },
  {
    id: 'communities',
    label: 'Communities',
    icon: 'users',
    features: fromItems(['View & manage communities']),
  },
  {
    id: 'contacts',
    label: 'Contacts',
    icon: 'address-book',
    features: [
      { label: 'Contacts', actions: ['view', 'add', 'edit', 'delete', 'export', 'import'] },
      { label: 'Conversations', actions: ['view', 'send'] },
      { label: 'Assign/Unassign', actions: ['assign', 'unassign'] },
      { label: 'Emails', actions: ['view', 'send'] },
      { label: 'Calls', actions: ['view', 'add'] },
      { label: 'Bulk Actions', actions: ['view', 'add', 'delete', 'export'] },
    ],
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: 'comments',
    features: fromItems(['View & manage conversation']),
  },
  {
    id: 'ask_ai',
    label: 'ASK AI',
    icon: 'sparkles',
    features: fromItems(['Access Ask AI (Global Panel)']),
  },
  {
    id: 'forms',
    label: 'Forms',
    icon: 'rectangle-list',
    features: fromItems(['View & manage forms']),
  },
  {
    id: 'funnels',
    label: 'Funnels',
    icon: 'filter',
    features: fromItems(['View & manage funnels', 'View & manage websites']),
  },
  {
    id: 'gokolab',
    label: 'Gokolab',
    icon: 'flask',
    features: fromItems(['View & manage Gokolab']),
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: 'plug',
    features: fromItems(['View & manage private integration', 'View & manage native integration']),
  },
  {
    id: 'launchpad',
    label: 'Launchpad',
    icon: 'rocket',
    features: fromItems(['View & Manage Sub-account Launchpad']),
  },
  {
    id: 'sub_accounts',
    label: 'Sub-Accounts',
    icon: 'sitemap',
    features: fromItems(['View and Manage Billing Details', 'Manage Sub-Account Details']),
  },
  {
    id: 'marketing',
    label: 'Marketing',
    icon: 'paper-plane',
    features: fromItems([
      'View & manage marketing',
      'View & manage social planner',
      'View & manage affiliate manager',
      'Pay Affiliate Manager Payout',
      'View & manage ad manager',
      'View & manage prospecting',
    ]),
  },
  {
    id: 'medias',
    label: 'Medias',
    icon: 'photo-film',
    features: fromItems(['View & manage media storage']),
  },
  {
    id: 'memberships',
    label: 'Memberships',
    icon: 'id-card',
    features: fromItems(['View & manage membership']),
  },
  {
    id: 'opportunities',
    label: 'Opportunities',
    icon: 'chart-line',
    features: fromItems([
      'View & manage opportunities',
      'View opportunities lead value',
      'View and manage bulk actions',
      'Create pipeline',
    ]),
  },
  {
    id: 'orders',
    label: 'Orders',
    icon: 'cart-shopping',
    features: fromItems([
      'View Orders List & Details',
      'Export Orders',
      'Import Orders',
      'Collect Payment / Partial Payment',
    ]),
  },
  {
    id: 'payments',
    label: 'Payments',
    icon: 'credit-card',
    features: fromItems(['View & manage payments', 'Record payments', 'View & manage payment invoices']),
  },
  {
    id: 'payment_settings',
    label: 'Payment Settings',
    icon: 'gear',
    features: fromItems([
      'View & Manage Payment Settings',
      'Configure Receipt Settings',
      'Configure Subscription Settings',
    ]),
  },
  {
    id: 'products',
    label: 'Products',
    icon: 'box',
    features: fromItems([
      'View Products List',
      'Create/Edit/Import Products',
      'Delete Products',
      'Duplicate Products',
      'Bulk Actions on Products',
    ]),
  },
  {
    id: 'qr_codes',
    label: 'QR Codes',
    icon: 'qrcode',
    features: fromItems(['View & manage Qr Codes']),
  },
  {
    id: 'quizzes',
    label: 'Quizzes',
    icon: 'lightbulb',
    features: fromItems(['View & manage quizzes']),
  },
  {
    id: 'dealership',
    label: 'Dealership',
    icon: 'store',
    features: [
      { label: 'Dealership Applications', actions: ['view', 'add', 'delete', 'export'] },
      { label: 'Assign/Unassign', actions: ['assign', 'unassign'] },
      { label: 'Public Form Link', actions: ['view', 'send'] },
      { label: 'Confirmation Emails', actions: ['send'] },
    ],
  },
  {
    id: 'inquiries',
    label: 'Customer Inquiries',
    icon: 'headset',
    features: [
      { label: 'Customer Inquiries', actions: ['view', 'add', 'delete', 'export'] },
      { label: 'Assign/Unassign', actions: ['assign', 'unassign'] },
      { label: 'Public Form Link', actions: ['view', 'send'] },
      { label: 'Confirmation Emails', actions: ['send'] },
      { label: 'Assignment Notifications', actions: ['send'] },
    ],
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'table-columns',
    features: fromItems([
      'View phone call stats',
      'View adwords',
      'View facebook ads',
      'View attribution',
      'View & manage Local Marketing Audit',
      'View agent reporting',
      'View & manage reporting',
      'Export data',
      'View dashboard',
    ]),
  },
  {
    id: 'reputations',
    label: 'Reputations',
    icon: 'star',
    features: fromItems(['View & manage review', 'View & manage Listings', 'Manage Review AI Agents']),
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    icon: 'rotate',
    features: fromItems(['View Subscriptions List & Details', 'Create Subscriptions']),
  },
  {
    id: 'surveys',
    label: 'Surveys',
    icon: 'square-poll-vertical',
    features: fromItems(['View & manage surveys', 'View survey responses', 'Export survey results']),
  },
  {
    id: 'taxes',
    label: 'Taxes',
    icon: 'receipt',
    features: fromItems(['View & manage tax settings', 'Configure tax rates', 'Export tax reports']),
  },
  {
    id: 'invoices',
    label: 'Invoices',
    icon: 'file-invoice',
    features: [{ label: 'Invoices', actions: ['view', 'add', 'edit', 'delete', 'export'] }],
  },
  {
    id: 'transactions',
    label: 'Transactions',
    icon: 'money-bill-transfer',
    features: fromItems(['View transaction history', 'Export transactions', 'Process refunds']),
  },
  {
    id: 'user_management',
    label: 'User Management',
    icon: 'user-gear',
    features: fromItems(['Add & edit users', 'Delete users', 'Manage user roles & permissions']),
  },
  {
    id: 'wordpress',
    label: 'WordPress',
    icon: 'wordpress',
    features: fromItems(['View & manage WordPress sites', 'Manage plugins & themes', 'Manage WP users']),
  },
];