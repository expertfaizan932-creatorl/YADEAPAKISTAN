import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  FaDownload,
  FaLink,
  FaPaperPlane,
  FaRegTrashCan,
  FaStore,
  FaUserCheck,
  FaUserPlus,
  FaXmark,
} from 'react-icons/fa6';
import { api, type ApiPortalSubmission, type ApiStaffUser } from '../api';
import { useAuth } from '../auth';
import { PROVINCES, citiesForProvince } from '../data/pakistanCities';
import {
  countByDateFilter,
  countByStatusFilter,
  downloadCsv,
  filterSubmissions,
  todayYmd,
  type SubmissionDateFilter,
  type SubmissionStatusFilter,
} from '../data/submissionFilters';
import { sendSmtpEmail } from '../services/smtp';
import AnchoredPopover from './AnchoredPopover';
import SubmissionFilterBar from './SubmissionFilterBar';

interface PageProps {
  onNotify: (msg: string) => void;
}

const inputCls =
  'w-full bg-slate-50 border border-transparent focus:border-yadea-orange focus:bg-white rounded-lg px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder-slate-400';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

function fmtDate(v: string | null): string {
  if (!v) return '-';
  const d = new Date(v.includes('T') ? v : v.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function DealershipApplicationsPage({ onNotify }: PageProps) {
  const { user, hasActionPermission } = useAuth();
  const canView = hasActionPermission('dealership', 'Dealership Applications', 'view');
  const canAdd = hasActionPermission('dealership', 'Dealership Applications', 'add');
  const canDelete = hasActionPermission('dealership', 'Dealership Applications', 'delete');
  const canExport = hasActionPermission('dealership', 'Dealership Applications', 'export');
  const canAssign = hasActionPermission('dealership', 'Assign/Unassign', 'assign');
  const canUnassign = hasActionPermission('dealership', 'Assign/Unassign', 'unassign');
  const canCopyLink = hasActionPermission('dealership', 'Public Form Link', 'send');
  const canEmail = hasActionPermission('dealership', 'Confirmation Emails', 'send');

  const [form, setForm] = useState({
    salutation: 'Mr.',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    businessName: '',
    address: '',
    yearsInBusiness: '',
    oemDealer: 'Choose Yes/No',
    province: '',
    city: '',
    propertyOwnership: '',
    structure: '',
    fileName: '',
  });
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);

  const [rows, setRows] = useState<ApiPortalSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SubmissionStatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<SubmissionDateFilter>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [viewing, setViewing] = useState<ApiPortalSubmission | null>(null);
  const [dealers, setDealers] = useState<ApiStaffUser[]>([]);
  const [assignPick, setAssignPick] = useState<Record<number, number>>({});
  const [openAssign, setOpenAssign] = useState<number | null>(null);
  const assignBtnRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!canAssign) return;
    api
      .listStaff()
      .then((res) => setDealers(res.data.filter((s) => s.user_type === 'Dealer')))
      .catch(() => undefined);
  }, [canAssign]);

  const cityOptions = useMemo(() => citiesForProvince(form.province), [form.province]);

  const setField =
    (key: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listPortalSubmissions({ type: 'dealership' });
      setRows(res.data);
    } catch (err) {
      onNotify(`Failed to load applications: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!canAdd) return onNotify('You do not have permission to add dealership applications');
    if (!form.firstName.trim() || !form.lastName.trim()) return onNotify('First and last name are required');
    if (!form.email.trim()) return onNotify('Email is required');
    if (!form.phone.trim()) return onNotify('Phone is required');
    if (!form.businessName.trim()) return onNotify('Business name is required');
    if (!form.address.trim()) return onNotify('Address is required');
    if (!form.yearsInBusiness.trim()) return onNotify('Years in business is required');
    if (!consent) return onNotify('Please accept the Privacy Policy first');

    setSaving(true);
    try {
      const res = await api.createPortalSubmission({
        type: 'dealership',
        name: `${form.salutation} ${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        business_name: form.businessName.trim(),
        address: form.address.trim(),
        years_in_business: form.yearsInBusiness.trim(),
        oem_dealer: form.oemDealer === 'Choose Yes/No' ? '' : form.oemDealer,
        province: form.province,
        city: form.city,
        property_ownership: form.propertyOwnership,
        structure: form.structure,
        file_name: form.fileName,
        created_by: user?.id ?? null,
      });
      onNotify('Dealership application submitted');

      // Send confirmation email to applicant
      const refCode = res.data?.code || '';
      if (canEmail) {
        sendSmtpEmail({
          to: [form.email.trim()],
          subject: `Dealership Application ${refCode} Received — Yadea Pakistan`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#12161a;">Thank You for Your Dealership Application</h2>
          <p>Dear ${form.salutation} ${form.firstName.trim()} ${form.lastName.trim()},</p>
          <p>We have received your dealership application. Our team will review it and get back to you soon.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
            <p style="margin:4px 0;"><strong>Reference Code:</strong> ${refCode}</p>
            <p style="margin:4px 0;"><strong>Business Name:</strong> ${form.businessName.trim()}</p>
            <p style="margin:4px 0;"><strong>Province:</strong> ${form.province || 'N/A'}</p>
            <p style="margin:4px 0;"><strong>City:</strong> ${form.city || 'N/A'}</p>
          </div>
          <p>If you have any questions, please don't hesitate to reach out.</p>
          <p style="color:#64748b;font-size:12px;margin-top:24px;">Yadea Pakistan — Driving Sustainable Mobility Forward</p>
        </div>`,
        }).catch(() => undefined);
      }
      setForm((prev) => ({
        ...prev,
        firstName: '', lastName: '', email: '', phone: '', businessName: '', address: '',
        yearsInBusiness: '', oemDealer: 'Choose Yes/No', city: '', propertyOwnership: '',
        structure: '', fileName: '',
      }));
      setConsent(false);
      await load();
    } catch (err) {
      onNotify(`Submit failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (row: ApiPortalSubmission) => {
    if (!canDelete) return onNotify('You do not have permission to delete dealership applications');
    if (!window.confirm(`Delete application ${row.code}?`)) return;
    try {
      await api.deletePortalSubmission(row.id);
      onNotify(`Application ${row.code} deleted`);
      await load();
    } catch (err) {
      onNotify(`Delete failed: ${(err as Error).message}`);
    }
  };

  const copyFormLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/dealership-form`;
    const ok = await copyText(url);
    onNotify(ok ? 'Public form link copied — share it with anyone' : url);
  };

  const assign = async (row: ApiPortalSubmission) => {
    if (!canAssign) return onNotify('You do not have permission to assign applications');
    const dealerId = assignPick[row.id];
    if (!dealerId) return onNotify('Pick a dealer first');
    try {
      await api.assignPortalSubmission(row.id, dealerId);
      const name = dealers.find((d) => d.id === dealerId)?.full_name ?? 'dealer';
      onNotify(`Application ${row.code} assigned to ${name} — dealer notified`);
      setAssignPick((prev) => ({ ...prev, [row.id]: 0 }));
      setOpenAssign(null);
      await load();
    } catch (err) {
      onNotify(`Assign failed: ${(err as Error).message}`);
    }
  };

  const unassign = async (row: ApiPortalSubmission) => {
    if (!canUnassign) return onNotify('You do not have permission to unassign applications');
    try {
      await api.assignPortalSubmission(row.id, 0);
      onNotify(`Assignment removed from ${row.code}`);
      await load();
    } catch (err) {
      onNotify(`Unassign failed: ${(err as Error).message}`);
    }
  };

  const exportCsv = (list: ApiPortalSubmission[], filename: string) => {
    if (!canExport) return onNotify('You do not have permission to export applications');
    if (list.length === 0) return onNotify('Nothing to export yet');
    downloadCsv(
      filename,
      ['Code', 'Name', 'Business', 'Email', 'Phone', 'City', 'Province', 'OEM', 'Years', 'Property', 'Structure', 'File', 'Status', 'Assigned To', 'Submitted'],
      list.map((r) => [
        r.code,
        r.name,
        r.business_name,
        r.email,
        r.phone,
        r.city,
        r.province,
        r.oem_dealer,
        r.years_in_business,
        r.property_ownership,
        r.structure,
        r.file_name,
        r.status,
        r.assigned_to_name ?? '',
        fmtDate(r.created_at),
      ])
    );
    onNotify(`CSV exported — ${list.length} application${list.length === 1 ? '' : 's'}`);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byFilter = filterSubmissions(rows, statusFilter, dateFilter, customFrom, customTo);
    if (!q) return byFilter;
    return byFilter.filter((r) =>
      [r.code, r.name, r.business_name, r.email, r.phone, r.city, r.province]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [rows, search, statusFilter, dateFilter, customFrom, customTo]);

  const selectedRows = useMemo(
    () => filtered.filter((r) => selectedIds.includes(r.id)),
    [filtered, selectedIds]
  );

  const statusCounts = useMemo(() => countByStatusFilter(rows), [rows]);
  const dateCounts = useMemo(() => countByDateFilter(rows), [rows]);

  const toggleRow = (id: number) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleSelectAll = () => {
    const visible = filtered.map((r) => r.id);
    const allSelected = visible.length > 0 && visible.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) =>
      allSelected ? prev.filter((id) => !visible.includes(id)) : Array.from(new Set([...prev, ...visible]))
    );
  };

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = selectedRows.length > 0 && selectedRows.length < filtered.length;
  }, [selectedRows.length, filtered.length]);

  return (
    <div className="min-h-full bg-slate-100">
      {/* Hero */}
      <div
        className="relative h-52 md:h-64 flex items-center justify-center text-center px-4"
        style={{
          background:
            'linear-gradient(180deg, rgba(18,22,25,0.55) 0%, rgba(18,22,25,0.85) 100%), url(\'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1600&q=80\') center/cover no-repeat #12161a',
        }}
      >
        <div>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">Dealership Applications</h2>
          <p className="text-slate-300 mt-2 text-sm font-light max-w-2xl mx-auto">
            Register new dealer partners — applications land here for review and follow-up.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-3 md:px-6 -mt-10 pb-10 relative z-10 space-y-6">
        {/* Application form */}
        {canAdd && (
        <div className="bg-white rounded-2xl shadow-xl p-5 md:p-8 border border-slate-100">
          <h3 className="text-xl font-bold text-slate-900 uppercase tracking-wide text-center mb-6">
            Dealership Application
          </h3>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-3">
                <label className={labelCls}>Salutation</label>
                <select value={form.salutation} onChange={setField('salutation')} className={inputCls}>
                  <option>Mr.</option>
                  <option>Mrs.</option>
                  <option>Ms.</option>
                  <option>Dr.</option>
                </select>
              </div>
              <div className="md:col-span-4">
                <label className={labelCls}>First Name *</label>
                <input value={form.firstName} onChange={setField('firstName')} placeholder="First name" className={inputCls} />
              </div>
              <div className="md:col-span-5">
                <label className={labelCls}>Last Name *</label>
                <input value={form.lastName} onChange={setField('lastName')} placeholder="Last name" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Email Address *</label>
                <input type="email" value={form.email} onChange={setField('email')} placeholder="name@email.com" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Phone *</label>
                <input value={form.phone} onChange={setField('phone')} placeholder="+92 3xx xxxxxxx" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Current Business Name *</label>
                <input value={form.businessName} onChange={setField('businessName')} placeholder="Business name" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Address *</label>
                <input value={form.address} onChange={setField('address')} placeholder="Business address" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Years in Automotive Business *</label>
                <input type="number" min={0} max={60} value={form.yearsInBusiness} onChange={setField('yearsInBusiness')} placeholder="e.g. 8" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Currently an OEM Dealer</label>
                <select value={form.oemDealer} onChange={setField('oemDealer')} className={inputCls}>
                  <option value="Choose Yes/No">Choose Yes/No</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Province</label>
                <select
                  value={form.province}
                  onChange={(e) => setForm((prev) => ({ ...prev, province: e.target.value, city: '' }))}
                  className={inputCls}
                >
                  <option value="">Select Province</option>
                  {PROVINCES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>City</label>
                <select value={form.city} onChange={setField('city')} className={inputCls}>
                  <option value="">Select City</option>
                  {cityOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Property Ownership</label>
                <select value={form.propertyOwnership} onChange={setField('propertyOwnership')} className={inputCls}>
                  <option value="">Select Property Status</option>
                  <option>Property Owned</option>
                  <option>Property Rented</option>
                  <option>Property Leased</option>
                  <option>Property to be procured</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Structure</label>
                <select value={form.structure} onChange={setField('structure')} className={inputCls}>
                  <option value="">Select Structure Status</option>
                  <option>Completely Finished</option>
                  <option>Grey Structure Ready</option>
                  <option>Empty Plot</option>
                  <option>N/A</option>
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Attach File Here (file name reference)</label>
              <input value={form.fileName} onChange={setField('fileName')} placeholder="e.g. profile_documents.pdf" className={inputCls} />
            </div>

            <label className="flex items-start gap-2 pt-1 cursor-pointer">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 accent-yadea-orange cursor-pointer" />
              <span className="text-xs text-slate-600 leading-relaxed">
                I have read the Privacy Policy and accept the processing of data for the purposes indicated.
              </span>
            </label>

            <div className="pt-2 flex justify-center">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving}
                className="w-full md:w-1/2 bg-yadea-orange hover:bg-yadea-dark text-white font-bold py-3 px-8 rounded-lg shadow-md hover:shadow-lg transition uppercase tracking-wider text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FaPaperPlane className="text-xs" />
                {saving ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Received applications */}
        {!canView ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
          <p className="text-xs text-slate-500">
            You don't have permission to view dealership applications. Ask an administrator to enable it.
          </p>
        </div>
        ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-3">
            <SubmissionFilterBar
              status={statusFilter}
              onStatusChange={setStatusFilter}
              date={dateFilter}
              onDateChange={(v) => {
                setDateFilter(v);
                if (v === 'custom' && !customFrom && !customTo) {
                  const t = todayYmd();
                  setCustomFrom(t);
                  setCustomTo(t);
                }
              }}
              customFrom={customFrom}
              customTo={customTo}
              onCustomChange={(from, to) => {
                setCustomFrom(from);
                setCustomTo(to);
              }}
              statusCounts={statusCounts}
              dateCounts={dateCounts}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <FaStore className="text-yadea-orange" />
                <span className="text-sm font-bold text-slate-700">Received Applications</span>
                <span className="bg-slate-200 text-slate-600 text-[10px] px-2 py-0.5 rounded-full">{rows.length}</span>
                {selectedRows.length > 0 && (
                  <>
                    <span className="w-px h-3 bg-slate-300" />
                    <span className="font-bold text-yadea-orange">{selectedRows.length} selected</span>
                    <button
                      onClick={() => setSelectedIds([])}
                      className="font-bold text-slate-400 hover:text-yadea-orange transition"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search applications…"
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-yadea-orange w-44"
                />
                {canCopyLink && (
                <button
                  onClick={() => void copyFormLink()}
                  className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5"
                  title="Copy the public link for this form"
                >
                  <FaLink className="text-[10px]" /> Copy Form Link
                </button>
                )}
                {canExport && (
                <button
                  onClick={() => exportCsv(selectedRows.length ? selectedRows : filtered, 'yadea_dealership_applications.csv')}
                  className="text-xs bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5"
                  title="Export the selected applications (or every filtered one)"
                >
                  <FaDownload className="text-[10px]" />
                  {selectedRows.length ? `Export Selected (${selectedRows.length})` : 'Export CSV'}
                </button>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-100 text-slate-700 uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={filtered.length > 0 && selectedRows.length === filtered.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 accent-yadea-orange cursor-pointer"
                      title="Select all shown applications"
                    />
                  </th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Applicant / Business</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">City</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 font-medium">No applications yet.</td></tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.id}
                      className={`hover:bg-slate-50 transition ${
                        selectedIds.includes(r.id) ? 'bg-orange-50/60' : ''
                      }`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(r.id)}
                          onChange={() => toggleRow(r.id)}
                          className="w-4 h-4 accent-yadea-orange cursor-pointer"
                          title={`Select application ${r.code}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-yadea-dark">{r.code}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{r.name}</div>
                        <div className="text-[11px] text-slate-500">{r.business_name}</div>
                        {r.assigned_to && (
                          <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-bold mt-0.5">
                            <FaUserCheck className="text-[8px]" />
                            <span className="truncate max-w-[110px]">{r.assigned_to_name ?? 'Assigned'}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div>{r.email}</div>
                        <div className="text-[11px] text-slate-500">{r.phone}</div>
                      </td>
                      <td className="px-4 py-3">{r.city || '-'}</td>
                      <td className="px-4 py-3 text-slate-400 text-[11px]">{fmtDate(r.created_at)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="relative inline-block text-left space-x-1.5">
                          {canAssign && (
                            <button
                              ref={(el) => {
                                assignBtnRefs.current[r.id] = el;
                              }}
                              onClick={() => setOpenAssign((v) => (v === r.id ? null : r.id))}
                              className={`text-[11px] font-bold px-2 py-1 rounded transition ${
                                openAssign === r.id
                                  ? 'bg-yadea-orange text-white'
                                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
                              }`}
                              title="Assign to a dealer"
                            >
                              <FaUserPlus className="inline mr-1 text-[9px]" />
                              Assign to
                            </button>
                          )}
                          <button onClick={() => setViewing(r)} className="text-slate-600 hover:text-yadea-orange text-[11px] font-bold px-2 py-1 bg-slate-100 rounded hover:bg-orange-50 transition">
                            View
                          </button>
                          {canDelete && (
                            <button onClick={() => void removeRow(r)} className="text-red-500 hover:text-red-700 text-[11px] px-2 py-1 bg-red-50 rounded hover:bg-red-100 transition">
                              <FaRegTrashCan />
                            </button>
                          )}

                          <AnchoredPopover
                            open={canAssign && openAssign === r.id}
                            anchorEl={assignBtnRefs.current[r.id] ?? null}
                            onClose={() => setOpenAssign(null)}
                            placement="bottom-end"
                            width={224}
                            className="bg-white border border-slate-200 rounded-lg shadow-2xl p-2.5 text-left"
                          >
                            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
                              Assign to dealer — {r.code}
                            </p>
                            <select
                              value={assignPick[r.id] ?? 0}
                              onChange={(e) => setAssignPick((prev) => ({ ...prev, [r.id]: Number(e.target.value) }))}
                              className="w-full bg-white border border-slate-300 rounded-md px-2 py-1.5 text-[11px] outline-none focus:border-yadea-orange mb-2"
                            >
                              <option value={0}>Select dealer…</option>
                              {dealers.map((d) => (
                                <option key={d.id} value={d.id}>{d.full_name}</option>
                              ))}
                            </select>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => void assign(r)}
                                className="flex-1 bg-yadea-orange hover:bg-yadea-dark text-white text-[11px] font-bold py-1.5 rounded-md transition"
                              >
                                Assign & Notify
                              </button>
                              {r.assigned_to && canUnassign && (
                                <button
                                  onClick={() => void unassign(r)}
                                  className="flex-1 bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 text-[11px] font-bold py-1.5 rounded-md transition"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </AnchoredPopover>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>

      {/* Details modal */}
      {viewing && (
        <div className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4 evee-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-pop">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-base">
                Application {viewing.code}
              </h3>
              <button onClick={() => setViewing(null)} className="text-slate-400 hover:text-slate-600 transition">
                <FaXmark className="text-lg" />
              </button>
            </div>
            <div className="p-5 space-y-1.5 text-xs max-h-[60vh] overflow-y-auto">
              {(
                [
                  ['Name', viewing.name],
                  ['Business', viewing.business_name],
                  ['Email', viewing.email],
                  ['Phone', viewing.phone],
                  ['Address', viewing.address],
                  ['Years in Business', viewing.years_in_business],
                  ['OEM Dealer', viewing.oem_dealer],
                  ['Province', viewing.province],
                  ['City', viewing.city],
                  ['Property', viewing.property_ownership],
                  ['Structure', viewing.structure],
                  ['File', viewing.file_name],
                  ['Submitted', fmtDate(viewing.created_at)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-1 border-b border-slate-100">
                  <span className="font-bold uppercase text-slate-400 shrink-0">{k}</span>
                  <span className="text-slate-800 text-right font-medium break-all">{v || '-'}</span>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
              <button onClick={() => setViewing(null)} className="bg-slate-800 text-white text-xs px-4 py-2 rounded-lg font-semibold hover:bg-slate-900 transition">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DealershipApplicationsPage;
