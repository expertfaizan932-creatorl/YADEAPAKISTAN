import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  FaDownload,
  FaHeadset,
  FaLink,
  FaPaperPlane,
  FaRegTrashCan,
  FaUserCheck,
  FaUserPlus,
  FaXmark,
} from 'react-icons/fa6';
import {
  api,
  type ApiPortalSubmission,
  type ApiStaffUser,
} from '../api';
import { useAuth } from '../auth';
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

const PROBLEMS = [
  'Return',
  'Replace',
  'Product Parts',
  'Product Related Questions',
  'Battery & Charging Issues',
  'Motor & Acceleration Performance',
  'Display Panel & Electronics',
  'Brake System & Suspension',
  'Keyless / Remote Control Unit',
  'Warranty & Service Registration',
  'Others',
];

const inputCls =
  'w-full bg-white border border-slate-300 focus:border-yadea-orange rounded-lg px-4 py-3 text-sm text-slate-800 outline-none transition placeholder-slate-400 shadow-sm';

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

function CustomerInquiriesPage({ onNotify }: PageProps) {
  const { user, hasActionPermission } = useAuth();
  const isAdmin = user?.user_type === 'Admin';
  const canView = hasActionPermission('inquiries', 'Customer Inquiries', 'view');
  const canAdd = hasActionPermission('inquiries', 'Customer Inquiries', 'add');
  const canDelete = hasActionPermission('inquiries', 'Customer Inquiries', 'delete');
  const canExport = hasActionPermission('inquiries', 'Customer Inquiries', 'export');
  const canAssign = hasActionPermission('inquiries', 'Assign/Unassign', 'assign');
  const canUnassign = hasActionPermission('inquiries', 'Assign/Unassign', 'unassign');
  const canCopyLink = hasActionPermission('inquiries', 'Public Form Link', 'send');
  const canConfirmEmail = hasActionPermission('inquiries', 'Confirmation Emails', 'send');
  const canNotifyDealer = hasActionPermission('inquiries', 'Assignment Notifications', 'send');

  const [form, setForm] = useState({
    chassisNumber: '',
    orderNumber: '',
    problemCategory: '',
    custName: '',
    custEmail: '',
    custPhone: '',
    custReason: '',
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
  const [dealers, setDealers] = useState<ApiStaffUser[]>([]);
  const [assignPick, setAssignPick] = useState<Record<number, number>>({});
  const [openAssign, setOpenAssign] = useState<number | null>(null);
  const assignBtnRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [viewing, setViewing] = useState<ApiPortalSubmission | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const setField =
    (key: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  // Non-admins only ever receive inquiries assigned to them.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { type: 'inquiry' as const };
      const res = await api.listPortalSubmissions(
        isAdmin ? params : { type: 'inquiry', restrict_to: user?.id }
      );
      setRows(res.data);
    } catch (err) {
      onNotify(`Failed to load inquiries: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, user?.id, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canAssign) return;
    api
      .listStaff()
      .then((res) => setDealers(res.data.filter((s) => s.user_type === 'Dealer')))
      .catch(() => undefined);
  }, [canAssign]);

  const submit = async () => {
    if (!canAdd) return onNotify('You do not have permission to add customer inquiries');
    if (!form.chassisNumber.trim()) return onNotify('Chassis number is required');
    if (!form.problemCategory) return onNotify('Please pick your problem');
    if (!form.custName.trim()) return onNotify('Name is required');
    if (!form.custEmail.trim()) return onNotify('Email is required');
    if (!form.custPhone.trim()) return onNotify('Phone is required');
    if (!form.custReason.trim()) return onNotify('Please tell us your reason');
    if (!consent) return onNotify('Please accept the Privacy Policy first');

    setSaving(true);
    try {
      const res = await api.createPortalSubmission({
        type: 'inquiry',
        name: form.custName.trim(),
        email: form.custEmail.trim(),
        phone: form.custPhone.trim(),
        chassis_number: form.chassisNumber.trim(),
        order_number: form.orderNumber.trim(),
        problem_category: form.problemCategory,
        reason: form.custReason.trim(),
        created_by: user?.id ?? null,
      });
      onNotify('Support ticket submitted');

      // Send confirmation email to submitter
      const refCode = res.data?.code || '';
      if (canConfirmEmail) {
        sendSmtpEmail({
          to: [form.custEmail.trim()],
          subject: `Support Ticket ${refCode} Received — Yadea Pakistan`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#12161a;">We've Received Your Support Ticket</h2>
          <p>Dear ${form.custName.trim()},</p>
          <p>Thank you for reaching out to Yadea Pakistan. Your support ticket has been successfully submitted.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
            <p style="margin:4px 0;"><strong>Reference Code:</strong> ${refCode}</p>
            <p style="margin:4px 0;"><strong>Problem Category:</strong> ${form.problemCategory}</p>
            <p style="margin:4px 0;"><strong>Chassis Number:</strong> ${form.chassisNumber.trim()}</p>
          </div>
          <p>Our team will review your ticket and respond within 48 business hours.</p>
          <p style="color:#64748b;font-size:12px;margin-top:24px;">Yadea Pakistan — Driving Sustainable Mobility Forward</p>
        </div>`,
        }).catch(() => undefined);
      }
      setForm({ chassisNumber: '', orderNumber: '', problemCategory: '', custName: '', custEmail: '', custPhone: '', custReason: '' });
      setConsent(false);
      await load();
    } catch (err) {
      onNotify(`Submit failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const assign = async (row: ApiPortalSubmission) => {
    if (!canAssign) return onNotify('You do not have permission to assign inquiries');
    const dealerId = assignPick[row.id];
    if (!dealerId) return onNotify('Pick a dealer first');
    try {
      await api.assignPortalSubmission(row.id, dealerId);
      const dealer = dealers.find((d) => d.id === dealerId);
      const name = dealer?.full_name ?? 'dealer';
      onNotify(`Inquiry ${row.code} assigned to ${name} — dealer notified`);

      // Send assignment notification email to dealer
      if (dealer?.email && canNotifyDealer) {
        sendSmtpEmail({
          to: [dealer.email],
          subject: `New Inquiry Assigned to You — ${row.code}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <h2 style="color:#12161a;">You've Been Assigned a New Inquiry</h2>
            <p>Dear ${dealer.full_name},</p>
            <p>A new customer inquiry has been assigned to you. Please review and respond within 48 business hours.</p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
              <p style="margin:4px 0;"><strong>Reference Code:</strong> ${row.code}</p>
              <p style="margin:4px 0;"><strong>Customer Name:</strong> ${row.name}</p>
              <p style="margin:4px 0;"><strong>Email:</strong> ${row.email}</p>
              <p style="margin:4px 0;"><strong>Phone:</strong> ${row.phone}</p>
              <p style="margin:4px 0;"><strong>Problem Category:</strong> ${row.problem_category || 'N/A'}</p>
              <p style="margin:4px 0;"><strong>Reason:</strong> ${row.reason || 'N/A'}</p>
            </div>
            <p>Please log in to the CRM to view the full details and take action.</p>
            <p style="color:#64748b;font-size:12px;margin-top:24px;">Yadea Pakistan — Driving Sustainable Mobility Forward</p>
          </div>`,
        }).catch(() => undefined);
      }

      setAssignPick((prev) => ({ ...prev, [row.id]: 0 }));
      setOpenAssign(null);
      await load();
    } catch (err) {
      onNotify(`Assign failed: ${(err as Error).message}`);
    }
  };

  const unassign = async (row: ApiPortalSubmission) => {
    if (!canUnassign) return onNotify('You do not have permission to unassign inquiries');
    try {
      await api.assignPortalSubmission(row.id, 0);
      onNotify(`Assignment removed from ${row.code}`);
      await load();
    } catch (err) {
      onNotify(`Unassign failed: ${(err as Error).message}`);
    }
  };

  const removeRow = async (row: ApiPortalSubmission) => {
    if (!canDelete) return onNotify('You do not have permission to delete customer inquiries');
    if (!window.confirm(`Delete inquiry ${row.code}?`)) return;
    try {
      await api.deletePortalSubmission(row.id);
      onNotify(`Inquiry ${row.code} deleted`);
      await load();
    } catch (err) {
      onNotify(`Delete failed: ${(err as Error).message}`);
    }
  };

  const copyFormLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/inquiry-form`;
    const ok = await copyText(url);
    onNotify(ok ? 'Public form link copied — share it with anyone' : url);
  };

  const exportCsv = (list: ApiPortalSubmission[], filename: string) => {
    if (!canExport) return onNotify('You do not have permission to export inquiries');
    if (list.length === 0) return onNotify('Nothing to export yet');
    downloadCsv(
      filename,
      ['Code', 'Customer', 'Email', 'Phone', 'Chassis', 'Order', 'Problem', 'Status', 'Assigned To', 'Submitted'],
      list.map((r) => [
        r.code,
        r.name,
        r.email,
        r.phone,
        r.chassis_number,
        r.order_number,
        r.problem_category,
        r.status,
        r.assigned_to_name ?? '',
        fmtDate(r.created_at),
      ])
    );
    onNotify(`CSV exported — ${list.length} inquiry${list.length === 1 ? '' : 's'}`);
  };

  const stats = useMemo(
    () => ({
      total: rows.length,
      new: rows.filter((r) => r.status !== 'assigned').length,
      assigned: rows.filter((r) => r.status === 'assigned').length,
    }),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byFilter = filterSubmissions(rows, statusFilter, dateFilter, customFrom, customTo);
    if (!q) return byFilter;
    return byFilter.filter((r) =>
      [r.code, r.name, r.email, r.phone, r.chassis_number, r.order_number, r.problem_category]
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
            'linear-gradient(180deg, rgba(18,22,25,0.55) 0%, rgba(18,22,25,0.85) 100%), url(\'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1600&q=80\') center/cover no-repeat #12161a',
        }}
      >
        <div>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">Customer Inquiries</h2>
          <p className="text-slate-300 mt-2 text-sm font-light max-w-2xl mx-auto">
            Product support tickets — assign them to the right dealer for a resolution within 48 business hours.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-3 md:px-6 -mt-10 pb-10 relative z-10 space-y-6">
        {/* Ticket form */}
        {canAdd && (
        <div className="bg-white rounded-2xl shadow-xl p-5 md:p-8 border border-slate-100">
          <h3 className="text-xl font-bold text-slate-900 uppercase tracking-wide text-center mb-6">
            Submit A Ticket
          </h3>

          <div className="space-y-4">
            <input value={form.chassisNumber} onChange={setField('chassisNumber')} placeholder="Chassis Number *" className={inputCls} />
            <input value={form.orderNumber} onChange={setField('orderNumber')} placeholder="Order ID / DO Number" className={inputCls} />
            <select value={form.problemCategory} onChange={setField('problemCategory')} className={inputCls}>
              <option value="" disabled>Pick Your Problem *</option>
              {PROBLEMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input value={form.custName} onChange={setField('custName')} placeholder="Name *" className={inputCls} />
              <input type="email" value={form.custEmail} onChange={setField('custEmail')} placeholder="Email *" className={inputCls} />
            </div>
            <input value={form.custPhone} onChange={setField('custPhone')} placeholder="Phone *" className={inputCls} />
            <textarea rows={4} value={form.custReason} onChange={setField('custReason')} placeholder="Tell Us Your Reason *" className={`${inputCls} resize-none`} />

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

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            ['Total Inquiries', stats.total, 'bg-blue-100 text-blue-600'],
            ['New (unassigned)', stats.new, 'bg-amber-100 text-amber-600'],
            ['Assigned', stats.assigned, 'bg-emerald-100 text-emerald-600'],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-500 font-medium">{label}</span>
                <div className="text-2xl font-black text-slate-800 mt-0.5">{value}</div>
              </div>
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg ${tone}`}>
                <FaHeadset />
              </div>
            </div>
          ))}
        </div>

        {/* Inquiries table */}
        {!canView ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
          <p className="text-xs text-slate-500">
            You don't have permission to view customer inquiries. Ask an administrator to enable it.
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
                <span className="font-bold text-slate-700">
                  {filtered.length} of {rows.length}
                </span>
                <span>shown</span>
                {selectedRows.length > 0 && (
                  <>
                    <span className="w-px h-3 bg-slate-300" />
                    <span className="font-bold text-yadea-orange">
                      {selectedRows.length} selected
                    </span>
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
                  placeholder="Search inquiries…"
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
                  onClick={() => exportCsv(selectedRows.length ? selectedRows : filtered, 'yadea_customer_inquiries.csv')}
                  className="text-xs bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5"
                  title="Export the selected inquiries (or every filtered one)"
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
                      title="Select all shown inquiries"
                    />
                  </th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Problem</th>
                  <th className="px-4 py-3">Chassis</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 font-medium">No inquiries found.</td></tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.id}
                      className={`hover:bg-slate-50 transition align-top ${
                        selectedIds.includes(r.id) ? 'bg-orange-50/60' : ''
                      }`}
                    >
                      <td className="px-3 py-3 align-top">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(r.id)}
                          onChange={() => toggleRow(r.id)}
                          className="w-4 h-4 accent-yadea-orange cursor-pointer"
                          title={`Select inquiry ${r.code}`}
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-mono font-bold text-yadea-dark">{r.code}</div>
                        <div className="text-[10px] text-slate-400">{fmtDate(r.created_at)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{r.name}</div>
                        <div className="text-[11px] text-slate-500">{r.email}</div>
                        <div className="text-[11px] text-slate-500">{r.phone}</div>
                      </td>
                      <td className="px-4 py-3 max-w-[160px]">
                        <div className="font-semibold text-slate-700">{r.problem_category || '-'}</div>
                        <div className="text-[11px] text-slate-500 line-clamp-2">{r.reason}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px]">
                        <div>{r.chassis_number}</div>
                        {r.order_number && <div className="text-slate-400">DO: {r.order_number}</div>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.status === 'assigned' ? (
                          <div className="space-y-1">
                            <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
                              Assigned
                            </span>
                            <div className="flex items-center gap-1 text-[11px] text-slate-600">
                              <FaUserCheck className="text-emerald-500 text-[9px]" />
                              <span className="truncate max-w-[90px]">{r.assigned_to_name ?? '-'}</span>
                              {canUnassign && (
                                <button onClick={() => void unassign(r)} title="Remove assignment" className="text-slate-300 hover:text-red-500 transition">
                                  <FaXmark className="text-[9px]" />
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border bg-amber-50 text-amber-700 border-amber-200">
                            New
                          </span>
                        )}
                      </td>
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

        {!isAdmin && (
          <p className="text-[11px] text-slate-400 text-center -mt-2">
            You are viewing inquiries assigned to you.
          </p>
        )}
      </div>

      {/* Details modal */}
      {viewing && (
        <div className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4 evee-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-pop">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-base">Inquiry {viewing.code}</h3>
              <button onClick={() => setViewing(null)} className="text-slate-400 hover:text-slate-600 transition">
                <FaXmark className="text-lg" />
              </button>
            </div>
            <div className="p-5 space-y-1.5 text-xs max-h-[60vh] overflow-y-auto">
              {(
                [
                  ['Customer', viewing.name],
                  ['Email', viewing.email],
                  ['Phone', viewing.phone],
                  ['Chassis #', viewing.chassis_number],
                  ['Order / DO', viewing.order_number],
                  ['Problem', viewing.problem_category],
                  ['Reason', viewing.reason],
                  ['Status', viewing.status],
                  ['Assigned To', viewing.assigned_to_name ?? '-'],
                  ['Submitted', fmtDate(viewing.created_at)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="py-1 border-b border-slate-100">
                  <div className="font-bold uppercase text-slate-400">{k}</div>
                  <div className="text-slate-800 font-medium break-all whitespace-pre-wrap">{v || '-'}</div>
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

export default CustomerInquiriesPage;
