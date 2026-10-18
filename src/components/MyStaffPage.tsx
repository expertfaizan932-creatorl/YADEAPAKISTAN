import { useMemo, useRef, useState } from 'react';
import type { IconType } from 'react-icons';
import {
  FaArrowLeft,
  FaArrowsUpDown,
  FaBullhorn,
  FaCamera,
  FaCheck,
  FaChevronDown,
  FaChevronRight,
  FaCircleQuestion,
  FaCopy,
  FaGoogle,
  FaMagnifyingGlass,
  FaMicrosoft,
  FaPhone,
  FaPlus,
  FaRegCalendarCheck,
  FaRegClock,
  FaRegPenToSquare,
  FaRegTrashCan,
  FaRegUser,
  FaTrashCan,
  FaWandMagicSparkles,
  FaXmark,
  FaFileAudio,
  FaFileInvoice,
  FaPhoneVolume,
  FaShieldHalved,
  FaRobot,
  FaRectangleList,
  FaFilter,
  FaFileShield,
  FaSliders,
  FaScrewdriverWrench,
  FaMicrochip,
  FaDiagramProject,
  FaBlog,
  FaCalendarDays,
  FaCertificate,
  FaUsers,
  FaAddressBook,
  FaComments,
  FaFlask,
  FaPlug,
  FaRocket,
  FaSitemap,
  FaPaperPlane,
  FaPhotoFilm,
  FaIdCard,
  FaChartLine,
  FaCartShopping,
  FaCreditCard,
  FaGear,
  FaBox,
  FaQrcode,
  FaBars,
  FaLightbulb,
  FaTableColumns,
  FaStar,
  FaRotate,
  FaSquarePollVertical,
  FaReceipt,
  FaMoneyBillTransfer,
  FaUserGear,
  FaWordpress,
  FaStore,
  FaHeadset,
} from 'react-icons/fa6';
import { useStaff } from '../StaffContext';
import { useAuth } from '../auth';
import { ACTION_LABELS, PERMISSION_CATEGORIES, permKeys, type PermissionCategory } from '../data/staffPermissions';
import { api, type ApiStaffUser, type StaffAvailability, StaffInput } from '../api';
import { fileToResizedDataUrl, ROLE_BADGE, ROLE_LABEL } from '../utils';
import RichTextEditor from './RichTextEditor';
import UserMenu from './UserMenu';
import NotificationsBell from './NotificationsBell';
import WorkspaceBox from './WorkspaceBox';

type TabId = 'userInfo' | 'roles' | 'callVoicemail' | 'userAvailability' | 'calendarConfig';
type Role = 'Admin' | 'Dealer' | 'Follower';

const TAB_ORDER: TabId[] = ['userInfo', 'roles', 'callVoicemail', 'userAvailability', 'calendarConfig'];

const ICON_MAP: Record<string, IconType> = {
  robot: FaRobot,
  'file-shield': FaFileShield,
  sliders: FaSliders,
  'screwdriver-wrench': FaScrewdriverWrench,
  microchip: FaMicrochip,
  'diagram-project': FaDiagramProject,
  blog: FaBlog,
  'calendar-days': FaCalendarDays,
  certificate: FaCertificate,
  users: FaUsers,
  'address-book': FaAddressBook,
  comments: FaComments,
  sparkles: FaWandMagicSparkles,
  'rectangle-list': FaRectangleList,
  filter: FaFilter,
  flask: FaFlask,
  plug: FaPlug,
  rocket: FaRocket,
  sitemap: FaSitemap,
  'paper-plane': FaPaperPlane,
  'photo-film': FaPhotoFilm,
  'id-card': FaIdCard,
  'chart-line': FaChartLine,
  'cart-shopping': FaCartShopping,
  'credit-card': FaCreditCard,
  gear: FaGear,
  box: FaBox,
  qrcode: FaQrcode,
  lightbulb: FaLightbulb,
  'table-columns': FaTableColumns,
  star: FaStar,
  rotate: FaRotate,
  'square-poll-vertical': FaSquarePollVertical,
  receipt: FaReceipt,
  'file-invoice': FaFileInvoice,
  'money-bill-transfer': FaMoneyBillTransfer,
  'user-gear': FaUserGear,
  wordpress: FaWordpress,
  store: FaStore,
  headset: FaHeadset,
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function buildEmptySchedule(active: boolean, start: string, end: string) {
  const schedule: Record<string, { active: boolean; start: string; end: string }> = {};
  DAYS.forEach((d) => {
    schedule[d] = { active, start, end };
  });
  return schedule;
}

const DEFAULT_AVAILABILITY: StaffAvailability = {
  timezone: 'Asia/Karachi (GMT+05:00)',
  schedule: buildEmptySchedule(true, '09:00', '17:00'),
  bufferTime: '10 mins',
  outOfOffice: false,
};

function emptyPermissions(): Record<string, boolean> {
  const perms: Record<string, boolean> = {};
  PERMISSION_CATEGORIES.forEach((cat) => {
    permKeys(cat).forEach((key) => {
      perms[key] = false;
    });
  });
  return perms;
}

function allPermissionsOn(): Record<string, boolean> {
  const perms: Record<string, boolean> = {};
  PERMISSION_CATEGORIES.forEach((cat) => {
    permKeys(cat).forEach((key) => {
      perms[key] = true;
    });
  });
  return perms;
}

/** Permissions a Dealer gets by default: can manage their own followers. */
function dealerPermissions(): Record<string, boolean> {
  const perms: Record<string, boolean> = {};
  PERMISSION_CATEGORIES.forEach((cat) => {
    permKeys(cat).forEach((key) => {
      const enabled = cat.id === 'user_management';
      perms[key] = enabled;
    });
  });
  return perms;
}

function staffToInput(s: ApiStaffUser): Record<string, unknown> {
  return {
    first_name: s.first_name,
    last_name: s.last_name,
    email: s.email ?? '',
    password: s.password ?? '',
    personalCalendar: s.personal_calendar ?? '',
    phone: s.phone ?? '',
    extension: s.extension ?? '',
    calendar: s.calendar ?? 'Main Sales Calendar',
    user_type: s.user_type,
    manager_id: s.manager_id ?? null,
    restrict_data: s.restrict_data === 1,
    signature: s.signature ?? '',
    system_id: s.system_id ?? '',
    avatar_data: s.avatar_data ?? null,
    call_voicemail: s.call_voicemail,
    availability: s.availability,
    calendar_config: s.calendar_config,
    permissions: s.permissions,
  };
}

interface ContactRow {
  id: number;
  value: string;
}

function splitList(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function rowsFromList(value: string | null | undefined): ContactRow[] {
  const items = splitList(value);
  return items.length > 0 ? items.map((v, i) => ({ id: i + 1, value: v })) : [{ id: 1, value: '' }];
}

interface MyStaffPageProps {
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onBack?: () => void;
}

function MyStaffPage({ onNotify, onBack }: MyStaffPageProps) {
  const { staff, loading, addStaff, updateStaff, removeStaff, reload } = useStaff();
  const { user: currentUser, logout } = useAuth();

  const isDealer = currentUser?.user_type === 'Dealer';
  const isAdmin = currentUser?.user_type === 'Admin';
  // Only an Admin can create Dealers/Admins. A Dealer can only create Followers.
  const allowedRoles: Role[] = isAdmin ? ['Admin', 'Dealer', 'Follower'] : isDealer ? ['Follower'] : [];

  const [roleFilter, setRoleFilter] = useState<'All' | Role>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('userInfo');
  const [selectedPermCat, setSelectedPermCat] = useState('ai_agents');
  const [isRolesExpanded, setIsRolesExpanded] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingsSection, setSettingsSection] = useState('My Staff');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [greetingFile, setGreetingFile] = useState<{ name: string; size: number } | null>(null);
  const [greetingDragOver, setGreetingDragOver] = useState(false);

  const [form, setForm] = useState<Record<string, unknown>>({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    personalCalendar: '',
    phone: '',
    extension: '',
    calendar: '',
    user_type: 'Follower',
    manager_id: null,
    restrict_data: false,
    signature: '',
    system_id: '',
    avatar_data: null,
    call_voicemail: {
      inboundTimeout: 20,
      forwardNumber: '',
      missedTextBack: 'Hi! Sorry I missed your call. I will text you shortly.',
      enableRecording: true,
    },
    availability: JSON.parse(JSON.stringify(DEFAULT_AVAILABILITY)),
    calendar_config: {
      primaryCalendar: 'Main Sales Calendar',
      conflictCalendars: ['Main Sales Calendar'],
      syncMode: '2-way',
      autoConfirm: true,
    },
    permissions: emptyPermissions(),
  });
  const contactRowIdRef = useRef(2);
  const [emailRows, setEmailRows] = useState<ContactRow[]>([{ id: 1, value: '' }]);
  const [phoneRows, setPhoneRows] = useState<ContactRow[]>([{ id: 1, value: '' }]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const greetingInputRef = useRef<HTMLInputElement>(null);

  const setField = (key: string, value: unknown) => setForm((prev) => ({ ...prev, [key]: value }));
  const setNested = (path: string[], value: unknown) =>
    setForm((prev) => {
      const copy = { ...prev };
      let node: Record<string, unknown> = copy;
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        node = node[k] as Record<string, unknown>;
      }
      node[path[path.length - 1]] = value;
      return copy;
    });

  const addEmailRow = () => setEmailRows((prev) => [...prev, { id: contactRowIdRef.current++, value: '' }]);
  const removeEmailRow = (id: number) =>
    setEmailRows((prev) =>
      prev.length > 1 ? prev.filter((r) => r.id !== id) : prev.map((r) => (r.id === id ? { ...r, value: '' } : r))
    );
  const updateEmailRow = (id: number, value: string) =>
    setEmailRows((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));

  const addPhoneRow = () => setPhoneRows((prev) => [...prev, { id: contactRowIdRef.current++, value: '' }]);
  const removePhoneRow = (id: number) =>
    setPhoneRows((prev) =>
      prev.length > 1 ? prev.filter((r) => r.id !== id) : prev.map((r) => (r.id === id ? { ...r, value: '' } : r))
    );
  const updatePhoneRow = (id: number, value: string) =>
    setPhoneRows((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));

  const openAdd = () => {
    setEditingId(null);
    setForm({
      first_name: '',
      last_name: '',
      email: '',
      password: '',
      personalCalendar: '',
      phone: '',
      extension: '',
      calendar: 'Main Sales Calendar',
      user_type: isDealer ? 'Follower' : 'Dealer',
      manager_id: isDealer ? (currentUser?.id ?? null) : null,
      restrict_data: false,
      signature: '',
      system_id: '',
      avatar_data: null,
      call_voicemail: {
        inboundTimeout: 20,
        forwardNumber: '',
        missedTextBack: 'Hi! Sorry I missed your call. I will text you shortly.',
        enableRecording: true,
      },
      availability: JSON.parse(JSON.stringify(DEFAULT_AVAILABILITY)),
      calendar_config: {
        primaryCalendar: 'Main Sales Calendar',
        conflictCalendars: ['Main Sales Calendar'],
        syncMode: '2-way',
        autoConfirm: true,
      },
      permissions: emptyPermissions(),
    });
    setEmailRows(rowsFromList(''));
    setPhoneRows(rowsFromList(''));
    setActiveTab('userInfo');
    setSelectedPermCat('ai_agents');
    setModalOpen(true);
  };

  const openEdit = (user: ApiStaffUser) => {
    setEditingId(user.id);
    setForm(staffToInput(user));
    setEmailRows(rowsFromList(user.email));
    setPhoneRows(rowsFromList(user.phone));
    setActiveTab('userInfo');
    setSelectedPermCat('ai_agents');
    setModalOpen(true);
  };

  const handleRoleChange = (role: Role) => {
    setForm((prev) => ({
      ...prev,
      user_type: role,
      permissions: role === 'Admin' ? allPermissionsOn() : role === 'Dealer' ? dealerPermissions() : emptyPermissions(),
    }));
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    fileToResizedDataUrl(file)
      .then((data) => setField('avatar_data', data))
      .catch(() => undefined);
    e.target.value = '';
  };

  const togglePerm = (key: string) =>
    setForm((prev) => {
      const perms = { ...(prev.permissions as Record<string, boolean>) };
      perms[key] = !perms[key];
      return { ...prev, permissions: perms };
    });

  const setAllPermsInCat = (cat: PermissionCategory, value: boolean) =>
    setForm((prev) => {
      const perms = { ...(prev.permissions as Record<string, boolean>) };
      permKeys(cat).forEach((key) => {
        perms[key] = value;
      });
      return { ...prev, permissions: perms };
    });

  const handleSave = async () => {
    const firstName = String(form.first_name ?? '').trim();
    const lastName = String(form.last_name ?? '').trim();
    const email = emailRows.map((r) => r.value.trim()).filter(Boolean).join(', ');
    const phone = phoneRows.map((r) => r.value.trim()).filter(Boolean).join(', ');
    if (!firstName || !lastName || !email) {
      onNotify('Please fill in required fields (Name and Email)', 'error');
      return;
    }

    setSaving(true);
    try {
      const isSelf = editingId !== null && editingId === currentUser?.id;
      const userType: Role = isSelf
        ? (currentUser?.user_type as Role)
        : isDealer
        ? 'Follower'
        : (form.user_type as Role);
      const managerId = isSelf
        ? (currentUser?.manager_id ?? null)
        : isDealer
        ? (currentUser?.id ?? null)
        : ((form.manager_id as number | null | undefined) ?? null);
      const payload: StaffInput = {
        first_name: firstName,
        last_name: lastName,
        email,
        password: String(form.password ?? '') || undefined,
        personal_calendar: String(form.personalCalendar ?? '') || undefined,
        phone: phone || undefined,
        extension: String(form.extension ?? '') || undefined,
        calendar: String(form.calendar ?? ''),
        user_type: userType,
        manager_id: managerId,
        restrict_data: Boolean(form.restrict_data),
        signature: String(form.signature ?? ''),
        system_id: String(form.system_id ?? ''),
        avatar_data: (form.avatar_data as string) || null,
        call_voicemail: form.call_voicemail as never,
        availability: form.availability as StaffAvailability,
        calendar_config: form.calendar_config as never,
        permissions: form.permissions as Record<string, boolean>,
      };
      if (editingId !== null) {
        await updateStaff(editingId, payload);
        onNotify('User updated successfully!');
      } else {
        await addStaff(payload);
        onNotify('New team member added successfully!');
      }
      setModalOpen(false);
    } catch (err) {
      onNotify(`Save failed: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user: ApiStaffUser) => {
    if (!window.confirm(`Remove ${user.full_name} from staff?`)) return;
    try {
      await removeStaff(user.id);
      onNotify('User removed', 'error');
    } catch (err) {
      onNotify(`Delete failed: ${(err as Error).message}`, 'error');
    }
  };

  /** Admin unlocks a pending account; the API emails the user a login link. */
  const handleApprove = async (user: ApiStaffUser) => {
    try {
      await api.approveStaff(user.id);
      await reload();
      onNotify(`${user.full_name} approved — they can now log in.`);
    } catch (err) {
      onNotify(`Approve failed: ${(err as Error).message}`, 'error');
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    onNotify('System ID copied to clipboard');
  };

  const handleGreetingFile = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!/\.(mp3|wav)$/i.test(file.name)) {
      onNotify('Only MP3/WAV audio files are supported.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onNotify('File exceeds the 10MB maximum size.', 'error');
      return;
    }
    setGreetingFile({ name: file.name, size: file.size });
    onNotify('Voicemail greeting attached.');
  };

  const handleGreetingDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setGreetingDragOver(false);
    handleGreetingFile(e.dataTransfer.files);
  };

  const filteredStaff = useMemo(
    () =>
      staff.filter((u) => {
        if (isDealer && u.user_type === 'Dealer') return u.id === currentUser?.id;
        if (isDealer && u.manager_id !== currentUser?.id) return false;
        const name = `${u.first_name} ${u.last_name}`.toLowerCase();
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          !q ||
          name.includes(q) ||
          (u.email ?? '').toLowerCase().includes(q) ||
          (u.phone ?? '').toLowerCase().includes(q) ||
          (u.system_id ?? '').toLowerCase().includes(q);
        const matchesRole = roleFilter === 'All' || u.user_type === roleFilter;
        return matchesSearch && matchesRole;
      }),
    [staff, searchQuery, roleFilter, isDealer, currentUser]
  );

  const perms = (form.permissions as Record<string, boolean>) ?? {};
  const enabledTotal = Object.values(perms).filter(Boolean).length;
  const enabledCat = (cat: PermissionCategory) =>
    permKeys(cat).filter((key) => perms[key]).length;

  const navBtn = (label: string, badge?: string) => (
    <div
      onClick={() => {
        setSettingsSection(label);
        if (label !== 'My Staff') onNotify(`"${label}" settings coming soon`);
      }}
      className={`px-2 py-1.5 rounded cursor-pointer flex items-center justify-between ${
        settingsSection === label
          ? 'bg-blue-600 text-white font-medium shadow-sm'
          : 'text-slate-300 hover:bg-slate-800'
      }`}
    >
      <span>{label}</span>
      {badge ? (
        <span className="bg-amber-400 text-slate-900 text-[9px] font-bold px-1 rounded">{badge}</span>
      ) : (
        <FaChevronRight className="text-[9px] opacity-60" />
      )}
    </div>
  );

  const firstName = String(form.first_name ?? '');
  const lastName = String(form.last_name ?? '');
  const displayInitials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase() || '?';

  const sidebarInner = (
    <>
      <div className="p-3 border-b border-slate-700/60 flex items-center justify-between">
        <WorkspaceBox />
        <FaArrowsUpDown className="text-[10px] text-slate-400" />
      </div>

      <div className="p-2.5">
        <div className="relative">
          <FaMagnifyingGlass className="absolute left-2.5 top-2.5 text-slate-500 text-[11px]" />
          <input
            type="text"
            placeholder="Search ctrlK"
            className="w-full bg-slate-800/80 text-slate-200 pl-8 pr-2 py-1.5 rounded text-[11px] focus:outline-none placeholder-slate-500 border border-slate-700/50"
          />
        </div>
      </div>

      <div className="px-2.5 py-1">
        <button
          onClick={() => {
            setMobileNavOpen(false);
            onBack?.();
          }}
          className="w-full bg-slate-800 hover:bg-slate-700/70 text-slate-200 text-xs py-1.5 px-3 rounded flex items-center space-x-2 transition font-medium"
        >
          <FaArrowLeft className="text-[11px]" />
          <span>Go Back</span>
        </button>
      </div>

      <div className="px-4 pt-3 pb-1">
        <h2 className="text-xs font-bold text-white uppercase tracking-wider">Settings</h2>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5 text-xs">
        {navBtn('Business Profile')}
        {navBtn('Billing')}
        {navBtn('My Staff')}
        {navBtn('Opportunities & Pipelines')}

        <div className="pt-3 pb-1 px-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
          Business Services
        </div>
        {navBtn('Calendars')}
        {navBtn('Email Services')}
        {navBtn('Phone System')}
        {navBtn('WhatsApp')}

        <div className="pt-3 pb-1 px-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
          Other Settings
        </div>
        {navBtn('Objects')}
        {navBtn('Custom Fields')}
        {navBtn('Custom Values')}
        {navBtn('Import Data')}
        {navBtn('Manage Scoring')}
        {navBtn('Domains & URL Redirects')}
        {navBtn('Integrations')}
        {navBtn('Tags')}
        {navBtn('Labs', 'New')}
        {navBtn('Audit Logs')}
      </nav>
    </>
  );

  return (
    <div className="min-h-screen flex bg-slate-100 font-sans w-full overflow-hidden" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Settings mobile drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed md:hidden z-50 top-0 bottom-0 left-0 w-56 bg-[#1e293b] text-slate-300 flex flex-col flex-shrink-0 transition-transform duration-300 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarInner}
      </aside>

      {/* Settings outer sidebar */}
      <aside className="hidden md:flex w-56 bg-[#1e293b] text-slate-300 flex flex-col flex-shrink-0 min-h-screen">
        {sidebarInner}
      </aside>

      {/* Main work area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-3 md:px-6 flex-shrink-0 gap-2">
          <div className="flex items-center min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 flex-shrink-0"
              aria-label="Open settings menu"
            >
              <FaBars className="text-lg" />
            </button>
            <div className="text-sm font-semibold text-slate-700 truncate">My Staff</div>
          </div>
          <div className="flex items-center space-x-2 md:space-x-3">
            <button className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 flex-shrink-0">
              <FaPhone className="text-xs" />
            </button>
            <button className="px-2.5 py-1.5 bg-purple-600 text-white rounded text-xs font-semibold flex items-center space-x-1 hover:bg-purple-700 flex-shrink-0">
              <FaWandMagicSparkles className="text-[10px]" />
              <span className="hidden sm:inline">Ask AI</span>
            </button>
            <button className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs hidden sm:flex flex-shrink-0">
              <FaBullhorn />
            </button>
            <NotificationsBell />
            <button className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 hidden sm:flex flex-shrink-0">
              <FaCircleQuestion />
            </button>
            {currentUser && <UserMenu user={currentUser} onLogout={logout} />}
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
            <div className="flex items-center space-x-3 w-full md:w-auto">
              <div className="relative w-48">
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as 'All' | Role)}
                  className="w-full bg-white border border-slate-300 text-xs rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:border-blue-500 shadow-sm appearance-none pr-8 cursor-pointer"
                >
                  <option value="All">User Role (All)</option>
                  {isAdmin && <option value="Admin">Admin</option>}
                  {isAdmin && <option value="Dealer">Dealer</option>}
                  <option value="Follower">Follower</option>
                </select>
                <FaChevronDown className="absolute right-3 top-3 text-[10px] text-slate-400 pointer-events-none" />
              </div>

              <div className="relative flex-1 md:w-80">
                <FaMagnifyingGlass className="absolute left-3 top-2.5 text-slate-400 text-xs" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="name, email, phone, ids"
                  className="w-full bg-white border border-slate-300 text-xs rounded-md pl-9 pr-3 py-2 text-slate-700 focus:outline-none focus:border-blue-500 shadow-sm"
                />
              </div>
            </div>

            {(isAdmin || isDealer) && (
              <button
                onClick={openAdd}
                className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs px-5 py-2.5 rounded-md shadow-sm flex items-center justify-center space-x-2 transition"
              >
                <FaPlus className="text-xs" />
                <span>Add User</span>
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="sm:hidden divide-y divide-slate-100">
              {loading ? (
                <div className="py-8 text-center text-slate-400">Loading staff...</div>
              ) : filteredStaff.length > 0 ? (
                filteredStaff.map((user) => (
                  <div key={user.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full flex-shrink-0 overflow-hidden bg-purple-600 text-white font-bold flex items-center justify-center text-sm">
                      {user.avatar_data ? (
                        <img src={user.avatar_data} alt={user.full_name} className="w-full h-full object-cover" />
                      ) : (
                        `${user.first_name[0] ?? ''}${user.last_name[0] ?? ''}`.toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 text-sm truncate">{user.full_name}</span>
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border flex-shrink-0 ${
                            ROLE_BADGE[user.user_type as Role] ?? ROLE_BADGE.Follower
                          }`}
                        >
                          {user.user_type}
                        </span>
                        {user.approved === 0 && (
                          <span className="inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300 flex-shrink-0">
                            Pending
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {user.email || '—'}
                        {user.phone ? ` · ${user.phone}` : ''}
                      </div>
                      {user.user_type === 'Follower' && user.manager_id != null && (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Follower of {staff.find((s) => s.id === user.manager_id)?.full_name ?? `user #${user.manager_id}`}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isAdmin && user.approved === 0 && (
                        <button
                          onClick={() => handleApprove(user)}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded transition"
                          title="Approve — allows this user to log in"
                        >
                          <FaCheck className="text-[10px]" />
                          Approve
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(user)}
                        className="p-2 text-slate-400 hover:text-blue-600 transition"
                        title="Edit User"
                      >
                        <FaRegPenToSquare className="text-sm" />
                      </button>
                      <button
                        onClick={() => handleDelete(user)}
                        className="p-2 text-slate-400 hover:text-red-600 transition"
                        title="Delete User"
                      >
                        <FaTrashCan className="text-sm" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-slate-400">
                  No staff members found matching search query.
                </div>
              )}
            </div>

            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Phone</th>
                    <th className="py-3 px-4">User Type</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        Loading staff...
                      </td>
                    </tr>
                  ) : filteredStaff.length > 0 ? (
                    filteredStaff.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden bg-purple-600 text-white font-bold flex items-center justify-center text-xs">
                              {user.avatar_data ? (
                                <img src={user.avatar_data} alt={user.full_name} className="w-full h-full object-cover" />
                              ) : (
                                `${user.first_name[0] ?? ''}${user.last_name[0] ?? ''}`.toUpperCase()
                              )}
                            </div>
                            <span className="font-semibold text-slate-800">{user.full_name}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          <div>{user.email || '—'}</div>
                          {user.system_id && (
                            <div className="text-[10px] text-slate-400 flex items-center space-x-1 mt-0.5">
                              <span>{user.system_id}</span>
                              <FaCopy
                                className="text-[10px] cursor-pointer hover:text-slate-600"
                                onClick={() => copyText(user.system_id ?? '')}
                                title="Copy ID"
                              />
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">{user.phone || '—'}</td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                                ROLE_BADGE[user.user_type as Role] ?? ROLE_BADGE.Follower
                              }`}
                            >
                              {user.user_type}
                            </span>
                            {user.approved === 0 && (
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300">
                                Pending Approval
                              </span>
                            )}
                            {user.user_type === 'Follower' && user.manager_id != null && (
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium text-slate-500 bg-slate-100 border border-slate-200">
                                Follower of{' '}
                                {staff.find((s) => s.id === user.manager_id)?.full_name ?? `user #${user.manager_id}`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                          {isAdmin && user.approved === 0 && (
                            <button
                              onClick={() => handleApprove(user)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded transition"
                              title="Approve — allows this user to log in"
                            >
                              <FaCheck className="text-[10px]" />
                              Approve
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(user)}
                            className="text-slate-400 hover:text-blue-600 transition p-1"
                            title="Edit User"
                          >
                            <FaRegPenToSquare className="text-sm" />
                          </button>
                          <button
                            onClick={() => handleDelete(user)}
                            className="text-slate-400 hover:text-red-600 transition p-1"
                            title="Delete User"
                          >
                            <FaTrashCan className="text-sm" />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        No staff members found matching search query.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between text-xs text-slate-500">
              <div>Page 1</div>
              <div className="flex items-center space-x-2">
                <button className="px-3 py-1 border border-slate-300 rounded bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-50" disabled>
                  Previous
                </button>
                <span className="px-2.5 py-1 bg-blue-600 text-white font-medium rounded text-xs">1</span>
                <button className="px-3 py-1 border border-slate-300 rounded bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-50" disabled>
                  Next
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-6 overflow-hidden">
          <div className="bg-white w-full max-w-6xl h-[92vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
            {/* Modal Header */}
            <div className="px-4 md:px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <div
                  className="flex items-center space-x-2 text-xs text-blue-600 font-semibold cursor-pointer mb-1"
                  onClick={() => setModalOpen(false)}
                >
                  <FaArrowLeft className="text-[10px]" />
                  <span>Back</span>
                </div>
                <h2 className="text-base font-bold text-slate-800">Edit or manage your team</h2>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 flex items-center justify-center transition"
              >
                <FaXmark className="text-sm" />
              </button>
            </div>

            <div className="md:hidden px-3 py-2 bg-white border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs font-medium text-slate-600 flex-shrink-0">
              {(
                [
                  ['userInfo', 'User Info'],
                  ['roles', 'Roles & Permissions'],
                  ['callVoicemail', 'Call & Voicemail'],
                  ['userAvailability', 'Availability'],
                  ['calendarConfig', 'Calendar Config'],
                ] as [TabId, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`px-2.5 py-1.5 rounded-md whitespace-nowrap transition ${
                    activeTab === id ? 'bg-blue-600 text-white font-semibold' : 'hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
              {/* Modal left nav */}
              <div className="hidden md:flex w-64 bg-slate-50/90 border-r border-slate-200 p-3 flex-col space-y-1 text-xs font-medium text-slate-600 flex-shrink-0 overflow-y-auto">
                <button
                  onClick={() => setActiveTab('userInfo')}
                  className={`text-left px-3 py-2.5 rounded-lg transition flex items-center space-x-2.5 ${
                    activeTab === 'userInfo' ? 'bg-blue-50 text-blue-700 font-semibold shadow-sm' : 'hover:bg-slate-200/60'
                  }`}
                >
                  <FaRegUser className="text-xs" />
                  <span>User Info</span>
                </button>

                <div>
                  <button
                    onClick={() => {
                      setActiveTab('roles');
                      setIsRolesExpanded(!isRolesExpanded);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition flex items-center justify-between ${
                      activeTab === 'roles' ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-200/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <FaShieldHalved className="text-xs" />
                      <span>Roles &amp; Permissions</span>
                    </div>
                    <FaChevronDown className={`text-[10px] transition-transform ${isRolesExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {isRolesExpanded && (
                    <div className="ml-3 mt-1 pl-2 border-l-2 border-slate-200 space-y-0.5 max-h-80 overflow-y-auto">
                      {PERMISSION_CATEGORIES.map((cat) => {
                        const count = enabledCat(cat);
                        const isSelected = activeTab === 'roles' && selectedPermCat === cat.id;
                        const Icon = ICON_MAP[cat.icon] ?? FaRobot;
                        return (
                          <button
                            key={cat.id}
                            onClick={() => {
                              setActiveTab('roles');
                              setSelectedPermCat(cat.id);
                              setTimeout(() => {
                                const el = document.getElementById(`perm-cat-${cat.id}`);
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }, 50);
                            }}
                            className={`w-full text-left px-2.5 py-1.5 rounded text-[11px] transition flex items-center justify-between ${
                              isSelected
                                ? 'bg-blue-600 text-white font-semibold shadow-sm'
                                : 'text-slate-600 hover:bg-slate-200/70'
                            }`}
                          >
                            <div className="flex items-center space-x-2 truncate pr-1">
                              <Icon className={`text-[10px] ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                              <span className="truncate">{cat.label}</span>
                            </div>
                            {count > 0 && (
                              <span
                                className={`text-[9px] px-1.5 rounded-full ${
                                  isSelected ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700 font-bold'
                                }`}
                              >
                                {count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {(
                  [
                    ['callVoicemail', 'Call & Voicemail Settings', <FaPhoneVolume key="cv" className="text-xs" />],
                    ['userAvailability', 'User Availability', <FaRegClock key="av" className="text-xs" />],
                    ['calendarConfig', 'Calendar Configuration', <FaRegCalendarCheck key="cc" className="text-xs" />],
                  ] as [TabId, string, React.ReactNode][]
                ).map(([id, label, icon]) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`text-left px-3 py-2.5 rounded-lg transition flex items-center space-x-2.5 ${
                      activeTab === id ? 'bg-blue-50 text-blue-700 font-semibold shadow-sm' : 'hover:bg-slate-200/60'
                    }`}
                  >
                    {icon}
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Modal right content */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-white">
                {activeTab === 'userInfo' && (
                  <div className="space-y-6 max-w-4xl">
                    <div className="flex items-center space-x-6 pb-4 border-b border-slate-100">
                      <div className="relative">
                        <div className="w-20 h-20 rounded-full border-2 border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                          {form.avatar_data ? (
                            <img src={form.avatar_data as string} alt="DP" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-slate-400 text-2xl font-bold">{displayInitials}</span>
                          )}
                        </div>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="absolute bottom-0 right-0 w-6 h-6 bg-white border border-slate-300 rounded-full flex items-center justify-center text-[10px] text-slate-600 shadow hover:bg-slate-50"
                          title="Upload display picture"
                        >
                          <FaCamera />
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleAvatarUpload}
                        />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-800">Profile Image</h4>
                        <p className="text-[11px] text-slate-400">
                          The proposed size is 512x512 px no bigger than 2.5 MB
                        </p>
                        <div className="mt-2 space-x-2">
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-3 py-1 bg-blue-600 text-white rounded text-[11px] font-semibold hover:bg-blue-700 transition"
                          >
                            Upload image
                          </button>
                          {Boolean(form.avatar_data) && (
                            <button
                              onClick={() => setField('avatar_data', null)}
                              className="px-3 py-1 border border-slate-300 text-slate-600 rounded text-[11px] font-semibold hover:bg-slate-50 transition"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          First Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={firstName}
                          onChange={(e) => setField('first_name', e.target.value)}
                          placeholder="First Name"
                          className="w-full border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Last Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={lastName}
                          onChange={(e) => setField('last_name', e.target.value)}
                          placeholder="Last Name"
                          className="w-full border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Email <span className="text-red-500">*</span>
                        </label>
                        <div className="space-y-2">
                          {emailRows.map((row) => (
                            <div key={row.id} className="flex items-center gap-1.5">
                              <input
                                type="email"
                                value={row.value}
                                onChange={(e) => updateEmailRow(row.id, e.target.value)}
                                placeholder="Email"
                                className="flex-1 min-w-0 border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                              />
                              <button
                                type="button"
                                onClick={() => removeEmailRow(row.id)}
                                className="text-slate-400 hover:text-red-500 p-1.5 border border-slate-200 rounded bg-slate-50 hover:bg-slate-100 flex-shrink-0"
                                aria-label="Remove email"
                              >
                                <FaRegTrashCan className="text-xs" />
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={addEmailRow}
                          className="mt-1.5 text-blue-600 hover:underline font-medium text-[11px] flex items-center gap-1"
                        >
                          <FaPlus className="text-[10px]" /> Add email
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
                        <div className="space-y-2">
                          {phoneRows.map((row) => (
                            <div key={row.id} className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={row.value}
                                onChange={(e) => updatePhoneRow(row.id, e.target.value)}
                                placeholder="Phone"
                                className="flex-1 min-w-0 border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                              />
                              <button
                                type="button"
                                onClick={() => removePhoneRow(row.id)}
                                className="text-slate-400 hover:text-red-500 p-1.5 border border-slate-200 rounded bg-slate-50 hover:bg-slate-100 flex-shrink-0"
                                aria-label="Remove phone"
                              >
                                <FaRegTrashCan className="text-xs" />
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={addPhoneRow}
                          className="mt-1.5 text-blue-600 hover:underline font-medium text-[11px] flex items-center gap-1"
                        >
                          <FaPlus className="text-[10px]" /> Add phone
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Extension</label>
                        <input
                          type="text"
                          value={String(form.extension ?? '')}
                          onChange={(e) => setField('extension', e.target.value)}
                          placeholder="Extension"
                          className="w-full border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-blue-600 cursor-pointer flex items-center space-x-1 mb-2">
                        <span>Advanced Settings</span>
                        <FaChevronRight className="text-[10px]" />
                      </div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Calendar</label>
                      <select
                        value={String(form.calendar ?? '')}
                        onChange={(e) => setField('calendar', e.target.value)}
                        className="w-full border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      >
                        <option value="">Select Calendar</option>
                        <option>Main Sales Calendar</option>
                        <option>Customer Care Calendar</option>
                        <option>Executive Calendar</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                      <input
                        type="password"
                        value={String(form.password ?? '')}
                        onChange={(e) => setField('password', e.target.value)}
                        placeholder="Set login password"
                        autoComplete="new-password"
                        className="w-full border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">Used to sign in to this Evee account.</p>
                    </div>

                    <div className="space-y-3 pt-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-800">Signature</label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id="enableSig"
                            checked={true}
                            onChange={() => undefined}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <label htmlFor="enableSig" className="text-xs text-slate-600 cursor-pointer">
                            Enable signature on all outgoing messages
                          </label>
                        </div>
                      </div>

                      <div className="border border-slate-300 rounded-lg overflow-hidden">
                        <RichTextEditor
                          value={String(form.signature ?? '')}
                          onChange={(html) => setField('signature', html)}
                          placeholder="Create your email signature here..."
                          minHeight={110}
                          maxLength={2000}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'roles' && (
                  <div className="space-y-6 max-w-4xl">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 sticky top-0 z-10 shadow-xs">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-800">Global Role &amp; Data Access</h3>
                        <span className="text-xs bg-blue-100 text-blue-800 font-semibold px-3 py-1 rounded-full border border-blue-200">
                          Total Enabled: {enabledTotal}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">User Role</label>
                          <select
                            value={form.user_type as Role}
                            onChange={(e) => handleRoleChange(e.target.value as Role)}
                            disabled={allowedRoles.length <= 1}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:border-blue-500 bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
                          >
                            {allowedRoles.map((r) => (
                              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                            ))}
                            {editingId === currentUser?.id &&
                              !allowedRoles.includes(form.user_type as Role) && (
                                <option value={form.user_type as Role}>{ROLE_LABEL[form.user_type as Role]}</option>
                              )}
                          </select>
                        </div>
                        <div className="flex items-center space-x-2 pt-4 md:pt-0">
                          <input
                            type="checkbox"
                            id="restrictData"
                            checked={Boolean(form.restrict_data)}
                            onChange={(e) => setField('restrict_data', e.target.checked)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                          />
                          <label htmlFor="restrictData" className="text-xs font-medium text-slate-700 cursor-pointer">
                            Restrict data visibility to only assigned data
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      {PERMISSION_CATEGORIES.map((cat) => {
                        const count = enabledCat(cat);
                        const Icon = ICON_MAP[cat.icon] ?? FaRobot;
                        return (
                          <div
                            key={cat.id}
                            id={`perm-cat-${cat.id}`}
                            className={`border rounded-xl overflow-hidden shadow-xs bg-white transition-all ${
                              selectedPermCat === cat.id ? 'ring-2 ring-blue-500 border-blue-400' : 'border-slate-200'
                            }`}
                          >
                            <div className="bg-slate-100/80 px-5 py-3 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                              <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs shadow-xs">
                                  <Icon />
                                </div>
                                <div>
                                  <h4 className="text-xs font-bold text-slate-800">{cat.label} Permissions</h4>
                                    <p className="text-[10px] text-slate-500">
                                      ({count} / {permKeys(cat).length} enabled)
                                    </p>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={() => setAllPermsInCat(cat, true)}
                                  className="px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded-md text-[11px] font-semibold hover:bg-blue-100 transition"
                                >
                                  Enable All ({permKeys(cat).length})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAllPermsInCat(cat, false)}
                                  className="px-2.5 py-1 bg-slate-50 border border-slate-200 text-slate-600 rounded-md text-[11px] font-semibold hover:bg-slate-100 transition"
                                >
                                  Disable All
                                </button>
                              </div>
                            </div>

                            <div className="p-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                {cat.features.map((feature) => {
                                  const anyChecked = feature.actions.some((a) => !!perms[`${cat.id}:${feature.label}:${a}`]);
                                  return (
                                    <div
                                      key={feature.label}
                                      className={`p-2.5 rounded-lg border text-xs transition ${
                                        anyChecked
                                          ? 'bg-blue-50/50 border-blue-300 shadow-xs'
                                          : 'bg-slate-50/60 border-slate-200'
                                      }`}
                                    >
                                      <div className="font-semibold text-slate-800 mb-2">{feature.label}</div>
                                      <div className="flex flex-wrap items-center gap-3">
                                        {feature.actions.map((action) => {
                                          const key = `${cat.id}:${feature.label}:${action}`;
                                          const checked = !!perms[key];
                                          return (
                                            <label
                                              key={action}
                                              className={`flex items-center gap-1.5 text-[11px] cursor-pointer select-none ${
                                                checked ? 'text-blue-700 font-semibold' : 'text-slate-600'
                                              }`}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => togglePerm(key)}
                                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                              />
                                              {ACTION_LABELS[action] ?? action}
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeTab === 'callVoicemail' && (
                  <div className="space-y-6 max-w-4xl">
                    <h3 className="text-sm font-bold text-slate-800">Call &amp; Voicemail Settings</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Inbound Call Timeout (seconds)</label>
                        <input
                          type="number"
                          value={(form.call_voicemail as Record<string, unknown>).inboundTimeout as number}
                          onChange={(e) => setNested(['call_voicemail', 'inboundTimeout'], e.target.value)}
                          className="w-full border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Call Forwarding Number</label>
                        <input
                          type="text"
                          value={(form.call_voicemail as Record<string, unknown>).forwardNumber as string}
                          onChange={(e) => setNested(['call_voicemail', 'forwardNumber'], e.target.value)}
                          placeholder="+92 300 0000000"
                          className="w-full border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-3">
                      <h4 className="text-xs font-bold text-slate-800">Voicemail Audio Greeting</h4>
                      <p className="text-[11px] text-slate-500">
                        Upload an MP3/WAV file or record custom voicemail audio for missed calls.
                      </p>
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setGreetingDragOver(true);
                        }}
                        onDragLeave={() => setGreetingDragOver(false)}
                        onDrop={handleGreetingDrop}
                        onClick={() => greetingInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
                          greetingDragOver ? 'border-blue-500 bg-blue-50/60' : 'border-slate-300 hover:bg-slate-100/50'
                        }`}
                      >
                        {greetingFile ? (
                          <>
                            <p className="text-xs font-semibold text-slate-700 flex items-center justify-center space-x-1">
                              <FaFileAudio className="text-sm text-blue-600" />
                              <span>{greetingFile.name}</span>
                            </p>
                            <p className="text-[10px] text-slate-400 mt-1">
                              {(greetingFile.size / 1024 / 1024).toFixed(2)} MB - click or drop a new file to replace
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-xs font-medium text-slate-700">Click or drag &amp; drop voicemail MP3 here</p>
                            <p className="text-[10px] text-slate-400 mt-1">Maximum file size 10MB</p>
                          </>
                        )}
                      </div>
                      <input
                        ref={greetingInputRef}
                        type="file"
                        accept=".mp3,.wav,audio/*"
                        className="hidden"
                        onChange={(e) => {
                          handleGreetingFile(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Missed Call Auto-Text Back Message</label>
                      <textarea
                        rows={3}
                        value={(form.call_voicemail as Record<string, unknown>).missedTextBack as string}
                        onChange={(e) => setNested(['call_voicemail', 'missedTextBack'], e.target.value)}
                        className="w-full border border-slate-300 rounded p-3 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg bg-slate-50">
                      <div>
                        <h5 className="text-xs font-bold text-slate-800">Enable Inbound/Outbound Call Recording</h5>
                        <p className="text-[11px] text-slate-500">Automatically record all calls associated with this user.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNested(['call_voicemail', 'enableRecording'], !(form.call_voicemail as Record<string, unknown>).enableRecording)}
                        className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                          (form.call_voicemail as Record<string, unknown>).enableRecording ? 'bg-blue-600' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                            (form.call_voicemail as Record<string, unknown>).enableRecording ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'userAvailability' && (
                  <div className="space-y-6 max-w-4xl">
                    <h3 className="text-sm font-bold text-slate-800">User Availability Schedule</h3>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Timezone</label>
                      <select
                        value={(form.availability as StaffAvailability).timezone}
                        onChange={(e) => setNested(['availability', 'timezone'], e.target.value)}
                        className="w-full border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      >
                        <option>Asia/Karachi (GMT+05:00)</option>
                        <option>America/New_York (GMT-05:00)</option>
                        <option>Europe/London (GMT+00:00)</option>
                        <option>Asia/Dubai (GMT+04:00)</option>
                      </select>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-800">Weekly Working Hours</h4>
                      {DAYS.map((day) => {
                        const dayConfig = (form.availability as StaffAvailability).schedule[day] ?? {
                          active: false,
                          start: '09:00',
                          end: '17:00',
                        };
                        return (
                          <div key={day} className="flex items-center justify-between p-2.5 border border-slate-200 rounded-lg hover:bg-slate-50 transition">
                            <div className="flex items-center space-x-3 w-32">
                              <input
                                type="checkbox"
                                checked={dayConfig.active}
                                onChange={(e) => setNested(['availability', 'schedule', day, 'active'], e.target.checked)}
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-xs font-semibold text-slate-700">{day}</span>
                            </div>
                            {dayConfig.active ? (
                              <div className="flex items-center space-x-2 text-xs">
                                <input
                                  type="time"
                                  value={dayConfig.start}
                                  onChange={(e) => setNested(['availability', 'schedule', day, 'start'], e.target.value)}
                                  className="border border-slate-300 rounded px-2 py-1 text-xs text-slate-800"
                                />
                                <span className="text-slate-400">to</span>
                                <input
                                  type="time"
                                  value={dayConfig.end}
                                  onChange={(e) => setNested(['availability', 'schedule', day, 'end'], e.target.value)}
                                  className="border border-slate-300 rounded px-2 py-1 text-xs text-slate-800"
                                />
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 font-medium px-4">Unavailable</span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Meeting Buffer Time</label>
                        <select
                          value={(form.availability as StaffAvailability).bufferTime}
                          onChange={(e) => setNested(['availability', 'bufferTime'], e.target.value)}
                          className="w-full border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                        >
                          <option>None</option>
                          <option>5 mins</option>
                          <option>10 mins</option>
                          <option>15 mins</option>
                          <option>30 mins</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg bg-slate-50">
                        <div>
                          <h5 className="text-xs font-bold text-slate-800">Out of Office / Vacation</h5>
                          <p className="text-[10px] text-slate-500">Pause appointment bookings</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={(form.availability as StaffAvailability).outOfOffice}
                          onChange={(e) => setNested(['availability', 'outOfOffice'], e.target.checked)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'calendarConfig' && (
                  <div className="space-y-6 max-w-4xl">
                    <h3 className="text-sm font-bold text-slate-800">Calendar Configuration</h3>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Primary Calendar (Where new bookings are added)
                      </label>
                      <select
                        value={(form.calendar_config as Record<string, unknown>).primaryCalendar as string}
                        onChange={(e) => setNested(['calendar_config', 'primaryCalendar'], e.target.value)}
                        className="w-full border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      >
                        <option>Main Sales Calendar</option>
                        <option>Customer Care Calendar</option>
                        <option>Default Calendar</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Personal Calendar (Team member whose calendar to follow)
                      </label>
                      <select
                        value={String(form.personalCalendar ?? '')}
                        onChange={(e) => setField('personalCalendar', e.target.value)}
                        className="w-full border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      >
                        <option value="">Select a team member</option>
                        {staff.map((u) => (
                          <option key={u.id} value={`${u.first_name} ${u.last_name}`}>
                            {u.first_name} {u.last_name}
                            {u.email ? ` (${u.email})` : ''}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Keep this user's calendar synced to the selected team member's availability.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Calendar Sync Option</label>
                      <div className="grid grid-cols-2 gap-3">
                        {(['2-way', '1-way'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setNested(['calendar_config', 'syncMode'], mode)}
                            className={`p-3 border rounded-lg text-left text-xs ${
                              (form.calendar_config as Record<string, unknown>).syncMode === mode
                                ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500'
                                : 'border-slate-200'
                            }`}
                          >
                            <div className="font-bold text-slate-800">{mode.toUpperCase()} Sync</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {mode === '2-way' ? 'Sync appointments both ways automatically.' : 'Read-only event check for busy slots.'}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg bg-slate-50">
                      <div>
                        <h5 className="text-xs font-bold text-slate-800">Auto-Confirm New Appointments</h5>
                        <p className="text-[11px] text-slate-500">Automatically accept inbound calendar requests.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean((form.calendar_config as Record<string, unknown>).autoConfirm)}
                        onChange={(e) => setNested(['calendar_config', 'autoConfirm'], e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </div>

                    <div className="space-y-3 pt-2">
                      <h4 className="text-xs font-bold text-slate-800">Calendar Integrations</h4>
                      <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded bg-red-100 flex items-center justify-center text-red-600 font-bold text-xs">
                            <FaGoogle />
                          </div>
                          <div>
                            <h5 className="text-xs font-bold text-slate-800">Google Calendar</h5>
                            <p className="text-[10px] text-emerald-600 font-medium">Connected as user@gmail.com</p>
                          </div>
                        </div>
                        <button className="text-xs text-slate-600 border border-slate-300 px-3 py-1 rounded hover:bg-slate-50">Disconnect</button>
                      </div>
                      <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
                            <FaMicrosoft />
                          </div>
                          <div>
                            <h5 className="text-xs font-bold text-slate-800">Outlook Calendar</h5>
                            <p className="text-[10px] text-slate-400">Not connected</p>
                          </div>
                        </div>
                        <button className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">Connect</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-white shadow-sm transition"
              >
                Cancel
              </button>
              <div className="flex items-center space-x-2">
                {activeTab !== 'userInfo' && (
                  <button
                    type="button"
                    onClick={() => {
                      const idx = TAB_ORDER.indexOf(activeTab);
                      if (idx > 0) setActiveTab(TAB_ORDER[idx - 1]);
                    }}
                    className="px-4 py-2 border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-white transition"
                  >
                    Previous
                  </button>
                )}
                {activeTab !== 'calendarConfig' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const idx = TAB_ORDER.indexOf(activeTab);
                      if (idx < TAB_ORDER.length - 1) setActiveTab(TAB_ORDER[idx + 1]);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 shadow-sm transition"
                  >
                    Next
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 bg-emerald-600 text-white rounded text-xs font-bold hover:bg-emerald-700 shadow-sm transition flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <FaCheck className="text-xs" />
                  <span>{saving ? 'Saving...' : 'Save User'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MyStaffPage;