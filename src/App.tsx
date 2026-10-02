import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaLock, FaXmark } from 'react-icons/fa6';
import type { Contact, ImportResult } from './types';
import { api, type ApiSmartList, type ListParams } from './api';
import { mapApiContact, matchesFilter, matchesRules, normalizeHeader, pickNormalizedColumn } from './utils';
import type { FilterRule } from './data/smartListOptions';
import { navigate, onHashChange, parseHash, type Route } from './router';
import { useAuth } from './auth';
import LoginPage from './components/LoginPage';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import PageHeader from './components/PageHeader';
import SmartListTabs from './components/SmartListTabs';
import SmartListDrawer, { type SmartList } from './components/SmartListDrawer';
import AddToListModal from './components/AddToListModal';
import ManageFieldsDrawer from './components/ManageFieldsDrawer';
import { TableFilterDrawer } from './components/ToolbarDrawers';
import Toolbar from './components/Toolbar';
import ContactsTable, { type RowActionId } from './components/ContactsTable';
import BulkActionsToolbar, { type BulkActionId } from './components/BulkActionsToolbar';
import SendEmailModal from './components/SendEmailModal';
import AddTagsModal from './components/AddTagsModal';
import BulkReviewRequestModal from './components/BulkReviewRequestModal';
import BulkActionSuccessModal from './components/BulkActionSuccessModal';
import BulkActionsPage from './components/BulkActionsPage';
import AddOpportunityModal, { type OpportunityFormData } from './components/AddOpportunityModal';
import BookAppointmentModal from './components/BookAppointmentModal';
import { DEFAULT_VISIBLE_FIELDS, isStaticFieldLabel } from './data/tableFields';
import LeadDetailPage from './components/LeadDetailPage';
import FormsDashboard from './components/FormsDashboard';
import DashboardPage from './components/dashboard/DashboardPage';
import AutomationDashboard from './components/automation/AutomationDashboard';
import PublicFormPage from './components/PublicFormPage';
import InvoicesPage from './components/InvoicesPage';
import DealershipApplicationsPage from './components/DealershipApplicationsPage';
import CustomerInquiriesPage from './components/CustomerInquiriesPage';
import {
  PublicDealershipFormPage,
  PublicInquiryFormPage,
} from './components/PublicPortalPages';
import MyStaffPage from './components/MyStaffPage';
import ManageSmartListsPage from './components/ManageSmartListsPage';
import Pagination from './components/Pagination';
import AddContactDrawer, { type NewContactData } from './components/AddContactDrawer';
import { logActivity } from './data/activityLog';
import { logBulkAction } from './data/bulkActionsStore';
import { registerImportColumns } from './data/importColumnsStore';
import ImportWizard from './components/ImportWizard';
import Toast from './components/Toast';
import ConfirmDialog from './components/ConfirmDialog';
import { StaffProvider } from './StaffContext';

type ViewMode = string;

type DeleteConfirm =
  | { kind: 'single'; contact: Contact }
  | { kind: 'bulk'; ids: number[]; contactsToDelete: Contact[] }
  | null;

interface UndoToast {
  message: string;
  onUndo: () => void;
}

const SMART_LIST_STORAGE_KEY = 'evee_smart_lists_v2';
const smartListStorageKey = (id?: number | null) =>
  id !== undefined && id !== null ? `${SMART_LIST_STORAGE_KEY}_u${id}` : SMART_LIST_STORAGE_KEY;
const HIDDEN_BUILTINS_STORAGE_KEY = 'evee_hidden_builtins_v1';
const TABLE_FIELDS_STORAGE_KEY = 'evee_table_fields_v1';
const ACTIVE_VIEW_STORAGE_KEY = 'evee_active_view_v1';
const FILTERS_STORAGE_KEY = 'evee_active_filters_v1';

const SORT_ACCESSORS: Record<string, (c: Contact) => string | undefined> = {
  'Contact name': (c) => c.name,
  'First name': (c) => c.name.split(' ')[0] ?? '',
  'Last name': (c) => {
    const parts = c.name.split(' ').filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : '';
  },
  'Email': (c) => c.email,
  'Phone': (c) => c.phone,
  'Business name': (c) => c.businessName,
  'Contact type': (c) => c.contactType,
  'Created (PKT)': (c) => c.sortCreated,
  'Updated (PKT)': (c) => c.updatedPkt,
  'Last activity (PKT)': (c) => c.sortActivity,
};

function splitName(name: string): { first: string; last: string } {
  const trimmed = name.trim();
  const space = trimmed.indexOf(' ');
  if (space === -1) return { first: trimmed, last: '' };
  return { first: trimmed.slice(0, space), last: trimmed.slice(space + 1) };
}

const toSmartList = (l: ApiSmartList): SmartList => ({
  id: String(l.id),
  name: l.name,
  filters: l.filters,
  sortBy: l.sort_by,
  fields: l.fields,
  members: l.members,
  dealerId: l.dealer_id,
  dealerName: l.dealer_name,
});

function App() {
  const { user, logout, hasPermission, hasActionPermission } = useAuth();
  const [route, setRoute] = useState<Route>(() => parseHash());
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
      return saved === 'Leads' ? 'All' : saved || 'All';
    } catch {
      return 'All';
    }
  });
  const [customLists, setCustomLists] = useState<SmartList[]>(() => {
    try {
      const raw = localStorage.getItem(SMART_LIST_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SmartList[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* ignore corrupted storage */
    }
    return [];
  });
  const [hiddenBuiltIns, setHiddenBuiltIns] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_BUILTINS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* ignore corrupted storage */
    }
    return [];
  });
  const [smartListOpen, setSmartListOpen] = useState(false);
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [fieldsDrawerOpen, setFieldsDrawerOpen] = useState(false);
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const [activeRules, setActiveRules] = useState<FilterRule[]>(() => {
    try {
      const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as FilterRule[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* ignore corrupted storage */
    }
    return [];
  });
  const [sortBy, setSortBy] = useState('');
  const [actionContact, setActionContact] = useState<Contact | null>(null);
  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [oppModalOpen, setOppModalOpen] = useState(false);
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [addTagsOpen, setAddTagsOpen] = useState(false);
  const [reviewRequestOpen, setReviewRequestOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [visibleFields, setVisibleFields] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(TABLE_FIELDS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      /* ignore corrupted storage */
    }
    return DEFAULT_VISIBLE_FIELDS;
  });
  const [activeTab, setActiveTab] = useState('Smart Lists');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm>(null);
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const searchTimer = useRef<number | undefined>(undefined);

  // Keep the current page in the URL hash so a refresh stays on the same page.
  useEffect(() => onHashChange(() => setRoute(parseHash())), []);

  const openContactId = route.name === 'contact' ? route.id : null;
  const activeNav = route.name === 'sites'
    ? 'Sites'
    : route.name === 'settings'
    ? 'Settings'
    : route.name === 'dashboard'
    ? 'Dashboard'
    : route.name === 'automation'
    ? 'Automation'
    : route.name === 'invoices'
    ? 'Invoices'
    : route.name === 'dealership-portal'
    ? 'Dealership Page'
    : route.name === 'inquiries-portal'
    ? 'Customer Inquiries'
    : 'Contacts';

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  const showUndoToast = useCallback((message: string, onUndo: () => void) => {
    setUndoToast({ message, onUndo });
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndoToast(null), 10000);
  }, []);

  const handleSelectTab = useCallback(
    (tab: string) => {
      // "Contacts" is a heading, not a tab - nothing to do here.
      if (tab === 'Contacts') return;
      if (tab === 'Smart Lists' || tab === 'Bulk Actions') {
        setActiveTab(tab);
      } else {
        showToast(`"${tab}" page coming soon`);
      }
    },
    [showToast]
  );

  const handleNav = useCallback(
    (label: string) => {
      setSidebarMobileOpen(false);
      if (label === 'Sites') {
        navigate({ name: 'sites' });
        return;
      }
      if (label === 'Settings') {
        navigate({ name: 'settings' });
        return;
      }
      if (label === 'Contacts') {
        navigate({ name: 'contacts' });
        return;
      }
      if (label === 'Dashboard') {
        navigate({ name: 'dashboard' });
        return;
      }
      if (label === 'Automation') {
        navigate({ name: 'automation' });
        return;
      }
      if (label === 'Invoices') {
        navigate({ name: 'invoices' });
        return;
      }
      if (label === 'Dealership Page') {
        navigate({ name: 'dealership-portal' });
        return;
      }
      if (label === 'Customer Inquiries') {
        navigate({ name: 'inquiries-portal' });
        return;
      }
      showToast(`"${label}" page coming soon`);
    },
    [showToast, setSidebarMobileOpen]
  );

  // Persist the active smart-list tab across reloads.
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, viewMode);
    } catch {
      /* ignore storage errors */
    }
  }, [viewMode]);

  const load = useCallback(
    async (mode: ViewMode, search: string) => {
setLoading(true);
      try {
        const params: ListParams = search.trim() ? { search: search.trim() } : {};
        // Dealers & Followers only ever see the leads assigned to / followed by
        // them — never the whole CRM — regardless of the restrict_data flag.
        if (user && user.user_type !== 'Admin') params.restrict_to = user.id;
        const isLeads = mode === 'Leads';
        const res = isLeads ? await api.listLeads(params) : await api.listContacts(params);
        setContacts(res.data.map(mapApiContact));
        setSelectedIds(new Set());
      } catch (err) {
        showToast(`Failed to load: ${(err as Error).message}`);
      } finally {
        setLoading(false);
      }
    },
    [showToast, user]
  );

  // Initial load + smart-list tab switch.
  useEffect(() => {
    load(viewMode, searchQuery);
  }, [viewMode, load]);

  // Debounced server-side search.
  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      load(viewMode, searchQuery);
    }, 350);
    return () => window.clearTimeout(searchTimer.current);
  }, [searchQuery, viewMode, load]);

  const visibleIds = useMemo(() => new Set(contacts.map((c) => c.id)), [contacts]);
  const visibleSelected = new Set([...selectedIds].filter((id) => visibleIds.has(id)));
  const allVisibleSelected =
    visibleSelected.size > 0 && visibleSelected.size === contacts.length;
  const selectedContacts = useMemo(
    () => contacts.filter((c) => selectedIds.has(c.id)),
    [contacts, selectedIds]
  );

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelectedNow = visibleSelected.size > 0 && visibleSelected.size === contacts.length;
      if (allSelectedNow) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const deleteSelected = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const contactsToDelete = contacts.filter((c) => ids.includes(c.id));
    setDeleteConfirm({ kind: 'bulk', ids, contactsToDelete });
  };

  const confirmDeleteSelected = async (ids: number[], contactsToDelete: Contact[]) => {
    setDeleteConfirm(null);
    logBulkAction({ label: `Delete ${ids.length} contact(s)`, operation: 'Delete' });
    try {
      await api.bulkDelete(ids);
      setContacts((prev) => prev.filter((c) => !ids.includes(c.id)));
      setSelectedIds(new Set());
      showUndoToast(`Deleted ${ids.length} contact(s)`, () => {
        void restoreContacts(contactsToDelete);
      });
      logActivity({ type: 'delete', title: 'Contacts deleted', detail: `${ids.length} contact(s)` });
      void refreshServerLists();
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`);
    }
  };

  const restoreContacts = async (restored: Contact[]) => {
    try {
      for (const c of restored) await api.restoreContact(c.id);
      setUndoToast(null);
      setContacts((prev) => {
        const existing = new Set(prev.map((c) => c.id));
        return [...restored.filter((c) => !existing.has(c.id)), ...prev];
      });
      showToast(`Restored ${restored.length} contact(s)`);
      void refreshServerLists();
    } catch (err) {
      showToast(`Restore failed: ${(err as Error).message}`);
    }
  };

  const addTagsToSelected = async (tags: string[]) => {
    const ids = [...selectedIds];
    if (ids.length === 0 || tags.length === 0) return;
    logBulkAction({
      label: `Add ${tags.join(', ')} to ${ids.length} contact(s)`,
      operation: 'Add tag',
    });
    try {
      for (const id of ids) {
        const contact = contacts.find((c) => c.id === id);
        const merged = [...new Set([...(contact?.tags ?? []), ...tags])];
        await api.updateContact(id, { tags: merged });
      }
      setContacts((prev) =>
        prev.map((c) =>
          selectedIds.has(c.id) ? { ...c, tags: [...new Set([...(c.tags ?? []), ...tags])] } : c
        )
      );
      setAddTagsOpen(false);
      showToast(`Tags added to ${ids.length} contact(s)`);
      logActivity({ type: 'contact', title: 'Tags added', detail: `${ids.length} contact(s)` });
    } catch (err) {
      showToast(`Failed to add tags: ${(err as Error).message}`);
    }
  };

  const exportSelected = () => {
    const rows = contacts.filter((c) => selectedIds.has(c.id));
    if (rows.length === 0) return;
    let csv = 'Contact Name,Phone,Email,Business Name,Created Date,Tags\n';
    rows.forEach((c) => {
      const tags = (c.tags ?? []).join(';');
      csv += `"${c.name}","${c.phone ?? ''}","${c.email ?? ''}","${c.businessName ?? ''}","${c.createdPkt ?? ''}","${tags}"\n`;
    });
    const encoded = encodeURI(csv);
    const link = document.createElement('a');
    link.setAttribute('href', `data:text/csv;charset=utf-8,${encoded}`);
    link.setAttribute('download', 'crm_contacts_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${rows.length} contact(s)`);
    logActivity({ type: 'contact', title: 'Contacts exported', detail: `${rows.length} contact(s)` });
    logBulkAction({
      label: `Export ${rows.length} contact(s)`,
      operation: 'Export',
      stats: 'download',
    });
  };

  const handleBulkAction = (action: BulkActionId) => {
    const n = selectedIds.size;
    switch (action) {
      case 'export':
        exportSelected();
        break;
      case 'delete':
        deleteSelected();
        break;
      case 'request-reviews':
        setReviewRequestOpen(true);
        break;
      case 'send-sms':
        showToast(`SMS sent to ${n} contact(s)`);
        logBulkAction({ label: `Send SMS to ${n} contact(s)`, operation: 'SMS' });
        break;
      case 'send-email':
        setSendEmailOpen(true);
        break;
      case 'send-whatsapp':
        showToast(`WhatsApp sent to ${n} contact(s)`);
        logBulkAction({ label: `Send WhatsApp to ${n} contact(s)`, operation: 'whatsapp' });
        break;
      case 'manage-companies':
        showToast(`Companies created for ${n} contact(s)`);
        logBulkAction({ label: `Create companies for ${n} contact(s)`, operation: 'Contacts to company' });
        break;
      case 'manage-opportunities':
        showToast(`Opportunities created for ${n} contact(s)`);
        logBulkAction({ label: `Create opportunities for ${n} contact(s)`, operation: 'Opportunity' });
        break;
      case 'trigger-automation':
        showToast('Trigger automation coming soon');
        logBulkAction({ label: `Trigger automation for ${n} contact(s)`, operation: 'workflow' });
        break;
      case 'add-tags':
        setAddTagsOpen(true);
        break;
      case 'remove-tags':
        showToast('Remove tags coming soon');
        logBulkAction({ label: `Remove tags from ${n} contact(s)`, operation: 'Remove tag' });
        break;
      case 'merge':
        showToast('Merge contacts coming soon');
        logBulkAction({ label: `Merge ${n} contact(s)`, operation: 'Merge contacts' });
        break;
    }
  };

  const submitReviewRequest = (data: { actionName: string; reviewOption: string; mode: string }) => {
    const n = selectedIds.size;
    setReviewRequestOpen(false);
    logActivity({ type: 'contact', title: 'Review requests sent', detail: `${n} contact(s)` });
    logBulkAction({
      label: data.actionName
        ? `Review request "${data.actionName}" for ${n} contact(s)`
        : `Request reviews for ${n} contact(s)`,
      operation: 'Review request',
      status: 'Queued',
    });
    setSuccessMessage(`Send review request to ${n} Contacts is in progress/scheduled`);
    setSuccessOpen(true);
  };

  const dismissSuccess = () => setSuccessOpen(false);

  const checkProgress = () => {
    setSuccessOpen(false);
    handleSelectTab('Bulk Actions');
  };

  const reload = () => load(viewMode, searchQuery);

  // Persist custom smart lists across reloads (scoped per user so one user's
  // lists never leak to another user logging in on the same browser).
  useEffect(() => {
    try {
      localStorage.setItem(smartListStorageKey(user?.id), JSON.stringify(customLists));
    } catch {
      /* ignore storage errors */
    }
  }, [customLists, user?.id]);

  // Refresh the contacts page tabs with the latest server-side lists. Lists
  // with a non-numeric id are genuinely local (offline / pre-sync) and are kept;
  // numeric-id lists not returned by the server were deleted, so they're dropped.
  const refreshServerLists = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.listSmartLists(user.id);
      setCustomLists((prev) => {
        const serverIds = new Set(res.data.map((l) => String(l.id)));
        const localOnly = prev.filter((l) => !/^\d+$/.test(l.id) && !serverIds.has(l.id));
        return [...localOnly, ...res.data.map(toSmartList)];
      });
    } catch {
      /* offline / not configured: keep current lists */
    }
  }, [user]);

  // Load server-side smart lists (own + shared) once signed in, and migrate
  // any lists that were only saved in localStorage (created before the
  // server-side feature) so they also appear on the Manage Smart Lists page.
  useEffect(() => {
    if (!user) return;
    let active = true;

    const readLocal = (): SmartList[] => {
      try {
        const raw = localStorage.getItem(smartListStorageKey(user.id));
        if (!raw) return [];
        const parsed = JSON.parse(raw) as SmartList[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const migrateLocal = async (localOnly: SmartList[]) => {
      for (const l of localOnly) {
        try {
          await api.createSmartList({
            user_id: user.id,
            name: l.name,
            filters: l.filters,
            sort_by: l.sortBy,
            fields: l.fields,
            members: l.members,
            dealer_id: l.dealerId ?? null,
          });
        } catch {
          /* name clash or server error - keep local copy */
        }
      }
    };

    api
      .listSmartLists(user.id)
      .then(async (res) => {
        if (!active) return;
        const serverNames = new Set(res.data.map((l) => l.name.toLowerCase()));
        const localOnly = readLocal().filter((l) => !serverNames.has(l.name.toLowerCase()));
        if (localOnly.length > 0) {
          await migrateLocal(localOnly);
          const again = await api.listSmartLists(user.id);
          if (!active) return;
          setCustomLists(again.data.map(toSmartList));
          return;
        }
        // Merge: only keep locally-persisted lists (non-numeric id) that are
        // NOT already on the server; server lists come strictly from the API
        // so lists another user owns are never shown to this user.
        setCustomLists((prev) => {
          const serverIds = new Set(res.data.map((l) => String(l.id)));
          const localOnly = prev.filter((l) => !/^\d+$/.test(l.id) && !serverIds.has(l.id));
          return [...localOnly, ...res.data.map(toSmartList)];
        });
        try {
          localStorage.removeItem(SMART_LIST_STORAGE_KEY);
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* offline / not configured: keep local lists */
      });
    return () => {
      active = false;
    };
  }, [user]);

  // Persist hidden built-in smart lists across reloads.
  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_BUILTINS_STORAGE_KEY, JSON.stringify(hiddenBuiltIns));
    } catch {
      /* ignore storage errors */
    }
  }, [hiddenBuiltIns]);

const handleAddSmartList = async (list: Omit<SmartList, 'id' | 'members'>) => {
    const name = list.name.trim();
    const RESERVED_NAMES = ['All'];
    const clash =
      RESERVED_NAMES.some((n) => n.toLowerCase() === name.toLowerCase()) ||
      customLists.some((l) => l.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      setSmartListOpen(false);
      showToast(`A smart list named "${name}" already exists`);
      return;
    }

    const movedIds = [...selectedIds];

    // Persist on the server when signed in (own + shared lists), fall back to local.
    if (user) {
      try {
        const res = await api.createSmartList({
          user_id: user.id,
          name,
          filters: list.filters,
          sort_by: list.sortBy,
          fields: list.fields,
          members: movedIds,
          dealer_id: list.dealerId ?? null,
        });
        const created: SmartList = {
          id: String(res.data.id),
          name: res.data.name,
          filters: res.data.filters,
          sortBy: res.data.sort_by,
          fields: res.data.fields,
          members: res.data.members,
          dealerId: res.data.dealer_id,
          dealerName: res.data.dealer_name,
        };
        setCustomLists((prev) => {
          const next = prev.map((l) =>
            l.name === viewMode && movedIds.length > 0
              ? { ...l, members: (l.members ?? []).filter((id) => !movedIds.includes(id)) }
              : l
          );
          return [...next, created];
        });
        setSelectedIds(new Set());
        setViewMode(list.name);
        setSmartListOpen(false);
        await handleAssignOnCreate(list, name, movedIds);
        return;
      } catch (err) {
        showToast(`Failed to save smart list: ${(err as Error).message}`);
        setSmartListOpen(false);
        return;
      }
    }

    setCustomLists((prev) => {
      const next = prev.map((l) =>
        l.name === viewMode && movedIds.length > 0
          ? { ...l, members: (l.members ?? []).filter((id) => !movedIds.includes(id)) }
          : l
      );
      return [...next, { ...list, id: `sl-${Date.now()}`, members: movedIds }];
    });
    setSelectedIds(new Set());
    setViewMode(list.name);
    setSmartListOpen(false);

    // When a dealer is chosen, assign the whole smart list's leads to them.
    await handleAssignOnCreate(list, name, movedIds);
  };

  const handleAssignOnCreate = async (
    list: Omit<SmartList, 'id' | 'members'>,
    name: string,
    movedIds: number[]
  ) => {
    if (list.dealerId && list.dealerId > 0) {
      const ids =
        movedIds.length > 0
          ? movedIds
          : contacts
              .filter((c) =>
                list.filters.every((f) =>
                  matchesFilter(c, { name: f, condition: 'Is not empty', value: '' })
                )
              )
              .map((c) => c.id);
      if (ids.length > 0) {
        try {
          const res = await api.assignLeadsToDealer({ dealer_id: list.dealerId, contact_ids: ids });
          showToast(
            `Smart list "${name}" created and ${res.data.assigned} lead(s) assigned to ${list.dealerName ?? 'dealer'}`
          );
        } catch (err) {
          showToast(`Smart list "${name}" created but assignment failed: ${(err as Error).message}`);
        }
        logActivity({
          type: 'smartlist',
          title: 'Smart list assigned',
          detail: `"${name}" → ${list.dealerName ?? 'Dealer'}`,
        });
        return;
      }
    }

    showToast(
      movedIds.length > 0
        ? `Smart list "${name}" created with ${movedIds.length} contact(s)`
        : `Smart list "${name}" created`
    );
    logActivity({ type: 'smartlist', title: 'Smart list created', detail: `"${name}"` });
  };

  const handleRemoveSmartList = async (id: string) => {
    const target = customLists.find((l) => l.id === id);
    setCustomLists((prev) => prev.filter((l) => l.id !== id));
    if (target && viewMode === target.name) setViewMode('All');

    // Server-backed lists carry a numeric id.
    const numericId = /^\d+$/.test(id) ? Number(id) : 0;
    if (numericId > 0 && user) {
      try {
        await api.deleteSmartList(numericId, user.id);
      } catch (err) {
        showToast(`Failed to delete on server: ${(err as Error).message}`);
      }
    }
    showToast(target ? `Smart list "${target.name}" removed` : 'Smart list removed');
    logActivity({ type: 'smartlist', title: 'Smart list removed', detail: target ? `"${target.name}"` : undefined });
  };

  const handleRemoveBuiltIn = (name: string) => {
    setHiddenBuiltIns((prev) => (prev.includes(name) ? prev : [...prev, name]));
    if (viewMode === name) setViewMode('All');
    showToast(`Smart list "${name}" removed`);
    logActivity({ type: 'smartlist', title: 'Smart list removed', detail: `"${name}"` });
  };

  const handleAddToList = async (list: SmartList) => {
    const ids = [...visibleSelected];
    if (ids.length === 0) return;
    const merged = Array.from(new Set([...(list.members ?? []), ...ids]));
    const updated: SmartList = { ...list, members: merged };

    setCustomLists((prev) => prev.map((l) => (l.id === list.id ? updated : l)));
    setSelectedIds(new Set());
    setAddToListOpen(false);
    setViewMode(list.name);

    const numericId = /^\d+$/.test(list.id) ? Number(list.id) : 0;
    if (numericId > 0 && user) {
      try {
        await api.updateSmartList(numericId, {
          user_id: user.id,
          name: list.name,
          filters: list.filters,
          sort_by: list.sortBy,
          fields: list.fields,
          members: merged,
          dealer_id: list.dealerId ?? null,
        });
      } catch (err) {
        showToast(`Failed to update list on server: ${(err as Error).message}`);
        return;
      }
    }
    showToast(`Added ${ids.length} contact${ids.length === 1 ? '' : 's'} to "${list.name}"`);
    logActivity({ type: 'smartlist', title: 'Leads added to smart list', detail: `${ids.length} lead(s) added to "${list.name}"` });
  };

  // Persist table column configuration.
  useEffect(() => {
    try {
      localStorage.setItem(TABLE_FIELDS_STORAGE_KEY, JSON.stringify(visibleFields));
    } catch {
      /* ignore storage errors */
    }
  }, [visibleFields]);

  const handleApplyFields = (ids: string[]) => {
    setVisibleFields(ids);
    showToast('Table fields updated');
  };

  const handleApplySort = (s: string) => {
    setSortBy(s);
    showToast(s ? `Sorted by ${s}` : 'Sort cleared');
  };

  const handleApplyRules = (rules: FilterRule[]) => {
    setActiveRules(rules);
    showToast(rules.length > 0 ? `${rules.length} filter rule(s) applied` : 'Filters cleared');
  };

  const removeRule = (id: number) => {
    setActiveRules((prev) => prev.filter((r) => r.id !== id));
    showToast('Removed filter rule');
  };

  // Persist active filters across reloads (like the smart-list view state).
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(activeRules));
    } catch {
      /* ignore storage errors */
    }
  }, [activeRules]);

  const activeList = customLists.find((l) => l.name === viewMode);

  const filteredContacts = useMemo(() => {
    let result = contacts.filter((c) => matchesRules(c, activeRules));
    if (activeList) {
      const members = activeList.members ?? [];
      if (members.length > 0) {
        result = result.filter((c) => members.includes(c.id));
      } else if (activeList.filters.length === 0) {
        result = [];
      } else {
        result = result.filter((c) =>
          activeList.filters.every((f) =>
            matchesFilter(c, { name: f, condition: 'Is not empty', value: '' })
          )
        );
      }
    }
    return result;
  }, [contacts, activeRules, activeList]);

  const sortedContacts = useMemo(() => {
    if (!sortBy) return filteredContacts;
    const accessor = SORT_ACCESSORS[sortBy] ?? ((c: Contact) => {
      const v = c.customFields?.[sortBy];
      return typeof v === 'string' ? v : v == null ? '' : String(v);
    });
    return [...filteredContacts].sort((a, b) => {
      const av = (accessor(a) ?? '').toLowerCase();
      const bv = (accessor(b) ?? '').toLowerCase();
      return av.localeCompare(bv);
    });
  }, [filteredContacts, sortBy]);

  // Reset to the first page whenever the list changes (search, tab, filters, sort).
  useEffect(() => {
    setPage(1);
  }, [searchQuery, viewMode, activeRules, sortBy, contacts.length]);

  const totalPages = Math.max(1, Math.ceil(sortedContacts.length / perPage));
  const pagedContacts = useMemo(
    () => sortedContacts.slice((page - 1) * perPage, page * perPage),
    [sortedContacts, page, perPage]
  );
  const pageIds = useMemo(() => new Set(pagedContacts.map((c) => c.id)), [pagedContacts]);
  const pageSelected = useMemo(
    () => new Set([...selectedIds].filter((id) => pageIds.has(id))),
    [selectedIds, pageIds]
  );
  const allPageSelected = pageSelected.size > 0 && pageSelected.size === pagedContacts.length;
  const somePageSelected = pageSelected.size > 0 && pageSelected.size < pagedContacts.length;

  const toggleSelectPage = () => {
    const ids = pagedContacts.map((c) => c.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const currentIndex = useMemo(() => {
    if (openContactId === null) return -1;
    return sortedContacts.findIndex((c) => c.id === openContactId);
  }, [openContactId, sortedContacts]);

  const handleNavigate = (dir: 'prev' | 'next') => {
    if (currentIndex < 0 || sortedContacts.length === 0) return;
    const next = dir === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (next < 0 || next >= sortedContacts.length) return;
    navigate({ name: 'contact', id: sortedContacts[next].id });
  };

  const deleteContactRow = (contact: Contact) => {
    setDeleteConfirm({ kind: 'single', contact });
  };

  const confirmDeleteContact = async (contact: Contact) => {
    setDeleteConfirm(null);
    try {
      await api.deleteContact(contact.id);
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(contact.id);
        return next;
      });
      showUndoToast(`Contact "${contact.name}" deleted`, () => {
        void restoreContacts([contact]);
      });
      logActivity({ type: 'delete', title: 'Contact deleted', detail: contact.name });
      void refreshServerLists();
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`);
    }
  };

  const handleRowAction = (action: RowActionId, contact: Contact) => {
    if (action === 'book') {
      setActionContact(contact);
      setBookModalOpen(true);
    } else if (action === 'opportunity') {
      setActionContact(contact);
      setOppModalOpen(true);
    } else if (action === 'review') {
      showToast(`Review request sent to ${contact.name}`);
      logActivity({ type: 'review', title: 'Review request sent', detail: contact.name });
    } else if (action === 'delete') {
      void deleteContactRow(contact);
    }
  };

  const saveBookAppointment = async (data: Record<string, string>) => {
    if (!actionContact) return;
    await api.createAppointment(actionContact.id, {
      title: data.title,
      calendar: data.calendar,
      host: data.user,
      date: data.date,
      start_time: data.start_time,
      end_time: data.end_time,
      location: data.location,
      status: data.status,
      notes: data.notes,
      category: 'past',
    });
    setBookModalOpen(false);
    showToast(`Appointment booked for ${actionContact.name}`);
    logActivity({ type: 'appointment', title: 'Appointment booked', detail: `${data.title} for ${actionContact.name}` });
  };

  const saveOpportunityFromTable = async (data: OpportunityFormData) => {
    if (!actionContact) return;
    await api.createOpportunity(actionContact.id, {
      name: data.name,
      pipeline: data.pipeline,
      stage: data.stage,
      status: data.status,
      value: data.value,
      business_name: data.business_name,
      source: data.source,
      expected_close_date: data.expected_close_date,
      tags: data.tags,
    });
    setOppModalOpen(false);
    showToast(`Opportunity created for ${actionContact.name}`);
    logActivity({ type: 'opportunity', title: 'Opportunity created', detail: `${data.name} for ${actionContact.name}` });
  };

  const handleAddContact = async (data: NewContactData) => {
    const { first, last } = splitName(data.name);
    try {
      await api.createContact({
        first_name: first,
        last_name: last,
        phone: data.phone,
        email: data.email,
        contact_type: data.tag,
        avatar_color: data.avatarColor,
        avatar_data: data.image ?? null,
        tags: [data.tag.toLowerCase()],
      });
      await reload();
      showToast(`Contact "${data.name}" added successfully`);
      logActivity({ type: 'contact', title: 'Contact added', detail: data.name });
    } catch (err) {
      showToast(`Add failed: ${(err as Error).message}`);
    }
  };

  const handleImport = async (result: ImportResult) => {
    const created: { id: number; city: string | null }[] = [];
    let importedCount = 0;
    let failedCount = 0;

    for (const sheet of result.sheets) {
      const headers = sheet.headers;
      const firstCol = pickNormalizedColumn(headers, [/^first\s*(name)?$/i, /given\s*name/i]);
      const lastCol = pickNormalizedColumn(headers, [/^last\s*(name)?$/i, /surname/i, /family\s*name/i]);
      const fullCol = pickNormalizedColumn(headers, [
        /^name$/i,
        /^full\s*name$/i,
        /^fullname$/i,
        /^lead\s*name$/i,
        /^customer\s*name$/i,
        /^contact\s*name$/i,
        /^client\s*name$/i,
        /^dealer\s*name$/i,
        /^applicant\s*name$/i,
        /^buyer\s*name$/i,
        /^owner\s*name$/i,
        /^name\s*of\s*(the\s*)?(lead|customer|contact|person|buyer|dealer|applicant)$/i,
        /^name\s*\(\s*full\s*\)$/i,
      ]);
      const phoneCol = pickNormalizedColumn(headers, [/phone|mobile|cell|whatsapp/i]);
      const emailCol = pickNormalizedColumn(headers, [/e-?mail/i]);
      const businessCol = pickNormalizedColumn(headers, [/business|company|organization|firm/i]);
      const cityCol = result.cityColumn;

      for (const row of sheet.rows) {
        try {
          const cell = (col?: string) => (col ? String(row[col] ?? '').trim() : '');
          // Prefer a single full-name column, then first+last, then any name-ish column.
          const nameFallback =
            headers
              .filter((h) => /name/i.test(h) && !/business|company|organization|firm/i.test(h))
              .map((h) => cell(h))
              .find(Boolean) || '';
          const name = cell(fullCol) || [cell(firstCol), cell(lastCol)].filter(Boolean).join(' ').trim() || nameFallback || 'Imported Lead';
          const { first, last } = splitName(name);
          const city = cityCol ? (row[cityCol] ?? '').trim() || null : null;
          const cleanRow = (r: Record<string, string>) => {
            const out: Record<string, string> = {};
            Object.keys(r).forEach((k) => {
              const v = r[k];
              if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = String(v).trim();
            });
            return out;
          };

          const res = await api.createContact({
            first_name: first || undefined,
            last_name: last || undefined,
            phone: phoneCol ? row[phoneCol] || undefined : undefined,
            email: emailCol ? row[emailCol] || undefined : undefined,
            business_name: businessCol ? row[businessCol] || undefined : undefined,
            contact_type: 'Lead',
            avatar_color: 'bg-slate-200 text-slate-700',
            tags: ['lead', 'imported'],
            custom_fields: {
              import_data: cleanRow(row),
              import_sheet: sheet.name,
              ...(city ? { import_city: city } : {}),
            },
          });
          created.push({ id: res.data.id, city });
          importedCount++;
        } catch {
          failedCount++;
        }
      }
    }

    // Register the uploaded columns so they appear as table columns.
    const allHeaders = Array.from(new Set(result.sheets.flatMap((s) => s.headers)));
    registerImportColumns(allHeaders);

    // Auto-add the non-core imported columns so they show up in the table
    // right away (core fields like name/email/phone and any other built-in
    // column like City already have a column that reads this data).
    const importFieldIds = allHeaders
      .filter(
        (h) =>
          !/^(name|full name|first name|last name|email|phone|mobile|cell|business|company|organization|lead name|customer name|contact name|client name|dealer name)$/i.test(normalizeHeader(h)) &&
          !isStaticFieldLabel(h)
      )
      .map((h) => `import:${h}`);
    if (importFieldIds.length > 0) {
      setVisibleFields((prev) => {
        const merged = [...prev];
        for (const id of importFieldIds) {
          if (!merged.some((x) => x.toLowerCase() === id.toLowerCase())) merged.push(id);
        }
        return merged;
      });
    }

    // Group the newly created leads by city and make one smart list per city.
    const byCity = new Map<string, number[]>();
    for (const c of created) {
      if (!c.city) continue;
      const key = c.city.toLowerCase();
      if (!byCity.has(key)) byCity.set(key, []);
      byCity.get(key)!.push(c.id);
    }

    if (user) {
      for (const [key, ids] of byCity.entries()) {
        const cityName = created.find((c) => c.city && c.city.toLowerCase() === key)?.city ?? key;
        const listName = cityName;
        try {
          await api.createSmartList({
            user_id: user.id,
            name: listName,
            members: ids,
            shared_all: false,
          });
        } catch {
          // Name clash - merge into the existing list of the same name.
          try {
            const existing = await api.listSmartLists(user.id);
            const hit = existing.data.find((l) => l.name.toLowerCase() === listName.toLowerCase());
            if (hit) {
              const merged = Array.from(new Set([...(hit.members ?? []), ...ids]));
              await api.updateSmartList(hit.id, {
                user_id: user.id,
                name: hit.name,
                filters: hit.filters,
                sort_by: hit.sort_by,
                fields: hit.fields,
                members: merged,
                dealer_id: hit.dealer_id,
                shared_all: hit.shared_all,
                shared_user_ids: hit.shared_user_ids,
              });
            }
          } catch {
            /* offline / not configured */
          }
        }
      }
    }

    await reload();
    await refreshServerLists();
    showToast(
      `Imported ${importedCount} lead${importedCount === 1 ? '' : 's'}` +
        (failedCount > 0 ? `, ${failedCount} failed` : '') +
        (byCity.size > 0
          ? ` • ${byCity.size} city smart list${byCity.size === 1 ? '' : 's'} created`
          : '')
    );
    if (importedCount > 0) {
      logActivity({
        type: 'contact',
        title: 'Contacts imported',
        detail: `${importedCount} contact(s) from ${result.fileName}`,
      });
    }
  };

  const exportCsv = () => {
    let csv = 'Contact Name,Phone,Email,Business Name,Created Date,Tags\n';
    contacts.forEach((c) => {
      const tags = (c.tags ?? []).join(';');
      csv += `"${c.name}","${c.phone ?? ''}","${c.email ?? ''}","${c.businessName ?? ''}","${c.createdPkt ?? ''}","${tags}"\n`;
    });
    const encoded = encodeURI(csv);
    const link = document.createElement('a');
    link.setAttribute('href', `data:text/csv;charset=utf-8,${encoded}`);
    link.setAttribute('download', 'crm_contacts_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Contacts exported successfully!');
    logActivity({ type: 'contact', title: 'Contacts exported', detail: `${contacts.length} contact(s)` });
  };

  // Public form pages stay reachable without a login (shared links).
  if (route.name === 'form') {
    return <PublicFormPage data={route.data} />;
  }
  if (route.name === 'form-id') {
    return <PublicFormPage formId={route.id} />;
  }

  // Shareable portal forms — no login required.
  if (route.name === 'dealership-form') {
    return <PublicDealershipFormPage />;
  }
  if (route.name === 'inquiry-form') {
    return <PublicInquiryFormPage />;
  }

  // One-click login from the approval email — must work while signed out.
  if (route.name === 'magic-login') {
    return <MagicLoginHandler token={route.token} />;
  }

  // Signed out -> branded login screen.
  if (!user) {
    return <LoginPage onSuccess={() => navigate({ name: 'dashboard' })} />;
  }

  // Route-level permission guard: a user can only open pages their role allows.
  // The Dashboard is available to every logged-in user (owner & dealers see
  // their own tailored view), so no extra permission is required for it.
  const routePerm =
    route.name === 'sites'
      ? 'forms'
      : route.name === 'settings'
      ? 'user_management'
      : route.name === 'smart-lists'
      ? 'contacts'
      : route.name === 'dashboard'
      ? 'dashboard'
      : route.name === 'automation'
      ? 'automation'
      : route.name === 'invoices'
      ? 'invoices'
      : route.name === 'dealership-portal'
      ? 'dashboard'
      : route.name === 'inquiries-portal'
      ? 'dashboard'
      : 'contacts';
  if (route.name !== 'dashboard' && !hasPermission(routePerm)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-sm w-full text-center evee-pop">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xl mx-auto mb-4">
            <FaLock />
          </div>
          <h2 className="text-base font-bold text-slate-800">Access restricted</h2>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            Your role ({user.user_type}) doesn't include permission for this page.
            Contact an administrator to enable the required permission.
          </p>
          <div className="flex items-center justify-center gap-2 mt-5">
            {hasPermission('contacts') ? (
              <button
                onClick={() => navigate({ name: 'contacts' })}
                className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition"
              >
                Go to Contacts
              </button>
            ) : (
              <button
                onClick={logout}
                className="px-4 py-2 bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-300 transition"
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <StaffProvider>
      {route.name === 'settings' ? (
        <MyStaffPage onNotify={showToast} onBack={() => navigate({ name: 'contacts' })} />
      ) : route.name === 'smart-lists' ? (
        <ManageSmartListsPage
          onNotify={showToast}
          onBack={() => navigate({ name: 'contacts' })}
          onListsChanged={refreshServerLists}
        />
      ) : route.name === 'sites' ? (
        <div className="flex h-screen w-full overflow-hidden select-none bg-slate-100">
          <Sidebar
            collapsed={sidebarCollapsed}
            mobileOpen={sidebarMobileOpen}
            activeNav={activeNav}
            onNavigate={handleNav}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            onMobileClose={() => setSidebarMobileOpen(false)}
            onLogout={logout}
          />
          <main className="flex-1 min-w-0 h-full overflow-hidden">
            <FormsDashboard />
          </main>
        </div>
      ) : route.name === 'dashboard' ? (
        <div className="flex h-screen w-full overflow-hidden select-none bg-slate-100">
          <Sidebar
            collapsed={sidebarCollapsed}
            mobileOpen={sidebarMobileOpen}
            activeNav={activeNav}
            onNavigate={handleNav}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            onMobileClose={() => setSidebarMobileOpen(false)}
            onLogout={logout}
          />
          <main className="flex-1 min-w-0 h-full overflow-hidden">
            <DashboardPage onNotify={showToast} onOpenContact={(id) => navigate({ name: 'contact', id })} onLogout={logout} onOpenMobileSidebar={() => setSidebarMobileOpen(true)} />
          </main>
        </div>
      ) : route.name === 'automation' ? (
        <div className="flex h-screen w-full overflow-hidden select-none bg-slate-100">
          <Sidebar
            collapsed={sidebarCollapsed}
            mobileOpen={sidebarMobileOpen}
            activeNav={activeNav}
            onNavigate={handleNav}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            onMobileClose={() => setSidebarMobileOpen(false)}
            onLogout={logout}
          />
          <main className="flex-1 min-w-0 h-full overflow-hidden">
            <AutomationDashboard onNotify={showToast} onLogout={logout} />
          </main>
        </div>
      ) : route.name === 'invoices' ? (
        <div className="flex h-screen w-full overflow-hidden select-none bg-slate-100">
          <Sidebar
            collapsed={sidebarCollapsed}
            mobileOpen={sidebarMobileOpen}
            activeNav={activeNav}
            onNavigate={handleNav}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            onMobileClose={() => setSidebarMobileOpen(false)}
            onLogout={logout}
          />
          <main className="flex-1 min-w-0 h-full overflow-hidden">
            <InvoicesPage onNotify={showToast} />
          </main>
        </div>
      ) : route.name === 'dealership-portal' ? (
        <div className="flex h-screen w-full overflow-hidden select-none bg-slate-100">
          <Sidebar
            collapsed={sidebarCollapsed}
            mobileOpen={sidebarMobileOpen}
            activeNav={activeNav}
            onNavigate={handleNav}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            onMobileClose={() => setSidebarMobileOpen(false)}
            onLogout={logout}
          />
          <main className="flex-1 min-w-0 h-full overflow-y-auto">
            <DealershipApplicationsPage onNotify={showToast} />
          </main>
        </div>
      ) : route.name === 'inquiries-portal' ? (
        <div className="flex h-screen w-full overflow-hidden select-none bg-slate-100">
          <Sidebar
            collapsed={sidebarCollapsed}
            mobileOpen={sidebarMobileOpen}
            activeNav={activeNav}
            onNavigate={handleNav}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            onMobileClose={() => setSidebarMobileOpen(false)}
            onLogout={logout}
          />
          <main className="flex-1 min-w-0 h-full overflow-y-auto">
            <CustomerInquiriesPage onNotify={showToast} />
          </main>
        </div>
      ) : (
        <div className="flex h-screen w-full overflow-hidden select-none bg-slate-100">
          <Sidebar
            collapsed={sidebarCollapsed}
            mobileOpen={sidebarMobileOpen}
            activeNav={activeNav}
            onNavigate={handleNav}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            onMobileClose={() => setSidebarMobileOpen(false)}
            onLogout={logout}
          />

          <main className="flex-1 flex flex-col h-full bg-white min-w-0 overflow-hidden">
            <TopBar
              activeTab={activeTab}
              onSelectTab={handleSelectTab}
              onOpenMobileSidebar={() => setSidebarMobileOpen(true)}
              user={user}
              onLogout={logout}
            />

            {openContactId !== null ? (
              <LeadDetailPage
                contactId={openContactId}
                onBack={() => navigate({ name: 'contacts' })}
                onNotify={showToast}
                onAvatarUpdated={(id, data) =>
                  setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, image: data } : c)))
                }
                position={{ current: currentIndex + 1, total: sortedContacts.length }}
                onNavigate={handleNavigate}
              />
            ) : activeTab === 'Bulk Actions' ? (
              <BulkActionsPage />
            ) : (
              <>
                <PageHeader
                  totalCount={contacts.length}
                  onOpenImport={() => setImportOpen(true)}
                  onOpenAddContact={() => setAddContactOpen(true)}
                  onExport={exportCsv}
                  onNotify={showToast}
                  onManageSmartLists={() => navigate({ name: 'smart-lists' })}
                  canAdd={hasActionPermission('contacts', 'Contacts', 'add')}
                  canImport={hasActionPermission('contacts', 'Contacts', 'import')}
                  canExport={hasActionPermission('contacts', 'Contacts', 'export')}
                />

                <SmartListTabs
                  active={viewMode}
                  onSelect={(list) => setViewMode(list)}
                  customLists={customLists}
                  onAdd={() => setSmartListOpen(true)}
                  onRemove={handleRemoveSmartList}
                  onRemoveBuiltIn={handleRemoveBuiltIn}
                  hiddenBuiltIns={hiddenBuiltIns}
                />

                <Toolbar
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  selectedCount={visibleSelected.size}
                  onDeleteSelected={deleteSelected}
                  onManageFields={() => setFieldsDrawerOpen(true)}
                  onOpenFilters={() => setFiltersDrawerOpen(true)}
                  onSortChange={handleApplySort}
                  filterCount={activeRules.length}
                  sortBy={sortBy}
                  onAddToList={() => setAddToListOpen(true)}
                />

                {activeRules.length > 0 && (
                  <div className="px-4 md:px-6 py-2 border-b border-slate-100 bg-white flex flex-wrap items-center gap-1.5">
                    {activeRules.map((rule) => (
                      <span
                        key={rule.id}
                        className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-md pl-2.5 pr-1.5 py-1 text-[11px] font-medium"
                      >
                        <span>{rule.field}</span>
                        <span className="text-blue-400 font-normal">
                          {rule.operator}
                          {rule.value ? ` ${rule.value.replace('|', ' to ')}` : ''}
                        </span>
                        <button
                          onClick={() => removeRule(rule.id)}
                          className="ml-0.5 text-blue-400 hover:text-red-600 transition"
                          aria-label={`Remove ${rule.field} filter`}
                        >
                          <FaXmark className="text-xs" />
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() => handleApplyRules([])}
                      className="text-[11px] text-slate-500 hover:text-red-600 font-semibold ml-1 transition"
                    >
                      Clear all
                    </button>
                  </div>
                )}

                {loading && contacts.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-xs text-slate-500">
                    Loading contacts...
                  </div>
                ) : sortedContacts.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center text-xs text-slate-500 gap-1.5 py-16">
                    <p className="text-sm font-semibold text-slate-700">No contacts yet</p>
                    <p className="text-[11px]">
                      {activeList
                        ? 'Select contacts and create a smart list to move them here, or configure filters.'
                        : 'Add contacts or adjust your filters to see them here.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <BulkActionsToolbar
                      selectedCount={visibleSelected.size}
                      totalCount={contacts.length}
                      allSelected={allVisibleSelected}
                      onSelectAll={toggleSelectAll}
                      onAction={handleBulkAction}
                      canDelete={hasActionPermission('contacts', 'Contacts', 'delete')}
                    />

                    <ContactsTable
                      contacts={pagedContacts}
                      selectedIds={selectedIds}
                      onToggleSelect={toggleSelect}
                      onToggleSelectAll={toggleSelectPage}
                      allVisibleSelected={allPageSelected}
                      someVisibleSelected={somePageSelected}
                      onOpenContact={(id) => navigate({ name: 'contact', id })}
                      visibleFields={visibleFields}
                      onRowAction={handleRowAction}
                      canDelete={hasActionPermission('contacts', 'Contacts', 'delete')}
                    />
                  </>
                )}

                {sortedContacts.length > 0 && (
                  <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    perPage={perPage}
                    totalItems={sortedContacts.length}
                    onPerPageChange={(n) => {
                      setPerPage(n);
                      setPage(1);
                    }}
                    onPageChange={setPage}
                  />
                )}
              </>
            )}
          </main>

          <AddContactDrawer
            open={addContactOpen}
            onClose={() => setAddContactOpen(false)}
            onSave={handleAddContact}
            onNotify={showToast}
          />

          <ImportWizard
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onImport={handleImport}
            onNotify={showToast}
          />

          {smartListOpen && (
            <SmartListDrawer
              open={smartListOpen}
              onClose={() => setSmartListOpen(false)}
              onSave={handleAddSmartList}
            />
          )}

          <AddToListModal
            open={addToListOpen}
            lists={customLists}
            selectedCount={visibleSelected.size}
            onClose={() => setAddToListOpen(false)}
            onSelect={handleAddToList}
            onCreate={() => {
              setAddToListOpen(false);
              setSmartListOpen(true);
            }}
          />

          {fieldsDrawerOpen && (
            <ManageFieldsDrawer
              open={fieldsDrawerOpen}
              initialVisible={visibleFields}
              onClose={() => setFieldsDrawerOpen(false)}
              onApply={handleApplyFields}
              onNotify={showToast}
            />
          )}

          {filtersDrawerOpen && (
            <TableFilterDrawer
              open={filtersDrawerOpen}
              initialRules={activeRules}
              onClose={() => setFiltersDrawerOpen(false)}
              onApply={handleApplyRules}
            />
          )}

          {bookModalOpen && actionContact && (
            <BookAppointmentModal
              contactName={actionContact.name}
              phone={actionContact.phone ?? ''}
              onClose={() => setBookModalOpen(false)}
              onSave={saveBookAppointment}
            />
          )}

          {oppModalOpen && actionContact && (
            <AddOpportunityModal
              contactName={actionContact.name}
              email={actionContact.email ?? ''}
              phone={actionContact.phone ?? ''}
              onClose={() => setOppModalOpen(false)}
              onSave={saveOpportunityFromTable}
            />
          )}

          {sendEmailOpen && (
            <SendEmailModal
              selectedContacts={selectedContacts}
              senderName={user ? `${user.first_name} ${user.last_name}` : ''}
              senderEmail={user?.email ?? ''}
              onClose={() => setSendEmailOpen(false)}
              onNotify={showToast}
            />
          )}

          {addTagsOpen && (
            <AddTagsModal
              selectedContacts={selectedContacts}
              onClose={() => setAddTagsOpen(false)}
              onSave={addTagsToSelected}
            />
          )}

          <BulkReviewRequestModal
            open={reviewRequestOpen}
            selectedCount={selectedIds.size}
            selectedContacts={selectedContacts}
            onClose={() => setReviewRequestOpen(false)}
            onSubmit={submitReviewRequest}
          />

          <BulkActionSuccessModal
            open={successOpen}
            message={successMessage}
            onDismiss={dismissSuccess}
            onCheckProgress={checkProgress}
            onClose={dismissSuccess}
          />

          <ConfirmDialog
            open={deleteConfirm !== null}
            title={
              deleteConfirm?.kind === 'bulk' ? 'Delete selected contacts' : 'Delete contact'
            }
            message={
              deleteConfirm?.kind === 'bulk'
                ? `Are you sure you want to delete ${deleteConfirm.ids.length} contact(s)? You will have 10 seconds to undo after deletion.`
                : `Are you sure you want to delete "${deleteConfirm?.contact.name}"? You will have 10 seconds to undo after deletion.`
            }
            confirmLabel="Yes, Delete"
            onConfirm={() => {
              if (deleteConfirm?.kind === 'single') {
                void confirmDeleteContact(deleteConfirm.contact);
              } else if (deleteConfirm?.kind === 'bulk') {
                void confirmDeleteSelected(deleteConfirm.ids, deleteConfirm.contactsToDelete);
              }
            }}
            onCancel={() => setDeleteConfirm(null)}
          />
        </div>
      )}

      <Toast
        message={undoToast ? undoToast.message : toast}
        actionLabel={undoToast ? 'Undo' : undefined}
        onAction={undoToast?.onUndo}
      />
    </StaffProvider>
  );
}

/**
 * Handles #/magic-login/:token links from approval emails: exchanges the
 * signed token for a session, signs the user straight in and lands them on
 * the dashboard. On any failure shows the error with a path to manual login.
 */
function MagicLoginHandler({ token }: { token: string }) {
  const { completeLogin } = useAuth();
  const [state, setState] = useState<'working' | 'error'>('working');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let active = true;
    api
      .magicLogin(token)
      .then((res) => {
        if (!active) return;
        if (!res.token) throw new Error('Login did not return a session token.');
        completeLogin(res.data, res.token);
        navigate({ name: 'dashboard' });
      })
      .catch((err) => {
        if (!active) return;
        setErrorMsg((err as Error).message);
        setState('error');
      });
    return () => {
      active = false;
    };
  }, [token, completeLogin]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-sm w-full text-center evee-pop">
        {state === 'working' ? (
          <>
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xl mx-auto mb-4">
              <FaLock />
            </div>
            <h2 className="text-base font-bold text-slate-800">Signing you in…</h2>
            <p className="text-xs text-slate-500 mt-1.5">Verifying your secure login link.</p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xl mx-auto mb-4">
              <FaLock />
            </div>
            <h2 className="text-base font-bold text-slate-800">Link not valid</h2>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{errorMsg}</p>
            <button
              onClick={() => navigate({ name: 'dashboard' })}
              className="mt-5 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition"
            >
              Go to login page
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default App;