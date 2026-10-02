import { useEffect, useRef, useState } from 'react';
import { FaRegCalendar, FaRegCircleCheck, FaRegClock } from 'react-icons/fa6';
import { api } from '../api';
import { logActivity } from '../data/activityLog';
import { ensureCampaignsLoaded, campaignNameById } from '../data/campaigns';
import { deserializeFormFromUrl, type PublicFormPayload } from '../utils';
import { recordFormSubmission } from '../data/formsStore';
import { detectFormSource } from '../data/contactSource';
import { useAuth } from '../auth';
import { navigate } from '../router';
import { LocalDropdownRowsField, childOptionsFor, type LocalDropdownRow } from './LocalDropdownSettings';

const DEFAULT_OPTIONS = ['Option 1', 'Option 2', 'Option 3'];

const TEXT_LIKE = [
  'text',
  'phone',
  'email',
  'date',
  'number',
  'monetary',
  'source',
  'score',
  'address',
  'city',
  'state',
  'country',
  'postal_code',
  'organization',
  'website',
];

function findField(elements: PublicFormPayload['elements'], re: RegExp) {
  return elements.find((el) => re.test(el.label.trim())) ?? null;
}

export default function PublicFormPage({ data, formId }: { data?: string; formId?: number }) {
  const decoded = data ? deserializeFormFromUrl(data) : null;
  const [fetched, setFetched] = useState<PublicFormPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const { login } = useAuth();

  // Short share links (#/f/{id}) load the form definition from the server.
  useEffect(() => {
    if (!formId) return;
    let alive = true;
    api
      .getPublicForm(formId)
      .then((res) => {
        if (!alive) return;
        const f = res.data;
        const elements = (Array.isArray(f.elements) ? f.elements : []) as Record<string, unknown>[];
        setFetched({
          name: String(f.name ?? ''),
          columns: Number(f.cols) === 2 ? 2 : 1,
          campaignId: (f.campaign_id as number | null) ?? undefined,
          header: (f.header as PublicFormPayload['header']) ?? undefined,
          elements: elements
            .filter((el) => el && !el.isHidden)
            .map((el) => ({
              label: String(el.label ?? ''),
              type: String(el.type ?? 'text'),
              required: !!el.required,
              placeholder: el.placeholder as string | undefined,
              options: el.options as string[] | undefined,
              id: (el.id as number | undefined) ?? undefined,
              rows: el.rows as LocalDropdownRow[] | undefined,
              buttonColor:
                el.type === 'button' ? (el.buttonColor as string | undefined) : undefined,
              buttonTextColor:
                el.type === 'button' ? (el.buttonTextColor as string | undefined) : undefined,
            })),
        });
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [formId]);

  const form = decoded ?? fetched;
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  /** Per-field validation messages keyed by element label. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /** Update a field value and clear its validation error when the user types. */
  const updateValue = (label: string, value: string) => {
    setValues((p) => {
      const next = { ...p, [label]: value };
      if (!form) return next;
      // Local Dropdown: parent changed -> drop a stale child value that is no
      // longer a valid option for the newly selected parent value.
      const parentMatch = label.match(/^parent:(\d+)$/);
      if (parentMatch && (form.elements ?? []).some((el) => el.type === 'local_dropdown')) {
        const rowId = Number(parentMatch[1]);
        for (const el of form.elements) {
          const row = (el.rows ?? []).find((r) => r.id === rowId);
          if (row) {
            const childKey = `child:${rowId}`;
            const opts = childOptionsFor(row, value);
            if (next[childKey] && !opts.includes(next[childKey])) delete next[childKey];
            break;
          }
        }
      }
      return next;
    });
    if (fieldErrors[label]) {
      setFieldErrors((p) => {
        const n = { ...p };
        delete n[label];
        return n;
      });
    }
  };

  /** Resolve the options a dropdown should show right now. Plain dropdowns use
   *  their own Options list; Local Dropdown rows resolve via parent mapping. */
  const optionsFor = (el: PublicFormPayload['elements'][number]) =>
    el.options && el.options.length > 0 ? [...el.options] : [...DEFAULT_OPTIONS];

  /** Border/ring classes turn rose + show an error for required fields left empty. */
  const inputClass = (label: string) =>
    `w-full px-3 py-2 border rounded-md text-sm text-slate-800 focus:ring-1 focus:ring-blue-500 outline-none ${
      fieldErrors[label] ? 'border-rose-400 ring-1 ring-rose-200' : 'border-slate-300'
    }`;
  /** Dealer credentials created for this submission (dealership forms only). */
  const [dealer, setDealer] = useState<{ email: string; password: string } | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [pendingApproval, setPendingApproval] = useState(false);
  const signingInRef = useRef(false);

  /**
   * Log the new dealer in and take them to their dashboard. Used by the
   * auto-redirect countdown and by the manual "continue" button.
   */
  const signInAndContinue = async () => {
    if (!dealer || signingInRef.current) return;
    signingInRef.current = true;
    try {
      await login({ email: dealer.email, password: dealer.password });
      navigate({ name: 'dashboard' });
    } catch {
      // Auto-login failed: keep the thank-you screen with the manual button.
    } finally {
      signingInRef.current = false;
    }
  };

  useEffect(() => {
    if (!dealer || pendingApproval) return;
    if (countdown <= 0) {
      void signInAndContinue();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [dealer, countdown, pendingApproval]);

  if (!form) {
    // Short links still loading their definition from the server.
    if (formId && !loadFailed) {
      return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
          <div className="text-xs font-medium text-slate-400 animate-pulse">Loading form…</div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 max-w-sm text-center">
          <p className="font-semibold text-slate-700">Invalid form link</p>
          <p className="text-xs text-slate-400 mt-1">This link appears to be broken.</p>
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields before anything else — no submission until every
    // required field carries a non-empty value. Buttons are never checked.
    const errs: Record<string, string> = {};
    for (const el of form.elements) {
      if (el.type === 'button') continue;
      if (el.type === 'local_dropdown') {
        if (!el.required) continue;
        for (const row of el.rows ?? []) {
          if (!(values[`parent:${row.id}`] ?? '').trim() || !(values[`child:${row.id}`] ?? '').trim()) {
            errs[el.label] = 'Every parent/child pair is required';
            break;
          }
        }
        continue;
      }
      if (el.required && !(values[el.label] ?? '').trim()) {
        errs[el.label] =
          el.type === 'checkbox' || el.type === 'radio' || el.type === 'tnc'
            ? 'Please select an option'
            : 'This field is required';
      }
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setErrorMsg('');
      setStatus('idle');
      return;
    }
    setFieldErrors({});

    setStatus('submitting');
    setErrorMsg('');
    try {
      const firstName = values[findField(form.elements, /first\s*name/i)?.label ?? ''] ?? '';
      const lastName = values[findField(form.elements, /last\s*name/i)?.label ?? ''] ?? '';
      const fullNameEl = findField(form.elements, /^(full\s*)?name$/i);
      const fullName = values[fullNameEl?.label ?? ''] ?? '';
      let name = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : (fullName || '');

      const email = values[findField(form.elements, /email/i)?.label ?? ''] ?? undefined;
      const phone = values[findField(form.elements, /phone/i)?.label ?? ''] ?? undefined;
      const business = values[findField(form.elements, /organization|business|company/i)?.label ?? ''] ?? undefined;

      // A contact always needs a name; fall back to the email local part (or a
      // generic label) so forms without a name field still create the lead.
      if (!name && email) name = email.split('@')[0];
      if (!name) name = 'Form Lead';

      const submittedAt = new Date().toISOString();
      // Where the visitor came from, resolved once per page view so it cannot
      // change mid-submission. Facebook/Instagram/Google ads all report a
      // referrer, so simply dropping the form link into a campaign is enough.
      const leadSource = detectFormSource({
        referrer: typeof document === 'undefined' ? '' : document.referrer,
        search: typeof window === 'undefined' ? '' : window.location.search,
        formName: form.name,
        campaignName: form.campaignId ? campaignNameById(form.campaignId) : '',
      });
      const filled: Record<string, string> = {};
      for (const el of form.elements) {
        if (el.type === 'button') continue;
        if (el.type === 'local_dropdown') {
          for (const row of el.rows ?? []) {
            const p = values[`parent:${row.id}`];
            const c = values[`child:${row.id}`];
            if (p && p.trim()) filled[`${el.label} · ${row.parentLabel}`] = p.trim();
            if (c && c.trim()) filled[`${el.label} · ${row.childLabel}`] = c.trim();
          }
          continue;
        }
        const v = values[el.label];
        if (v && v.trim()) filled[el.label] = v.trim();
      }

      const res = await api.submitPublicLead({
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        name,
        email: email || undefined,
        phone: phone || undefined,
        business_name: business || undefined,
        contact_type: 'Lead',
        tags: ['lead', form.name],
        custom_fields: {
          // Auto-detected from the referrer/utm the visitor arrived with, so the
          // lead's Contact source is already correct in the CRM — staff never
          // have to pick it by hand. Left empty when nothing can be determined.
          ...(leadSource ? { source: leadSource } : {}),
          form_submissions: [
            {
              formName: form.name,
              submittedOn: submittedAt,
              ...(leadSource ? { source: leadSource } : {}),
              values: filled,
            },
          ],
        },
      });

      recordFormSubmission(form.name, form.elements);

      // Resolve the campaign name (fetched from the server) so the activity
      // tab can show which campaign this form belongs to. On localhost the
      // fetch fails silently and resolves to ''.
      if (form.campaignId && !campaignNameById(form.campaignId)) {
        await ensureCampaignsLoaded().catch(() => undefined);
      }
      const resolvedCampaign = form.campaignId ? campaignNameById(form.campaignId) : '';

      logActivity({
        type: 'form',
        title: 'Form submitted',
        detail: [
          `Form: ${form.name}`,
          resolvedCampaign ? `Campaign: ${resolvedCampaign}` : null,
          `Submitted: ${new Date(submittedAt).toLocaleString()}`,
        ]
          .filter(Boolean)
          .join('\n'),
        contactId: res.data.id,
      });

      // Dealership registration forms also create a Dealer website account
      // (from the submitted email) so the submitter can be logged in right
      // after the thank-you message. Best-effort: the lead stays saved even
      // if account provisioning fails.
      if (email && /dealer/i.test(form.name)) {
        try {
          const nameParts = name.split(/\s+/);
          const dealershipCode =
            values[findField(form.elements, /dealership\s*code/i)?.label ?? ''] ?? '';
          const reg = await api.registerDealer({
            first_name: nameParts[0] || undefined,
            last_name: nameParts.slice(1).join(' ') || undefined,
            email,
            phone,
            dealership_code: dealershipCode || undefined,
          });
          if (reg.password) {
            setDealer({ email, password: reg.password });
            setCountdown(5);
            // Fresh registrations wait for an admin to approve the account;
            // only already-approved dealers are signed in automatically.
            setPendingApproval((reg.data?.approved ?? 1) !== 1);
          }
        } catch {
          /* ignore — the submission itself succeeded */
        }
      }

      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message);
    }
  };

  return (
    <div
      className="min-h-screen bg-slate-100 flex items-center justify-center p-4 sm:p-6"
      style={{ background: `linear-gradient(135deg, ${form.header?.accentColor ?? '#6366F1'}22, #f1f5f9)` }}
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        {form.header && (
          <div className="relative">
            {form.header.image ? (
              <img
                src={form.header.image}
                alt={form.header.title}
                className="w-full h-36 sm:h-44 object-cover"
              />
            ) : (
              <div
                className="w-full h-36 sm:h-44"
                style={{
                  background: `linear-gradient(135deg, ${form.header.accentColor}99, ${form.header.accentColor})`,
                }}
              />
            )}
            {form.header.title && !form.header.hideTitle && (
              <div className="absolute inset-0 flex items-center justify-center text-center p-4">
                <span
                  className="text-white font-bold uppercase tracking-wider text-sm sm:text-base"
                  style={{
                    fontFamily: form.header.titleFont || undefined,
                    color: form.header.titleColor || undefined,
                  }}
                >
                  {form.header.title}
                </span>
              </div>
            )}
          </div>
        )}

        {status === 'success' ? (
          <div className="p-8 sm:p-10 text-center">
            <FaRegCircleCheck className="text-4xl text-emerald-500 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-slate-800">Thank you!</h2>
            <p className="text-sm text-slate-500 mt-1">Your submission has been received.</p>

            {dealer && (
              <div className="mt-6 text-left bg-slate-50 border border-slate-200 rounded-xl p-4">
                {pendingApproval ? (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2.5 text-xs mb-3">
                    <FaRegClock className="mt-0.5 flex-shrink-0" />
                    <span>
                      Your account is awaiting admin approval. You will receive an
                      email at <strong>{dealer.email}</strong> as soon as it is
                      approved — then you can log in with the password below.
                    </span>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-slate-800">
                    Your dealer account is ready
                  </p>
                )}
                {!pendingApproval && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    You are being signed in automatically. Keep these details — you can
                    view or change your password later under Account settings.
                  </p>
                )}
                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Email</span>
                    <span className="font-mono font-semibold text-slate-800 break-all text-right">
                      {dealer.email}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Password</span>
                    <span className="font-mono font-semibold text-slate-800 break-all text-right">
                      {dealer.password}
                    </span>
                  </div>
                </div>
                {!pendingApproval && (
                  <button
                    type="button"
                    onClick={() => void signInAndContinue()}
                    disabled={countdown > 0}
                    className="mt-4 w-full py-2.5 rounded-md text-sm font-medium transition disabled:opacity-60"
                    style={{
                      backgroundColor: form.header?.accentColor || '#2563EB',
                      color: '#FFFFFF',
                    }}
                  >
                    {countdown > 0
                      ? `Signing you in to the website in ${countdown}s…`
                      : 'Continue to your dashboard'}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 sm:p-6">
            <div className={form.columns === 2 ? 'grid grid-cols-2 gap-4' : ''}>
              {form.elements
                .filter((el) => el.type !== 'button')
                .map((el) => (
                  <div key={el.label} className={form.columns === 2 ? '' : 'mb-4'}>
                    {el.type !== 'checkbox' && el.type !== 'tnc' && (
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {el.label}
                        {el.required && <span className="text-rose-500">*</span>}
                      </label>
                    )}
                    {el.type === 'textarea' ? (
                      <>
                        <textarea
                          rows={3}
                          value={values[el.label] ?? ''}
                          onChange={(e) => updateValue(el.label, e.target.value)}
                          placeholder={el.placeholder || 'Enter response...'}
                          className={inputClass(el.label)}
                        />
                        {fieldErrors[el.label] && (
                          <p className="text-xs text-rose-600 mt-1">{fieldErrors[el.label]}</p>
                        )}
                      </>
                    ) : el.type === 'single_dropdown' || el.type === 'multi_dropdown' || el.type === 'select' ? (
                      <>
                        <select
                          value={values[el.label] ?? ''}
                          onChange={(e) => updateValue(el.label, e.target.value)}
                          className={inputClass(el.label)}
                        >
                          <option value="">{el.placeholder || 'Select an option'}</option>
                          {optionsFor(el).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                        {fieldErrors[el.label] && (
                          <p className="text-xs text-rose-600 mt-1">{fieldErrors[el.label]}</p>
                        )}
                      </>
                    ) : el.type === 'local_dropdown' ? (
                      <>
                        <LocalDropdownRowsField
                          rows={el.rows ?? []}
                          values={values}
                          onChange={(key, value) => updateValue(key, value)}
                        />
                        {fieldErrors[el.label] && (
                          <p className="text-xs text-rose-600 mt-1">{fieldErrors[el.label]}</p>
                        )}
                      </>
                    ) : el.type === 'checkbox' ? (
                      <>
                        <div className="space-y-1.5">
                          {(el.options && el.options.length > 0 ? el.options : DEFAULT_OPTIONS).map((o) => (
                            <label key={o} className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                value={o}
                                onChange={() => updateValue(el.label, o)}
                                className="rounded border-slate-300 text-blue-600"
                              />
                              <span className="text-sm text-slate-600 leading-tight">{o}</span>
                            </label>
                          ))}
                        </div>
                        {fieldErrors[el.label] && (
                          <p className="text-xs text-rose-600 mt-1">{fieldErrors[el.label]}</p>
                        )}
                      </>
                    ) : el.type === 'radio' ? (
                      <>
                        <div className="space-y-1.5">
                          {(el.options && el.options.length > 0 ? el.options : DEFAULT_OPTIONS).map((o) => (
                            <label key={o} className="flex items-center space-x-2">
                              <input
                                type="radio"
                                name={el.label}
                                value={o}
                                onChange={() => updateValue(el.label, o)}
                                className="text-blue-600"
                              />
                              <span className="text-sm text-slate-600">{o}</span>
                            </label>
                          ))}
                        </div>
                        {fieldErrors[el.label] && (
                          <p className="text-xs text-rose-600 mt-1">{fieldErrors[el.label]}</p>
                        )}
                      </>
                    ) : el.type === 'date' || el.type === 'date_picker' ? (
                      <div>
                        <div className="relative">
                          <input
                            type="date"
                            value={values[el.label] ?? ''}
                            onChange={(e) => updateValue(el.label, e.target.value)}
                            className={`${inputClass(el.label)} pl-9`}
                          />
                          <FaRegCalendar className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none" />
                        </div>
                        {fieldErrors[el.label] && (
                          <p className="text-xs text-rose-600 mt-1">{fieldErrors[el.label]}</p>
                        )}
                      </div>
                    ) : TEXT_LIKE.includes(el.type) ? (
                      <>
                        <input
                          type={el.type === 'email' ? 'email' : el.type === 'phone' ? 'tel' : 'text'}
                          value={values[el.label] ?? ''}
                          onChange={(e) => updateValue(el.label, e.target.value)}
                          placeholder={el.placeholder || 'Enter response...'}
                          className={inputClass(el.label)}
                        />
                        {fieldErrors[el.label] && (
                          <p className="text-xs text-rose-600 mt-1">{fieldErrors[el.label]}</p>
                        )}
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={values[el.label] ?? ''}
                          onChange={(e) => updateValue(el.label, e.target.value)}
                          placeholder={el.placeholder || 'Enter response...'}
                          className={inputClass(el.label)}
                        />
                        {fieldErrors[el.label] && (
                          <p className="text-xs text-rose-600 mt-1">{fieldErrors[el.label]}</p>
                        )}
                      </>
                    )}
                  </div>
                ))}
            </div>

            {status === 'error' && (
              <p className="text-xs text-rose-600 mt-2">{errorMsg || 'Something went wrong. Please try again.'}</p>
            )}

            {(() => {
              const buttons = form.elements.filter((el) => el.type === 'button');
              if (buttons.length > 0) {
                return buttons.map((el) => (
                  <button
                    key={el.label}
                    type="submit"
                    disabled={status === 'submitting'}
                    className="w-full mt-4 disabled:opacity-60 font-medium py-2.5 rounded-md text-sm transition"
                    style={{
                      backgroundColor: el.buttonColor || '#2563EB',
                      color: el.buttonTextColor || '#FFFFFF',
                    }}
                  >
                    {status === 'submitting' ? 'Submitting...' : el.label}
                  </button>
                ));
              }
              return (
                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  className="w-full mt-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-md text-sm transition"
                >
                  {status === 'submitting' ? 'Submitting...' : 'Submit'}
                </button>
              );
            })()}
          </form>
        )}
      </div>
    </div>
  );
}
