import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiContact, ApiFollower } from '../api';
import { api } from '../api';
import { formatDbDate, initialsFromName, fileToResizedDataUrl, formSubmissionsOf } from '../utils';
import {
  CONTACT_SOURCES as BASE_CONTACT_SOURCES,
  resolveContactSource,
} from '../data/contactSource';
import { countryCodes } from '../data/formOptions';
import { TIMEZONES } from '../data/timezones';
import { useStaff } from '../StaffContext';
import { useAuth } from '../auth';
import { seedContactFollowers, setContactFollowers, seedContactOwner, setContactOwner } from '../data/followersStore';
import Tag from './Tag';
import ActionsTab from './ActionsTab';
import SearchableSelect from './SearchableSelect';
import {
  FaAngleDown,
  FaArrowLeft,
  FaCheck,
  FaChevronDown,
  FaChevronLeft,
  FaChevronRight,
  FaCircleInfo,
  FaCirclePlus,
  FaCopy,
  FaMagnifyingGlass,
  FaPlus,
  FaRegAddressBook,
  FaRegFileLines,
  FaRegIdCard,
  FaRegTrashCan,
  FaRegUser,
  FaXmark,
} from 'react-icons/fa6';

type SubTab = 'all' | 'dnd' | 'actions';

interface DndState {
  calls: boolean;
  email: boolean;
  fb: boolean;
  gmb: boolean;
  inbound: boolean;
  sms: boolean;
  whatsapp: boolean;
}

const DND_CHANNELS: { key: keyof DndState; label: string }[] = [
  { key: 'calls', label: 'Calls & Voicemails' },
  { key: 'email', label: 'Email' },
  { key: 'fb', label: 'FB Messenger' },
  { key: 'gmb', label: 'GMB Messenger' },
  { key: 'inbound', label: 'Inbound' },
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

const CONTACT_SOURCES: string[] = [...BASE_CONTACT_SOURCES];

interface ContactInfoPanelProps {
  contact: ApiContact;
  onBack: () => void;
  onNotify: (msg: string) => void;
  onOpenDrawer: (panel: string) => void;
  onAvatarUpdated?: (data: string) => void;
  onSaved?: (updates: Partial<ApiContact>) => void;
  position?: { current: number; total: number };
  onNavigate?: (dir: 'prev' | 'next') => void;
  className?: string;
}

const inputCls =
  'w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs focus:outline-none focus:border-blue-500 font-medium text-slate-700';

const labelCls = 'text-[10px] text-slate-400 block mb-0.5';

function Accordion({
  title,
  icon,
  searchText,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  searchText: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const matches = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return q === '' || `${title} ${searchText}`.toLowerCase().includes(q) || children === null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  if (!matches) return null;

  return (
    <div className="accordion-item border border-slate-200 rounded-md bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full bg-slate-50 px-3 py-2 flex items-center justify-between cursor-pointer font-semibold text-slate-700 hover:bg-slate-100 transition"
      >
        <span className="text-xs font-bold flex items-center gap-1.5">
          <span className="text-slate-400 text-[11px]">{icon}</span>
          <span>{title}</span>
        </span>
        <FaChevronDown
          className={`text-[10px] text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="p-3 space-y-3 border-t border-slate-100">{children}</div>}
    </div>
  );
}

function ContactInfoPanel({ contact, onBack, onNotify, onOpenDrawer, onAvatarUpdated, onSaved, position, onNavigate, className }: ContactInfoPanelProps) {
  const [subtab, setSubtab] = useState<SubTab>('all');
  const [fieldSearch, setFieldSearch] = useState('');
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [avatarData, setAvatarData] = useState<string | null>(contact.avatar_data ?? null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const ownerRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const staff = useStaff();
  const { hasActionPermission } = useAuth();
  const canAssignOwner = hasActionPermission('contacts', 'Assign/Unassign', 'assign');
  const canUnassignOwner = hasActionPermission('contacts', 'Assign/Unassign', 'unassign');

  useEffect(() => {
    setAvatarData(contact.avatar_data ?? null);
    seedContactOwner(contact.id, {
      assignedTo: contact.assigned_to,
      ownerName: contact.assigned_to_name,
      ownerAvatar: contact.assigned_to_avatar,
    });
    setOwnerNameLocal(contact.assigned_to_name || null);
    setOwnerAvatarLocal(contact.assigned_to_avatar || null);
  }, [contact]);

  const [ownerNameLocal, setOwnerNameLocal] = useState<string | null>(contact.assigned_to_name || null);
  const [ownerAvatarLocal, setOwnerAvatarLocal] = useState<string | null>(contact.assigned_to_avatar || null);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      onNotify('Please choose an image file.');
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      onNotify('Image must be no bigger than 2.5 MB.');
      return;
    }
    fileToResizedDataUrl(file)
      .then((data) => {
        setUploadingAvatar(true);
        return api
          .updateContact(contact.id, { avatar_data: data })
          .then(() => {
            setAvatarData(data);
            onNotify('Profile picture updated');
            onAvatarUpdated?.(data);
          })
          .catch((err) => onNotify(`Upload failed: ${(err as Error).message}`))
          .finally(() => {
            setUploadingAvatar(false);
            e.target.value = '';
          });
      })
      .catch(() => {
        onNotify('Could not read that image file.');
        e.target.value = '';
      });
  };

  const assignOwner = async (staffId: number | null) => {
    if (assigning) return;
    setAssigning(true);
    setOwnerOpen(false);
    try {
      await api.updateContact(contact.id, { assigned_to: staffId });
      const assigned = staffId === null ? null : staff.staff.find((s) => s.id === staffId) ?? null;
      const name = staffId === null ? 'Unassigned' : assigned?.full_name ?? 'Unknown';
      setOwnerNameLocal(staffId === null ? null : assigned?.full_name ?? null);
      setOwnerAvatarLocal(staffId === null ? null : assigned?.avatar_data ?? null);
      setContactOwner(contact.id, {
        assignedTo: staffId,
        ownerName: staffId === null ? null : assigned?.full_name ?? null,
        ownerAvatar: staffId === null ? null : assigned?.avatar_data ?? null,
      });
      onNotify(`Lead assigned to ${name}`);
    } catch (err) {
      onNotify(`Assign failed: ${(err as Error).message}`);
    } finally {
      setAssigning(false);
    }
  };

  const [followers, setFollowers] = useState<ApiFollower[]>(contact.followers ?? []);
  const [followerOpen, setFollowerOpen] = useState(false);
  const followerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFollowers(contact.followers ?? []);
    seedContactFollowers(contact.id, contact.followers ?? []);
  }, [contact]);

  const toggleFollower = async (staffId: number) => {
    if (followers.some((f) => f.id === staffId)) {
      try {
        await api.removeFollower(contact.id, staffId);
        const next = followers.filter((f) => f.id !== staffId);
        setFollowers(next);
        setContactFollowers(contact.id, next);
        onNotify('Follower removed');
      } catch (err) {
        onNotify(`Remove failed: ${(err as Error).message}`);
      }
    } else {
      try {
        await api.addFollower(contact.id, staffId);
        const added = staff.staff.find((s) => s.id === staffId);
        if (added) {
          const next = [...followers.filter((f) => f.id !== staffId), {
            id: added.id,
            first_name: added.first_name,
            last_name: added.last_name,
            full_name: added.full_name,
            user_type: added.user_type,
            avatar_data: added.avatar_data,
          }];
          setFollowers(next);
          setContactFollowers(contact.id, next);
          onNotify(`${added.full_name} is now following`);
        }
      } catch (err) {
        onNotify(`Add failed: ${(err as Error).message}`);
      }
    }
    setFollowerOpen(false);
  };

  const [dndAll, setDndAll] = useState(false);
  const [dndChannels, setDndChannels] = useState<DndState>({
    calls: false,
    email: false,
    fb: false,
    gmb: false,
    inbound: false,
    sms: false,
    whatsapp: false,
  });
  const dndMutedCount = Object.values(dndChannels).filter(Boolean).length;

  const toggleDndAll = () => {
    const next = !dndAll;
    setDndAll(next);
    if (next) {
      setDndChannels({ calls: false, email: false, fb: false, gmb: false, inbound: false, sms: false, whatsapp: false });
    }
    onNotify(next ? 'DND enabled for all channels' : 'DND disabled for all channels');
  };

  const toggleDndChannel = (key: keyof DndState) => {
    setDndAll(false);
    setDndChannels((prev) => ({ ...prev, [key]: !prev[key] }));
    const label = DND_CHANNELS.find((c) => c.key === key)?.label ?? key;
    onNotify(`DND ${!dndChannels[key] ? 'enabled' : 'disabled'} for ${label}`);
  };

  const [fields, setFields] = useState(() => {
    const cf = contact.custom_fields ?? {};
    return {
      first: contact.first_name || '',
      last: contact.last_name || '',
      dob: (cf['dob'] as string) || '',
      gender: (cf['gender'] as string) || 'Female',
      address: (cf['address'] as string) || '',
      city: (cf['city'] as string) || '',
      postal: (cf['postal_code'] as string) || '',
      language: (cf['language'] as string) || '',
      timezone: (cf['timezone'] as string) || '',
      source: resolveContactSource(cf).value,
      contactType: contact.contact_type || '',
      business: contact.business_name || '',
      website: (cf['website'] as string) || '',
    };
  });

  // Leads captured from a public form have no stored source — it is derived
  // from the submission so the dropdown shows the real platform without anyone
  // having to set it. `auto` marks a value nobody picked by hand.
  const derivedSource = useMemo(() => resolveContactSource(contact.custom_fields), [contact.custom_fields]);
  const sourceOptions = useMemo(() => {
    if (!derivedSource.value || CONTACT_SOURCES.includes(derivedSource.value)) return CONTACT_SOURCES;
    return [...CONTACT_SOURCES, derivedSource.value];
  }, [derivedSource.value]);

  const [emails, setEmails] = useState<{ id: number; value: string }[]>([
    { id: 1, value: contact.email || '' },
  ]);
  const [phones, setPhones] = useState<{ id: number; type: string; dialCode: string; value: string }[]>([
    { id: 1, type: 'Mobile', dialCode: '+92', value: contact.phone || '' },
  ]);
  const idCounter = useRef(2);
  const [saving, setSaving] = useState(false);

  // Re-sync editable fields when navigating to a different contact
  // (keyed on the id only, so avatar uploads don't wipe in-progress edits).
  useEffect(() => {
    const cf = contact.custom_fields ?? {};
    setFields({
      first: contact.first_name || '',
      last: contact.last_name || '',
      dob: (cf['dob'] as string) || '',
      gender: (cf['gender'] as string) || 'Female',
      address: (cf['address'] as string) || '',
      city: (cf['city'] as string) || '',
      postal: (cf['postal_code'] as string) || '',
      language: (cf['language'] as string) || '',
      timezone: (cf['timezone'] as string) || '',
      source: resolveContactSource(cf).value,
      contactType: contact.contact_type || '',
      business: contact.business_name || '',
      website: (cf['website'] as string) || '',
    });
    setEmails([{ id: 1, value: contact.email || '' }]);
    setPhones([{ id: 1, type: 'Mobile', dialCode: '+92', value: contact.phone || '' }]);
    idCounter.current = 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id]);

  const [tags, setTags] = useState<string[]>(contact.tags ?? []);
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState('');

  const formSubmissions = useMemo(() => formSubmissionsOf(contact.custom_fields), [contact]);

  useEffect(() => {
    setTags(contact.tags ?? []);
  }, [contact]);

  const persistTags = (next: string[]) => {
    setTags(next);
    api
      .updateContact(contact.id, { tags: next })
      .catch((err) => onNotify(`Failed to update tags: ${(err as Error).message}`));
  };

  const addTag = () => {
    const t = tagDraft.trim();
    setAddingTag(false);
    if (!t) return;
    if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      persistTags([...tags, t]);
      onNotify(`Tag "${t}" added`);
    }
    setTagDraft('');
  };

  const removeTag = (t: string) => {
    persistTags(tags.filter((x) => x !== t));
    onNotify(`Tag "${t}" removed`);
  };

  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFields((prev) => ({ ...prev, [key]: e.target.value }));

  const setEmailRow = (id: number, value: string) =>
    setEmails((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  const addEmailRow = () => setEmails((prev) => [...prev, { id: idCounter.current++, value: '' }]);
  const removeEmailRow = (id: number) =>
    setEmails((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));

  const setPhoneRow = (id: number, patch: Partial<{ type: string; dialCode: string; value: string }>) =>
    setPhones((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addPhoneRow = () =>
    setPhones((prev) => [...prev, { id: idCounter.current++, type: 'Mobile', dialCode: '+92', value: '' }]);
  const removePhoneRow = (id: number) =>
    setPhones((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    onNotify(`Copied "${text}" to clipboard!`);
  };

  const persistFields = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const email = emails.map((r) => r.value.trim()).find(Boolean) ?? '';
      const phone = phones.map((r) => r.value.trim()).find(Boolean) ?? '';
      const cf = { ...(contact.custom_fields ?? {}) };
      cf['dob'] = fields.dob;
      cf['gender'] = fields.gender;
      cf['address'] = fields.address;
      cf['city'] = fields.city;
      cf['postal_code'] = fields.postal;
      cf['language'] = fields.language;
      cf['timezone'] = fields.timezone;
      cf['source'] = fields.source;
      cf['website'] = fields.website;

      const updates = {
        first_name: fields.first,
        last_name: fields.last,
        phone,
        email,
        business_name: fields.business,
        contact_type: fields.contactType,
        custom_fields: cf,
      };
      await api.updateContact(contact.id, updates);
      onNotify('Contact details saved');
      onSaved?.({ ...updates, id: contact.id });
    } catch (err) {
      onNotify(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const initials = initialsFromName(contact.name);
  const createdText = formatDbDate(contact.created_at);
  const createdOnText = (() => {
    if (!contact.created_at) return '9 Aug 2026, 9:46 PM (PKT)';
    const d = new Date(contact.created_at.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return `${contact.created_at} (PKT)`;
    const date = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `${date}, ${time} (PKT)`;
  })();

  const subtabBtn = (tab: SubTab, label: string) => (
    <button
      onClick={() => setSubtab(tab)}
      className={`py-1 rounded-md text-center transition ${
        subtab === tab
          ? 'text-slate-800 bg-white shadow-sm font-semibold'
          : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className={`flex flex-col flex-shrink-0 overflow-hidden shadow-sm bg-white rounded-lg border border-slate-200 w-full max-w-full h-full lg:w-[330px] lg:max-w-[330px] ${className ?? ''}`}>
      <div className="p-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button onClick={onBack} className="text-slate-400 hover:text-slate-600">
            <FaArrowLeft className="text-xs" />
          </button>
          <span className="font-semibold text-slate-800 text-xs">Contact Details</span>
        </div>
        <div className="flex items-center space-x-1.5 text-xs text-slate-500">
          <span>{position ? `${position.current} / ${position.total}` : '2 / 7'}</span>
          <button
            onClick={() => (position && onNavigate ? onNavigate('prev') : onNotify('Previous contact'))}
            className={`hover:text-slate-800 ${
              position && (position.current <= 1 || position.current < 1) ? 'opacity-30 pointer-events-none' : ''
            }`}
            title="Previous contact"
          >
            <FaChevronLeft className="text-[10px]" />
          </button>
          <button
            onClick={() => (position && onNavigate ? onNavigate('next') : onNotify('Next contact'))}
            className={`hover:text-slate-800 ${
              position && (position.current >= position.total || position.current < 1) ? 'opacity-30 pointer-events-none' : ''
            }`}
            title="Next contact"
          >
            <FaChevronRight className="text-[10px]" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-xs space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              title="Click to upload profile picture"
              className="relative w-10 h-10 rounded-full overflow-hidden bg-sky-100 text-sky-600 font-semibold flex items-center justify-center text-sm border border-sky-200 group"
            >
              {avatarData ? (
                <img src={avatarData} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                initials
              )}
              <span className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-[9px] font-bold opacity-0 group-hover:opacity-100 transition">
                {uploadingAvatar ? '...' : 'Upload'}
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <div>
              <h2 className="font-bold text-slate-800 text-sm flex items-center gap-1">{contact.name}</h2>
              {contact.contact_type && (
                <span className="text-[10px] text-slate-400">{contact.contact_type}</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
          <div>
            <span className="text-slate-400 block mb-1">Owner</span>
            <div className="relative" ref={ownerRef}>
              {canAssignOwner || canUnassignOwner ? (
                <>
                  <button
                    onClick={() => setOwnerOpen((v) => !v)}
                    className="inline-flex items-center space-x-1 border border-slate-200 rounded px-2 py-1 text-slate-600 bg-slate-50 hover:bg-slate-100 transition"
                    title="Assign owner"
                  >
                    {ownerAvatarLocal ? (
                      <img src={ownerAvatarLocal} alt={ownerNameLocal ?? 'owner'} className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <FaRegUser className="text-[10px] text-slate-400" />
                    )}
                    <span>
                      {ownerNameLocal || (contact.assigned_to ? 'Loading…' : 'Unassigned')}
                    </span>
                    <FaChevronDown className="text-[9px] ml-1 text-slate-400" />
                  </button>

                  {ownerOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setOwnerOpen(false)} />
                      <div className="absolute left-0 top-full mt-1 z-30 w-52 bg-white border border-slate-200 rounded-md shadow-xl py-1 text-xs max-h-56 overflow-y-auto">
                        {canUnassignOwner && (
                          <button
                            onClick={() => void assignOwner(null)}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700"
                          >
                            <FaRegUser className="text-slate-400 text-[11px]" />
                            <span>Unassigned</span>
                          </button>
                        )}
                        {canAssignOwner && staff.staff
                          .filter((s) => !followers.some((f) => f.id === s.id))
                          .map((s) => (
                            <button
                              key={s.id}
                              onClick={() => void assignOwner(s.id)}
                              className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 transition ${
                                contact.assigned_to === s.id ? 'text-blue-600 font-semibold' : 'text-slate-700'
                              }`}
                            >
                              {s.avatar_data ? (
                                <img src={s.avatar_data} alt={s.full_name} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                              ) : (
                                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                                  {s.first_name[0]}{s.last_name[0] || ''}
                                </span>
                              )}
                              <span className="truncate">{s.full_name}</span>
                              <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                                s.user_type === 'Admin'
                                  ? 'bg-purple-100 text-purple-700'
                                  : s.user_type === 'Dealer'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                                {s.user_type}
                              </span>
                            </button>
                          ))}
                        {canAssignOwner && staff.staff.filter((s) => !followers.some((f) => f.id === s.id)).length === 0 && (
                      <div className="px-3 py-2 text-slate-400 text-center">No staff users yet</div>
                    )}
                  </div>
                </>
              )}
                </>
              ) : (
                <div className="inline-flex items-center space-x-1 border border-slate-200 rounded px-2 py-1 text-slate-600 bg-slate-50">
                  {ownerAvatarLocal ? (
                    <img src={ownerAvatarLocal} alt={ownerNameLocal ?? 'owner'} className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <FaRegUser className="text-[10px] text-slate-400" />
                  )}
                  <span>{ownerNameLocal || (contact.assigned_to ? 'Loading…' : 'Unassigned')}</span>
                </div>
              )}
            </div>
          </div>
          <div className="relative" ref={followerRef}>
            <span className="text-slate-400 block mb-1">Followers</span>
            <div className="flex items-center gap-1 flex-wrap">
              {followers.map((f) => (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1 border border-slate-200 rounded px-1.5 py-0.5 text-slate-600 bg-slate-50"
                  title={f.full_name}
                >
                  {f.avatar_data ? (
                    <img src={f.avatar_data} alt={f.full_name} className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 text-[8px] font-bold flex items-center justify-center flex-shrink-0">
                      {f.first_name[0]}{f.last_name[0] || ''}
                    </span>
                  )}
                  <span className="text-[10px] max-w-[80px] truncate">{f.first_name}</span>
                  <button
                    onClick={() => void toggleFollower(f.id)}
                    className="text-slate-300 hover:text-red-500 transition flex-shrink-0"
                    title={`Remove ${f.full_name} from followers`}
                    aria-label={`Remove follower ${f.full_name}`}
                  >
                    <FaXmark className="text-[10px]" />
                  </button>
                </span>
              ))}
              <button
                onClick={() => setFollowerOpen((v) => !v)}
                className="w-6 h-6 border border-dashed border-slate-300 rounded flex items-center justify-center text-slate-400 hover:border-slate-400 hover:text-blue-500 transition"
                title="Add follower"
              >
                <FaCirclePlus className="text-[10px]" />
              </button>
            </div>

            {followerOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setFollowerOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-30 w-52 bg-white border border-slate-200 rounded-md shadow-xl py-1 text-xs max-h-56 overflow-y-auto">
                  {staff.staff
                    .filter((s) => s.id !== contact.assigned_to)
                    .map((s) => {
                      const isFollower = followers.some((f) => f.id === s.id);
                      return (
                        <button
                          key={s.id}
                          onClick={() => void toggleFollower(s.id)}
                          className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 transition ${
                            isFollower ? 'text-blue-600 font-semibold' : 'text-slate-700'
                          }`}
                        >
                          {s.avatar_data ? (
                            <img src={s.avatar_data} alt={s.full_name} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                              {s.first_name[0]}{s.last_name[0] || ''}
                            </span>
                          )}
                          <span className="truncate">{s.full_name}</span>
                          <span className="ml-auto text-[9px] text-slate-400 flex-shrink-0">
                            {isFollower ? 'Following' : 'Add'}
                          </span>
                        </button>
                      );
                    })}
                  {staff.staff.filter((s) => s.id !== contact.assigned_to).length === 0 && (
                    <div className="px-3 py-2 text-slate-400 text-center">No staff users yet</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <span className="text-slate-400 block mb-1 text-[11px]">Tags</span>
          <div className="flex items-center gap-1 flex-wrap">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1">
                <Tag label={t} />
                <button
                  onClick={() => removeTag(t)}
                  className="text-slate-300 hover:text-red-500 transition flex-shrink-0"
                  title="Remove tag"
                  aria-label={`Remove tag ${t}`}
                >
                  <FaXmark className="text-xs" />
                </button>
              </span>
            ))}
            {addingTag ? (
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addTag();
                  if (e.key === 'Escape') {
                    setAddingTag(false);
                    setTagDraft('');
                  }
                }}
                onBlur={addTag}
                autoFocus
                placeholder="Tag name"
                className="w-24 px-2 py-0.5 bg-white border border-slate-300 rounded text-[11px] text-slate-700 focus:outline-none focus:border-blue-500"
              />
            ) : (
              <button
                onClick={() => setAddingTag(true)}
                className="w-6 h-6 border border-slate-300 rounded-full flex items-center justify-center text-blue-500 hover:bg-blue-50 transition"
                title="Add tag"
              >
                <FaCirclePlus className="text-xs" />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600">
          {subtabBtn('all', 'All fields')}
          {subtabBtn('dnd', 'DND')}
          {subtabBtn('actions', 'Actions')}
        </div>

        {subtab === 'all' && (
          <div className="space-y-3">
            <div className="relative mt-3 mb-2">
              <FaMagnifyingGlass className="absolute left-2.5 top-2.5 text-slate-400 text-[11px]" />
              <input
                type="text"
                value={fieldSearch}
                onChange={(e) => setFieldSearch(e.target.value)}
                placeholder="Search fields and folders"
                className="w-full pl-7 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-2">
              <Accordion title="Contact" icon={<FaRegAddressBook />} searchText={fieldSearch} defaultOpen>
                <div>
                  <label className={labelCls}>First name</label>
                  <input type="text" value={fields.first} onChange={set('first')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Last name</label>
                  <input type="text" value={fields.last} onChange={set('last')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Date of Birth</label>
                  <input type="date" value={fields.dob} onChange={set('dob')} className={inputCls} />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className={labelCls}>Contact source</label>
                    {derivedSource.auto && derivedSource.value && (
                      <span
                        className="text-[9px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full"
                        title={`Auto-detected from the "${derivedSource.fromForm}" form`}
                      >
                        Auto
                      </span>
                    )}
                  </div>
                  <select value={fields.source} onChange={set('source')} className={inputCls}>
                    <option value="">--</option>
                    {sourceOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {derivedSource.auto && derivedSource.value && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      Detected from the {derivedSource.fromForm} form
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Contact type</label>
                  <select value={fields.contactType} onChange={set('contactType')} className={inputCls}>
                    <option value="Lead">Lead</option>
                    <option value="Customer">Customer</option>
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className={labelCls}>Email</label>
                    <button onClick={addEmailRow} className="text-blue-500 hover:text-blue-600 flex items-center gap-0.5">
                      <FaPlus className="text-[9px]" /> Add email
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {emails.map((row) => (
                      <div key={row.id} className="flex items-center gap-1">
                        <input
                          type="email"
                          value={row.value}
                          onChange={(e) => setEmailRow(row.id, e.target.value)}
                          className={inputCls}
                          placeholder="user@example.com"
                        />
                        {row.value && (
                          <button onClick={() => copy(row.value)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                            <FaCopy className="text-[10px]" />
                          </button>
                        )}
                        <button
                          onClick={() => removeEmailRow(row.id)}
                          className="text-slate-400 hover:text-red-500 flex-shrink-0"
                          title="Remove email"
                        >
                          <FaRegTrashCan className="text-[10px]" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className={labelCls}>Phone</label>
                    <button onClick={addPhoneRow} className="text-blue-500 hover:text-blue-600 flex items-center gap-0.5">
                      <FaPlus className="text-[9px]" /> Add phone
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {phones.map((row) => (
                      <div key={row.id} className="flex items-center gap-1">
                        <select
                          value={row.type}
                          onChange={(e) => setPhoneRow(row.id, { type: e.target.value })}
                          className="w-[74px] px-1 py-1 bg-white border border-slate-200 rounded text-xs text-slate-600 focus:outline-none focus:border-blue-500 flex-shrink-0"
                          aria-label="Phone type"
                        >
                          <option>Home</option>
                          <option>Work</option>
                          <option>Mobile</option>
                          <option>Landline</option>
                        </select>
                        <select
                          value={row.dialCode}
                          onChange={(e) => setPhoneRow(row.id, { dialCode: e.target.value })}
                          className="w-[84px] px-1 py-1 bg-white border border-slate-200 rounded text-xs text-slate-600 focus:outline-none focus:border-blue-500 flex-shrink-0"
                          aria-label="Country code"
                        >
                          {countryCodes.map((cc, idx) => (
                            <option key={idx} value={cc.code}>
                              {cc.flag} {cc.code}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={row.value}
                          onChange={(e) => setPhoneRow(row.id, { value: e.target.value })}
                          className={inputCls}
                          placeholder="Enter phone number"
                        />
                        <button
                          onClick={() => removePhoneRow(row.id)}
                          className="text-slate-400 hover:text-red-500 flex-shrink-0"
                          title="Remove phone"
                        >
                          <FaRegTrashCan className="text-[10px]" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </Accordion>

              <Accordion title="General Info" icon={<FaRegIdCard />} searchText={fieldSearch}>
                <div>
                  <label className={labelCls}>Gender</label>
                  <select value={fields.gender} onChange={set('gender')} className={inputCls}>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Business name</label>
                  <input type="text" value={fields.business} onChange={set('business')} className={inputCls} placeholder="Evee Motors" />
                </div>
                <div>
                  <label className={labelCls}>Website</label>
                  <input type="text" value={fields.website} onChange={set('website')} className={inputCls} placeholder="www.example.com" />
                </div>
                <div>
                  <label className={labelCls}>Address</label>
                  <input type="text" value={fields.address} onChange={set('address')} className={inputCls} placeholder="Street 14, F-8/3" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>City</label>
                    <input type="text" value={fields.city} onChange={set('city')} className={inputCls} placeholder="Islamabad" />
                  </div>
                  <div>
                    <label className={labelCls}>Postal Code</label>
                    <input type="text" value={fields.postal} onChange={set('postal')} className={inputCls} placeholder="44000" />
                  </div>
                </div>
              </Accordion>

              <Accordion title="Additional Info" icon={<FaCircleInfo />} searchText={fieldSearch}>
                <div>
                  <label className={labelCls}>Preferred Language</label>
                  <input type="text" value={fields.language} onChange={set('language')} className={inputCls} placeholder="English / Urdu" />
                </div>
                <div>
                  <label className={labelCls}>Timezone</label>
                  <SearchableSelect
                    options={TIMEZONES}
                    value={fields.timezone}
                    onChange={(timezone) => setFields((prev) => ({ ...prev, timezone }))}
                    placeholder="Please input"
                    searchPlaceholder="Search timezone..."
                  />
                </div>
                <div>
                  <label className={labelCls}>Source / Origin</label>
                  <input type="text" value={fields.source} onChange={set('source')} className={inputCls} placeholder="Website Lead Form" />
                </div>
              </Accordion>

              {formSubmissions.length === 0 ? (
                <Accordion title="Form" icon={<FaRegFileLines />} searchText={fieldSearch}>
                  <p className="text-xs text-slate-400">No form submissions for this contact.</p>
                </Accordion>
              ) : (
                formSubmissions.map((sub, i) => (
                  <Accordion key={i} title={`Form | ${sub.formName}`} icon={<FaRegFileLines />} searchText={fieldSearch}>
                    {sub.submittedOn && (
                      <div>
                        <label className={labelCls}>Form Submission Date</label>
                        <input
                          type="text"
                          value={new Date(sub.submittedOn).toLocaleString()}
                          readOnly
                          className={`${inputCls} bg-slate-50`}
                        />
                      </div>
                    )}
                    {Object.entries(sub.values).map(([label, value]) => (
                      <div key={label}>
                        <label className={labelCls}>{label}</label>
                        <input type="text" value={value} readOnly className={`${inputCls} bg-slate-50`} />
                      </div>
                    ))}
                  </Accordion>
                ))
              )}
            </div>
          </div>
        )}

        {subtab === 'dnd' && (
          <div className="space-y-3 mt-3">
            <div className="border border-slate-200 rounded-md overflow-hidden bg-white shadow-sm">
              <button
                onClick={() => onNotify('DND Settings')}
                className="w-full bg-slate-50/70 px-3 py-2 flex items-center justify-between cursor-pointer font-semibold text-slate-800 hover:bg-slate-100/80 transition"
              >
                <span className="text-xs font-bold">DND Settings</span>
                <FaAngleDown className="text-[10px] text-slate-500" />
              </button>
              <div className="p-3 space-y-1 text-xs">
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 mb-1">
                  <div>
                    <span className="font-medium text-slate-700">DND All Channels</span>
                    <span className="block text-[10px] text-slate-400">
                      {dndAll ? 'Muted on every channel' : `Mutes ${DND_CHANNELS.length} channels at once`}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={dndAll}
                    onChange={toggleDndAll}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </div>

                {DND_CHANNELS.map((ch) => (
                  <div key={ch.key} className="flex items-center justify-between py-1.5">
                    <span className="font-medium text-slate-700">{ch.label}</span>
                    <input
                      type="checkbox"
                      checked={dndChannels[ch.key]}
                      onChange={() => toggleDndChannel(ch.key)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </div>
                ))}

                <p className="text-[10px] text-slate-400 pt-2 border-t border-slate-100">
                  {dndAll
                    ? 'DND is active for all channels'
                    : `${dndMutedCount} of ${DND_CHANNELS.length} channels muted`}
                </p>
              </div>
            </div>
          </div>
        )}

        {subtab === 'actions' && (
          <ActionsTab
            createdBy="Form"
            createdOn={createdOnText}
            onCreateOpportunity={() => onOpenDrawer('opportunities')}
            onLinkExisting={() => onNotify('Linking existing opportunity...')}
            onAuditLogsClick={() => onNotify('Opening audit logs...')}
            onNotify={onNotify}
          />
        )}

        {subtab !== 'actions' && (
          <div className="pt-2 border-t border-slate-100 text-[10px] text-slate-400 space-y-1">
            <p>
              Created by: <span className="text-blue-600">Manual addition by Asad B Zaman</span>
            </p>
            <p>Created on: {createdText ? `${createdText} (PKT)` : '--'}</p>
          </div>
        )}
      </div>

      {subtab === 'all' && (
        <div className="px-3 py-2 border-t border-slate-200 bg-white flex-shrink-0">
          <button
            onClick={() => void persistFields()}
            disabled={saving}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 rounded-lg transition shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FaCheck className="text-xs" />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}

export default ContactInfoPanel;
