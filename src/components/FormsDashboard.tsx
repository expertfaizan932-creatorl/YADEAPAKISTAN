import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { logActivity } from '../data/activityLog';
import { useCampaigns } from '../data/campaigns';
import { api, type Appointment } from '../api';
import { useForms, type StoredForm } from '../data/formsStore';
import {
  fileToDataUrl,
  serializeFormForUrl,
  formatDbDate,
  initialsFromName,
  publicPayloadWithHostedImage,
} from '../utils';
import TemplateLibrary, {
  type FormTemplate,
  handleImageError,
  saveTemplateToLibrary,
} from './TemplateLibrary';
import GeneralSettingsAccordion, {
  type GeneralSettingsState,
  type LabelAlignment,
} from './GeneralSettingsAccordion';
import LocalDropdownSettings, {
  type LocalDropdownRow,
  LocalDropdownRowsField,
  defaultLocalRow,
  childOptionsFor,
} from './LocalDropdownSettings';
import { useAuth } from '../auth';
import UserMenu from './UserMenu';
import NotificationsBell from './NotificationsBell';
import {
  FaAlignLeft,
  FaArrowDown,
  FaArrowLeft,
  FaArrowUp,
  FaArrowUpFromBracket,
  FaBarsStaggered,
  FaBox,
  FaBuilding,
  FaBullhorn,
  FaCalendarCheck,
  FaCaretDown,
  FaCarSide,
  FaChartLine,
  FaChevronDown,
  FaCircleCheck,
  FaCloudArrowDown,
  FaCloudArrowUp,
  FaCode,
  FaCopy,
  FaDatabase,
  FaDesktop,
  FaDollarSign,
  FaDownload,
  FaEllipsisVertical,
  FaFileContract,
  FaFileInvoiceDollar,
  FaFolderPlus,
  FaFilter,
  FaFont,
  FaGear,
  FaGlobe,
  FaGripVertical,
  FaHandPointer,
  FaHashtag,
  FaICursor,
  FaLandmark,
  FaListCheck,
  FaListUl,
  FaLink,
  FaLock,
  FaLocationDot,
  FaMagnifyingGlass,
  FaMessage,
  FaMobileScreenButton,
  FaPen,
  FaPhone,
  FaPlus,
  FaRectangleAd,
  FaRegAddressCard,
  FaRegCalendar,
  FaRegCalendarDays,
  FaRegCircleDot,
  FaRegCircleQuestion,
  FaRegClock,
  FaRegCreditCard,
  FaRegEnvelope,
  FaRegEye,
  FaRegFlag,
  FaRegFloppyDisk,
  FaRegFolder,
  FaRegFolderOpen,
  FaRegImage,
  FaRegSquareCheck,
  FaRegTrashCan,
  FaRegUser,
  FaRotate,
  FaRotateLeft,
  FaRotateRight,
  FaShieldHalved,
  FaSignature,
  FaSitemap,
  FaShareNodes,
  FaSliders,
  FaStarHalfStroke,
  FaUserPlus,
  FaWandMagicSparkles,
  FaWhatsapp,
  FaWindowMaximize,
  FaXmark,
} from 'react-icons/fa6';

type View = 'dashboard' | 'editor';
type EditorTab = 'Edit' | 'Settings' | 'Submissions' | 'Notifications';
type DashboardTab = 'all' | 'analytics' | 'submissions';

interface FormElement {
  id: number;
  label: string;
  type: string;
  placeholder?: string;
  required: boolean;
  shortLabel?: string;
  queryKey?: string;
  fieldWidth: number;
  widthUnit: '%' | 'px';
  isHidden: boolean;
  labelAlignment: {
    desktop: LabelAlignment;
    mobile: LabelAlignment;
  };
  options?: string[];
  /** Local Dropdown rows (parent/child dropdown pairs), used when type is 'local_dropdown'. */
  rows?: LocalDropdownRow[];
  buttonColor?: string;
  buttonTextColor?: string;
}

interface FormSubmission {
  id: number;
  submittedOn: string;
  values: Record<string, string>;
}

interface FormHeader {
  image: string;
  title: string;
  accentColor: string;
  titleFont?: string;
  titleColor?: string;
  hideTitle?: boolean;
}

interface Form {
  id: number;
  name: string;
  updatedOn: string;
  updatedBy: string;
  elements: FormElement[];
  submissions: FormSubmission[];
  header?: FormHeader;
  columns?: 1 | 2;
  campaignId?: number;
}

interface SubmissionColumn {
  key: string;
  label: string;
  locked: boolean;
  visible: boolean;
}

interface SubmissionRow {
  id: number;
  formName: string;
  submittedOn: string;
  contactId: number;
  /** Index of this entry inside the contact's custom_fields.form_submissions array. */
  subIndex: number;
  contactInitials: string;
  contactBg: string;
  fullName: string;
  email: string;
  phone: string;
  values: Record<string, string>;
}

interface ElementDef {
  key: string;
  label: string;
  type: string;
  icon: ReactNode;
  placeholder: string;
  buttonColor?: string;
}

interface ElementCategory {
  name: string;
  updated: boolean;
  items: ElementDef[];
}

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

const CHOICE_TYPES = ['single_dropdown', 'multi_dropdown', 'checkbox', 'radio', 'select'];

const DEFAULT_OPTIONS = ['Option 1', 'Option 2', 'Option 3'];

// Inline quick-edit on the canvas: which properties each field type exposes.
const INLINE_PLACEHOLDER_TYPES = [...TEXT_LIKE, 'textarea', 'single_dropdown', 'multi_dropdown', 'select', 'html'];
const INLINE_OPTION_TYPES = ['single_dropdown', 'multi_dropdown', 'checkbox', 'radio', 'select', 'textbox_list'];

const HEADER_FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Arial Black', value: '"Arial Black", Gadget, sans-serif' },
  { label: 'Book Antiqua', value: '"Book Antiqua", Georgia, serif' },
  { label: 'Calibri', value: 'Calibri, Candara, Segoe, sans-serif' },
  { label: 'Cambria', value: 'Cambria, Georgia, serif' },
  { label: 'Comic Sans', value: '"Comic Sans MS", cursive, sans-serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Impact', value: 'Impact, Charcoal, sans-serif' },
  { label: 'Montserrat', value: 'Montserrat, "Helvetica Neue", sans-serif' },
  { label: 'Poppins', value: 'Poppins, "Segoe UI", sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
];

/** Renders the form's banner/header (image + optional title text) in canvas and preview. */
function FormHeaderBlock({ header, compact }: { header: FormHeader | undefined; compact?: boolean }) {
  if (!header) return null;
  const showTitle = !!header.title && !header.hideTitle;
  const hasImage = !!header.image;
  return (
    <div className={`rounded-lg overflow-hidden border border-slate-200 relative shadow-sm ${compact ? 'mb-4' : 'mb-5'}`}>
      {hasImage ? (
        <img
          src={header.image}
          onError={(e) => handleImageError(e, header.title)}
          alt={header.title}
          loading="lazy"
          className={`w-full object-cover ${compact ? 'h-32' : 'h-36 sm:h-44'}`}
        />
      ) : (
        <div
          className={`w-full ${compact ? 'h-32' : 'h-36 sm:h-44'}`}
          style={{
            background: `linear-gradient(135deg, ${header.accentColor}99, ${header.accentColor})`,
          }}
        />
      )}
      {hasImage && <div className="absolute inset-0 bg-black/35" />}
      {showTitle && (
        <div className="absolute inset-0 flex items-center justify-center text-center p-4">
          <span
            className="text-white font-bold uppercase tracking-wider text-xs sm:text-sm"
            style={{
              fontFamily: header.titleFont || undefined,
              color: header.titleColor || undefined,
            }}
          >
            {header.title}
          </span>
        </div>
      )}
    </div>
  );
}

const DEFAULT_ALIGNMENT: { desktop: LabelAlignment; mobile: LabelAlignment } = {
  desktop: 'default',
  mobile: 'default',
};

function withGeneralSettings(el: Partial<FormElement> & Pick<FormElement, 'id' | 'label' | 'type'>, options?: string[]): FormElement {
  return {
    id: el.id,
    label: el.label,
    type: el.type,
    placeholder: el.placeholder,
    required: el.required ?? false,
    fieldWidth: 100,
    widthUnit: '%',
    isHidden: false,
    labelAlignment: { ...DEFAULT_ALIGNMENT },
    shortLabel: el.label,
    queryKey: '',
    buttonColor: el.type === 'button' ? (el.buttonColor ?? '#2563EB') : undefined,
    buttonTextColor: el.type === 'button' ? (el.buttonTextColor ?? '#FFFFFF') : undefined,
    ...(options !== undefined ? { options } : {}),
  };
}

function toGeneralSettings(el: FormElement): GeneralSettingsState {
  return {
    label: el.label,
    labelAlignment: el.labelAlignment
      ? { desktop: el.labelAlignment.desktop, mobile: el.labelAlignment.mobile }
      : { ...DEFAULT_ALIGNMENT },
    placeholder: el.placeholder ?? '',
    shortLabel: el.shortLabel ?? el.label,
    queryKey: el.queryKey ?? '',
    fieldWidth: el.fieldWidth ?? 100,
    widthUnit: el.widthUnit ?? '%',
    isRequired: el.required,
    isHidden: el.isHidden ?? false,
    options: el.options ? [...el.options] : undefined,
    buttonColor: el.buttonColor,
    buttonTextColor: el.buttonTextColor,
  };
}

const elementCategories: ElementCategory[] = [
  {
    name: 'Personal Info',
    updated: false,
    items: [
      { key: 'full_name', label: 'Full Name', type: 'text', icon: <FaRegAddressCard className="text-sm sm:text-base" />, placeholder: 'Enter full name' },
      { key: 'first_name', label: 'First Name', type: 'text', icon: <FaRegAddressCard className="text-sm sm:text-base" />, placeholder: 'Enter first name' },
      { key: 'last_name', label: 'Last Name', type: 'text', icon: <FaRegAddressCard className="text-sm sm:text-base" />, placeholder: 'Enter last name' },
      { key: 'dob', label: 'Date of birth', type: 'date', icon: <FaRegCalendarDays className="text-sm sm:text-base" />, placeholder: 'MM/DD/YYYY' },
      { key: 'phone', label: 'Phone', type: 'phone', icon: <FaPhone className="text-sm sm:text-base" />, placeholder: '+1 (555) 000-0000' },
      { key: 'email', label: 'Email', type: 'email', icon: <FaRegEnvelope className="text-sm sm:text-base" />, placeholder: 'your@email.com' },
    ],
  },
  {
    name: 'Submit',
    updated: false,
    items: [
      { key: 'submit', label: 'Submit', type: 'button', icon: <FaRectangleAd className="text-sm sm:text-base" />, placeholder: 'Submit', buttonColor: '#2563EB' },
      { key: 'register_now', label: 'Register Now', type: 'button', icon: <FaRectangleAd className="text-sm sm:text-base" />, placeholder: 'Register Now', buttonColor: '#2563EB' },
      { key: 'call_now', label: 'Call Now', type: 'button', icon: <FaPhone className="text-sm sm:text-base" />, placeholder: 'Call Now', buttonColor: '#059669' },
      { key: 'book_now', label: 'Book Now', type: 'button', icon: <FaCalendarCheck className="text-sm sm:text-base" />, placeholder: 'Book Now', buttonColor: '#2563EB' },
      { key: 'contact_us', label: 'Contact Us', type: 'button', icon: <FaMessage className="text-sm sm:text-base" />, placeholder: 'Contact Us', buttonColor: '#2563EB' },
      { key: 'get_quote', label: 'Get a Quote', type: 'button', icon: <FaFileInvoiceDollar className="text-sm sm:text-base" />, placeholder: 'Get a Quote', buttonColor: '#2563EB' },
    ],
  },
  {
    name: 'Payments',
    updated: false,
    items: [
      { key: 'sell_products', label: 'Sell Products', type: 'sell_products', icon: <FaBox className="text-sm sm:text-base" />, placeholder: 'Select Product' },
      { key: 'collect_payment', label: 'Collect Payment', type: 'collect_payment', icon: <FaRegCreditCard className="text-sm sm:text-base" />, placeholder: 'Card Details' },
    ],
  },
  {
    name: 'Address',
    updated: true,
    items: [
      { key: 'address', label: 'Address', type: 'address', icon: <FaLocationDot className="text-sm sm:text-base" />, placeholder: 'Street address' },
      { key: 'city', label: 'City', type: 'city', icon: <FaBuilding className="text-sm sm:text-base" />, placeholder: 'City' },
      { key: 'state', label: 'State', type: 'state', icon: <FaLandmark className="text-sm sm:text-base" />, placeholder: 'State/Province' },
      { key: 'country', label: 'Country', type: 'country', icon: <FaGlobe className="text-sm sm:text-base" />, placeholder: 'Country' },
      { key: 'postal_code', label: 'Postal Code', type: 'postal_code', icon: <FaHashtag className="text-sm sm:text-base" />, placeholder: 'Zip/Postal code' },
      { key: 'organization', label: 'Organization', type: 'organization', icon: <FaSitemap className="text-sm sm:text-base" />, placeholder: 'Company/Organization' },
      { key: 'website', label: 'Website', type: 'website', icon: <FaWindowMaximize className="text-sm sm:text-base" />, placeholder: 'https://example.com' },
    ],
  },
  {
    name: 'Text',
    updated: false,
    items: [
      { key: 'single_line', label: 'Single Line', type: 'text', icon: <FaICursor className="text-sm sm:text-base" />, placeholder: 'Single line text' },
      { key: 'multi_line', label: 'Multi Line', type: 'textarea', icon: <FaAlignLeft className="text-sm sm:text-base" />, placeholder: 'Multi line response...' },
      { key: 'textbox_list', label: 'Text Box List', type: 'textbox_list', icon: <FaListCheck className="text-sm sm:text-base" />, placeholder: '' },
    ],
  },
  {
    name: 'Choice Elements',
    updated: false,
    items: [
      { key: 'single_dropdown', label: 'Single Dropdown', type: 'single_dropdown', icon: <FaCaretDown className="text-sm sm:text-base" />, placeholder: 'Select option' },
      { key: 'multi_dropdown', label: 'Multi Dropdown', type: 'multi_dropdown', icon: <FaBarsStaggered className="text-sm sm:text-base" />, placeholder: 'Select options' },
      { key: 'local_dropdown', label: 'Local Dropdown', type: 'local_dropdown', icon: <FaLink className="text-sm sm:text-base" />, placeholder: 'Local Dropdown' },
      { key: 'checkbox', label: 'Checkbox', type: 'checkbox', icon: <FaRegSquareCheck className="text-sm sm:text-base" />, placeholder: '' },
      { key: 'radio', label: 'Radio', type: 'radio', icon: <FaRegCircleDot className="text-sm sm:text-base" />, placeholder: '' },
    ],
  },
  {
    name: 'Customized',
    updated: false,
    items: [
      { key: 'custom_text', label: 'Text', type: 'text', icon: <FaFont className="text-sm sm:text-base" />, placeholder: 'Heading text' },
      { key: 'html', label: 'Html', type: 'html', icon: <FaCode className="text-sm sm:text-base" />, placeholder: '<div>HTML Block</div>' },
      { key: 'bot_protection', label: 'Bot Protection', type: 'bot_protection', icon: <FaShieldHalved className="text-sm sm:text-base" />, placeholder: 'reCAPTCHA' },
      { key: 'source', label: 'Source', type: 'source', icon: <FaDatabase className="text-sm sm:text-base" />, placeholder: 'Lead Source' },
      { key: 'tnc', label: 'T & C', type: 'tnc', icon: <FaFileContract className="text-sm sm:text-base" />, placeholder: '' },
      { key: 'score', label: 'Score', type: 'score', icon: <FaStarHalfStroke className="text-sm sm:text-base" />, placeholder: 'Score' },
    ],
  },
  {
    name: 'Other Elements',
    updated: false,
    items: [
      { key: 'image', label: 'Image', type: 'image', icon: <FaRegImage className="text-sm sm:text-base" />, placeholder: '' },
      { key: 'file_upload', label: 'File Upload', type: 'file_upload', icon: <FaCloudArrowUp className="text-sm sm:text-base" />, placeholder: '' },
      { key: 'monetary', label: 'Monetary', type: 'monetary', icon: <FaDollarSign className="text-sm sm:text-base" />, placeholder: '0.00' },
      { key: 'number', label: 'Number', type: 'number', icon: <FaHashtag className="text-sm sm:text-base" />, placeholder: '0' },
      { key: 'date_picker', label: 'Date Picker', type: 'date_picker', icon: <FaRegCalendar className="text-sm sm:text-base" />, placeholder: 'Select date' },
      { key: 'signature', label: 'Signature', type: 'signature', icon: <FaSignature className="text-sm sm:text-base" />, placeholder: '' },
    ],
  },
];

function formatDate(d: Date) {
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  );
}

type MetricKey = 'testDrives' | 'responses' | 'leads' | 'forms';
type AnalyticsPeriod = 'week' | 'month' | 'year';

interface MetricDef {
  key: MetricKey;
  label: string;
  icon: ReactNode;
  format: (v: number) => string;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const METRICS: MetricDef[] = [
  { key: 'testDrives', label: 'Test Drives', icon: <FaCarSide />, format: (v) => v.toLocaleString() },
  { key: 'responses', label: 'Responses', icon: <FaCircleCheck />, format: (v) => v.toLocaleString() },
  { key: 'leads', label: 'New Leads', icon: <FaUserPlus />, format: (v) => v.toLocaleString() },
  { key: 'forms', label: 'Forms Used', icon: <FaRegCalendarDays />, format: (v) => v.toLocaleString() },
];

function useCountUp(target: number, duration = 700) {
  const [value, setValue] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    if (from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const animated = useCountUp(value);
  return <>{format(animated)}</>;
}

const AUTO_DEALER_TEMPLATE: FormElement[] = [
  withGeneralSettings({ id: 1, label: 'Full Name', type: 'text', placeholder: 'Full Name', required: false }),
  withGeneralSettings({ id: 2, label: 'Phone', type: 'phone', placeholder: 'Phone', required: true }),
  withGeneralSettings({ id: 3, label: 'Email', type: 'email', placeholder: 'Email', required: true }),
  withGeneralSettings(
    {
      id: 4,
      label: 'Preferred Contact Method',
      type: 'single_dropdown',
      placeholder: 'Preferred Contact Method:',
      required: false,
    },
    ['Call', 'Email', 'SMS']
  ),
  withGeneralSettings(
    {
      id: 5,
      label: 'Are you looking for',
      type: 'single_dropdown',
      placeholder: 'Are you looking for:',
      required: false,
    },
    ['New Car', 'Used Car', 'Service', 'Parts']
  ),
  withGeneralSettings(
    {
      id: 6,
      label: 'Preferred Features (check all that apply)',
      type: 'multi_dropdown',
      placeholder: 'Preferred Features (check all that apply):',
      required: false,
    },
    ['Sunroof', 'Leather Seats', 'Navigation', 'Backup Camera']
  ),
  withGeneralSettings({
    id: 7,
    label: 'I Consent to Receive SMS Notifications',
    type: 'checkbox',
    placeholder: '',
    required: true,
    options: ['I Consent to Receive SMS Notifications'],
  }),
  withGeneralSettings({ id: 8, label: 'Contact Us Today', type: 'button', placeholder: 'Contact Us Today', required: false, buttonColor: '#2563EB', buttonTextColor: '#FFFFFF' }),
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Normalize the stored "YYYY-MM-DD" / "YYYY-MM-DD HH:MM:SS" / ISO timestamp into a Date. */
function parseStamp(t: string): Date | null {
  const value = String(t ?? '').trim();
  if (!value) return null;
  // Date-only value -> local midnight (avoids UTC timezone drift).
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const d = new Date(value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isTestDriveSubmission(sub: SubmissionRow): boolean {
  if (/test\s*(drive|ride)/i.test(sub.formName)) return true;
  return Object.values(sub.values ?? {}).some(
    (v) => typeof v === 'string' && /test\s*(drive|ride)/i.test(v)
  );
}

function isTestRideAppointment(a: Appointment): boolean {
  return (
    /test\s*(drive|ride)/i.test(String(a.title ?? '')) ||
    /test\s*ride/i.test(String(a.calendar ?? '')) ||
    /test\s*(drive|ride)/i.test(String(a.notes ?? ''))
  );
}

interface AnalyticsBucketRange {
  key: string;
  start: Date;
  end: Date;
  label: string;
}

/** Build the time buckets for the selected period (all local-time based). */
function analyticsRanges(period: AnalyticsPeriod): AnalyticsBucketRange[] {
  const today = startOfDay(new Date());
  const out: AnalyticsBucketRange[] = [];
  if (period === 'week') {
    for (let i = 6; i >= 0; i--) {
      const start = new Date(today);
      start.setDate(start.getDate() - i);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      out.push({ key: isoDate(start), start, end, label: DAY_LABELS[start.getDay()] });
    }
  } else if (period === 'month') {
    for (let w = 3; w >= 0; w--) {
      const start = new Date(today);
      start.setDate(start.getDate() - (w * 7 + 6));
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const labelDate = new Date(end);
      labelDate.setDate(labelDate.getDate() - 1);
      out.push({
        key: isoDate(start),
        start,
        end,
        label: labelDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
      });
    }
  } else {
    for (let m = 11; m >= 0; m--) {
      const start = new Date(today.getFullYear(), today.getMonth() - m, 1);
      const end = new Date(today.getFullYear(), today.getMonth() - m + 1, 1);
      out.push({
        key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
        start,
        end,
        label: start.toLocaleDateString('en-US', { month: 'short' }),
      });
    }
  }
  return out;
}

/** Real analytics from actual form submissions + test-ride appointments. */
function buildAnalytics(
  submissions: SubmissionRow[],
  appointments: Appointment[],
  forms: Form[],
  mode: 'all' | number,
  period: AnalyticsPeriod
) {
  const formName = mode === 'all' ? null : forms.find((f) => f.id === mode)?.name ?? null;
  const subs = formName === null ? submissions : submissions.filter((s) => s.formName === formName);

  const events: { date: Date; testDrive: boolean; contactId: number; form: string }[] = [];
  for (const s of subs) {
    const d = parseStamp(s.submittedOn);
    if (!d) continue;
    events.push({ date: d, testDrive: isTestDriveSubmission(s), contactId: s.contactId, form: s.formName });
  }
  // Test-ride bookings made through the CRM (no form) only count in "All Forms".
  if (formName === null) {
    for (const a of appointments ?? []) {
      if (!isTestRideAppointment(a)) continue;
      const d = parseStamp(String(a.date ?? ''));
      if (!d) continue;
      events.push({ date: d, testDrive: true, contactId: a.contact_id, form: '#appointments' });
    }
  }

  const ranges = analyticsRanges(period);
  const buckets: { label: string; values: Record<MetricKey, number> }[] = ranges.map((r) => {
    const inR = events.filter((e) => e.date >= r.start && e.date < r.end);
    return {
      label: r.label,
      values: {
        testDrives: inR.filter((e) => e.testDrive).length,
        responses: inR.length,
        leads: new Set(inR.map((e) => e.contactId)).size,
        forms: new Set(inR.filter((e) => e.form !== '#appointments').map((e) => e.form)).size,
      },
    };
  });

  const inPeriod = events.filter((e) => ranges.some((r) => e.date >= r.start && e.date < r.end));
  const totals: Record<MetricKey, number> = {
    testDrives: buckets.reduce((s, b) => s + b.values.testDrives, 0),
    responses: buckets.reduce((s, b) => s + b.values.responses, 0),
    leads: new Set(inPeriod.map((e) => e.contactId)).size,
    forms: new Set(inPeriod.filter((e) => e.form !== '#appointments').map((e) => e.form)).size,
  };

  return {
    totals,
    buckets,
    periodLabel:
      period === 'week' ? 'Last 7 days' : period === 'month' ? 'Last 4 weeks' : 'Last 12 months',
  };
}

function makeDefaultFields(): FormElement[] {
  const now = Date.now();
  return [
    withGeneralSettings({ id: now + 1, label: 'First Name', type: 'text', placeholder: 'Enter your first name', required: false }),
    withGeneralSettings({ id: now + 2, label: 'Last Name', type: 'text', placeholder: 'Enter your last name', required: false }),
    withGeneralSettings({ id: now + 3, label: 'Phone', type: 'phone', placeholder: '+1 (555) 000-0000', required: true }),
    withGeneralSettings({ id: now + 4, label: 'Email', type: 'email', placeholder: 'your@email.com', required: true }),
    withGeneralSettings({ id: now + 5, label: 'Submit', type: 'button', placeholder: 'Submit', required: false, buttonColor: '#2563EB', buttonTextColor: '#FFFFFF' }),
  ];
}

const SUBMISSION_COLUMNS: SubmissionColumn[] = [
  { key: 'formName', label: 'Form', locked: false, visible: true },
  { key: 'submittedAt', label: 'Submitted at', locked: true, visible: true },
  { key: 'contact', label: 'Contact', locked: false, visible: true },
  { key: 'fullName', label: 'Full name', locked: false, visible: true },
  { key: 'email', label: 'Email', locked: false, visible: true },
  { key: 'phone', label: 'Phone', locked: false, visible: true },
];

/** Friendly display label for a local_dropdown column. */
function localDropdownColumnLabel(elLabel: string, subLabel: string): string {
  const sub = subLabel.trim().replace(/^select\s+/i, '');
  if (sub.toLowerCase() === 'outlet') return elLabel;
  return `${elLabel} ${sub}`.trim();
}

/** Parse a stored value key like "Outlet · Select City" back into a friendly column label. */
function keyToDisplayLabel(key: string): string {
  const sep = key.lastIndexOf(' · ');
  if (sep <= 0) return key;
  return localDropdownColumnLabel(key.slice(0, sep), key.slice(sep + 3));
}

/** Expand local_dropdown elements into their individual parent/child value keys. */
function formValueKeys(elements: FormElement[]): { key: string; label: string }[] {
  const keys: { key: string; label: string }[] = [];
  for (const el of elements) {
    if (el.type === 'button') continue;
    if (el.type === 'local_dropdown') {
      for (const row of el.rows ?? []) {
        if (row.parentLabel) {
          const k = `${el.label} · ${row.parentLabel}`;
          if (!keys.some((x) => x.key === k))
            keys.push({ key: k, label: localDropdownColumnLabel(el.label, row.parentLabel) });
        }
        if (row.childLabel) {
          const k = `${el.label} · ${row.childLabel}`;
          if (!keys.some((x) => x.key === k))
            keys.push({ key: k, label: localDropdownColumnLabel(el.label, row.childLabel) });
        }
      }
      continue;
    }
    keys.push({ key: el.label, label: el.label });
  }
  return keys;
}

/** Fields already covered by the fixed identity columns — never duplicated as dynamic columns. */
const RESERVED_FIELD_RE =
  /^(form|submitted\s*at|submission\s*date|contact|full\s*name|name|email|phone)$/i;

/**
 * Build the submission table columns: fixed identity columns + the selected
 * form's own fields. "All Forms" keeps just the identity columns so the
 * combined view stays clean; picking a specific form shows only that form's
 * fields (incl. City/Outlet sub-fields) plus any value actually stored for it.
 */
function submissionColumnsFor(
  formName: string,
  registeredForms: StoredForm[],
  serverForms: Form[],
  rows: SubmissionRow[],
): SubmissionColumn[] {
  const fixed = SUBMISSION_COLUMNS.filter((c) =>
    ['formName', 'submittedAt', 'contact', 'fullName', 'email', 'phone'].includes(c.key)
  ).map((c) => ({ ...c }));

  if (formName === 'all') return fixed;

  const cols: { key: string; label: string }[] = [];
  const add = (key: string, label?: string) => {
    if (RESERVED_FIELD_RE.test(key)) return;
    if (cols.some((c) => c.key === key)) return;
    cols.push({ key, label: label ?? keyToDisplayLabel(key) });
  };

  // 1) Columns from the selected form's own definition (server forms carry
  //    full detail incl. local_dropdown sub-fields; stored forms bare labels).
  const server = serverForms.find((f) => f.name === formName);
  if (server) {
    for (const k of formValueKeys(server.elements)) add(k.key, k.label);
  } else {
    const f = registeredForms.find((x) => x.name === formName);
    for (const el of f?.elements ?? []) {
      if (el.type === 'button' || el.type === 'local_dropdown') continue;
      add(el.label);
    }
  }

  // 2) Any value actually stored for this form that the definition does not
  //    declare (guarantees the table always shows every submitted field).
  for (const r of rows) {
    if (r.formName !== formName) continue;
    for (const key of Object.keys(r.values)) add(key);
  }

  return [...fixed, ...cols.map((c) => ({ key: c.key, label: c.label, locked: false, visible: true }))];
}

function FieldRenderer({
  element,
  alignment,
  editable = false,
  onPatch,
  onAddOption,
  onEditOption,
  onRemoveOption,
  previewValues,
  onPreviewChange,
}: {
  element: FormElement;
  alignment?: LabelAlignment;
  editable?: boolean;
  onPatch?: (patch: Partial<FormElement>) => void;
  onAddOption?: () => void;
  onEditOption?: (index: number, value: string) => void;
  onRemoveOption?: (index: number) => void;
  // Live Local Dropdown preview: when provided, parent/child pairs render
  // interactive so the dependent-option cascade can be tested on the canvas.
  previewValues?: Record<number, Record<string, string>>;
  onPreviewChange?: (elId: number, key: string, value: string) => void;
}) {
  const t = element.type;
  const opts = element.options && element.options.length > 0 ? element.options : DEFAULT_OPTIONS;
  const isRow = alignment === 'left' || alignment === 'right';
  const isChoice = INLINE_OPTION_TYPES.includes(t);
  const canPlaceholder = INLINE_PLACEHOLDER_TYPES.includes(t);

  const labelInputCls =
    'w-full min-w-0 bg-transparent text-xs font-semibold text-slate-700 rounded px-1 -mx-1 focus:outline-none focus:bg-white focus:ring-1 focus:ring-blue-400 focus:border focus:border-blue-300';

  const labelText = (withRequired = true) => (
    <span className="inline-flex items-center gap-0.5 w-full">
      {editable ? (
        <input
          type="text"
          value={element.label}
          autoFocus
          onChange={(e) => onPatch?.({ label: e.target.value })}
          className={labelInputCls}
        />
      ) : (
        <span>{element.label}</span>
      )}
      {withRequired && element.required && <span className="text-rose-500 shrink-0">*</span>}
    </span>
  );

  const wrapLabel = (control: ReactNode) =>
    isRow ? (
      <div className={`flex items-start gap-3 ${alignment === 'right' ? 'flex-row-reverse' : ''}`}>
        <div className="flex-1 min-w-0">{control}</div>
        <div className={`pt-2 text-xs font-semibold text-slate-700 whitespace-nowrap ${editable ? 'w-40 shrink-0' : ''}`}>
          {labelText()}
        </div>
      </div>
    ) : (
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">{labelText()}</label>
        {control}
      </div>
    );

  const editInputCls =
    'w-full px-3 py-2 border border-slate-300 rounded-md text-xs bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

  const editOptionRow = (opt: string, idx: number) => (
    <div key={idx} className="flex items-center gap-1.5">
      <input
        type="text"
        value={opt}
        onChange={(e) => onEditOption?.(idx, e.target.value)}
        placeholder={`Option ${idx + 1}`}
        className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      />
      <button
        type="button"
        onClick={() => onRemoveOption?.(idx)}
        className="text-slate-400 hover:text-rose-500 p-1 transition shrink-0"
        title="Remove option"
      >
        <FaRegTrashCan className="w-3 h-3" />
      </button>
    </div>
  );

  // Options editor appears directly under dropdown / multi-dropdown / checkbox /
  // radio / textbox-list controls so options can be renamed / added / removed
  // right on the field, without the right-side drawer.
  const optionsEditor =
    editable && isChoice ? (
      <div className="mt-2 pt-2 border-t border-dashed border-blue-200 space-y-1.5">
        {canPlaceholder && (
          <input
            type="text"
            value={element.placeholder ?? ''}
            onChange={(e) => onPatch?.({ placeholder: e.target.value })}
            placeholder="Placeholder text (first option)"
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        )}
        {(element.options ?? []).map(editOptionRow)}
        {(element.options ?? []).length === 0 && (
          <div className="text-[10px] text-slate-400 bg-white border border-dashed border-slate-300 rounded px-2 py-1.5">
            No options yet. Click "Add option" to create choices.
          </div>
        )}
        <button
          type="button"
          onClick={onAddOption}
          className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium text-[10px] border border-blue-200 hover:bg-blue-50 rounded px-1.5 py-0.5 transition"
        >
          <FaPlus className="w-2 h-2" />
          Add option
        </button>
      </div>
    ) : null;

  let control: ReactNode = null;

  if (t === 'date') {
    // Birthday / Date of birth — real calendar picker with a calendar icon.
    control = editable ? (
      <div className="relative">
        <input
          type="text"
          value={element.placeholder ?? ''}
          onChange={(e) => onPatch?.({ placeholder: e.target.value })}
          placeholder="Enter placeholder text"
          className={`${editInputCls} pl-8`}
        />
        <FaRegCalendar className="absolute left-2.5 top-2 text-slate-400 text-xs pointer-events-none" />
      </div>
    ) : (
      <div className="relative">
        <input
          type="date"
          onChange={() => undefined}
          className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-md text-xs bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <FaRegCalendar className="absolute left-2.5 top-2 text-slate-400 text-xs pointer-events-none" />
      </div>
    );
  } else if (TEXT_LIKE.includes(t)) {
    control = editable ? (
      <input
        type="text"
        value={element.placeholder ?? ''}
        onChange={(e) => onPatch?.({ placeholder: e.target.value })}
        placeholder="Enter placeholder text"
        className={editInputCls}
      />
    ) : (
      <input
        type="text"
        placeholder={element.placeholder}
        disabled
        className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs bg-slate-50/50 text-slate-500 cursor-pointer"
      />
    );
  } else if (t === 'textarea') {
    control = editable ? (
      <textarea
        rows={3}
        value={element.placeholder ?? ''}
        onChange={(e) => onPatch?.({ placeholder: e.target.value })}
        placeholder="Enter placeholder text"
        className={editInputCls}
      />
    ) : (
      <textarea
        placeholder={element.placeholder}
        rows={3}
        disabled
        className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs bg-slate-50/50 text-slate-500 cursor-pointer"
      />
    );
  } else if (t === 'textbox_list') {
    control = (
      <div className="space-y-2">
        {opts.slice(0, 3).map((o, i) =>
          editable ? (
            <input
              key={i}
              type="text"
              value={element.options?.[i] ?? ''}
              onChange={(e) => onEditOption?.(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              className={editInputCls}
            />
          ) : (
            <input key={i} type="text" placeholder={o} disabled className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-slate-50/50" />
          )
        )}
      </div>
    );
  } else if (t === 'single_dropdown' || t === 'multi_dropdown' || t === 'select') {
    control = (
      <select
        disabled
        className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs bg-slate-50/50 text-slate-500 cursor-pointer"
      >
        <option>{element.placeholder || 'Select an option'}</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (t === 'local_dropdown') {
    const rows = element.rows ?? [];
    const rowValues = previewValues?.[element.id];
    const live = !editable && !!onPreviewChange && rows.length > 0;
    control = (
      <LocalDropdownRowsField
        rows={rows}
        values={rowValues}
        disabledChildren={!live}
        onChange={
          live
            ? (key, value) => {
                onPreviewChange?.(element.id, key, value);
              }
            : undefined
        }
      />
    );
  } else if (t === 'checkbox') {
    control = (
      <div className="space-y-1.5">
        {opts.map((o) => (
          <div key={o} className="flex items-center space-x-2 py-0.5">
            <input type="checkbox" disabled className="rounded border-slate-300 text-blue-600" />
            <span className="text-xs text-slate-600 leading-tight">{o}</span>
          </div>
        ))}
      </div>
    );
  } else if (t === 'radio') {
    control = (
      <div className="space-y-1.5">
        {opts.map((o) => (
          <div key={o} className="flex items-center space-x-2">
            <input type="radio" disabled name="radio-preview" className="text-blue-600" />
            <span className="text-xs text-slate-600">{o}</span>
          </div>
        ))}
      </div>
    );
  } else if (t === 'button') {
    control = (
      <button
        className="w-full font-medium py-2 rounded-md text-xs shadow-sm"
        style={{ backgroundColor: element.buttonColor || '#2563EB', color: element.buttonTextColor || '#FFFFFF' }}
      >
        {element.label}
      </button>
    );
  } else if (t === 'sell_products' || t === 'collect_payment') {
    control = (
      <div className="p-3 sm:p-4 border border-blue-200 bg-blue-50/40 rounded-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
          <div className="flex items-center space-x-2 text-blue-900 font-semibold text-xs">
            {t === 'sell_products' ? <FaBox /> : <FaRegCreditCard />}
            <span>{element.label}</span>
          </div>
          <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium self-start sm:self-auto">
            Stripe Integration
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mb-2 sm:mb-3">Product selection and checkout summary card will be displayed here.</p>
        <div className="bg-white p-2 sm:p-2.5 border border-slate-200 rounded text-xs flex justify-between items-center text-slate-600">
          <span>Sample Product A</span>
          <span className="font-semibold">$49.00</span>
        </div>
      </div>
    );
  } else if (t === 'html') {
    control = editable ? (
      <textarea
        rows={4}
        value={element.placeholder ?? ''}
        onChange={(e) => onPatch?.({ placeholder: e.target.value })}
        placeholder="<div>Custom HTML content goes here...</div>"
        className="w-full p-2.5 bg-slate-900 text-slate-200 font-mono text-[11px] rounded border border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    ) : (
      <div className="p-3 bg-slate-900 text-slate-200 font-mono text-[11px] rounded border border-slate-700">
        <div className="text-slate-400 text-[10px] uppercase font-sans mb-1">Custom HTML Block</div>
        <div className="break-all">{element.placeholder || '<div>Custom HTML content goes here...</div>'}</div>
      </div>
    );
  } else if (t === 'bot_protection') {
    control = (
      <div className="p-3 border border-slate-200 bg-slate-50 rounded flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <input type="checkbox" disabled className="w-5 h-5 border-slate-300 rounded" />
          <span className="text-xs font-medium text-slate-700">I'm not a robot</span>
        </div>
        <FaShieldHalved className="text-slate-400 text-lg" />
      </div>
    );
  } else if (t === 'tnc') {
    control = (
      <div className="p-3 border border-slate-200 bg-slate-50 rounded text-xs space-y-2">
        <div className="font-semibold text-slate-700">{element.label}</div>
        <p className="text-[11px] text-slate-500 leading-normal">
          By submitting this form, you acknowledge and agree to our terms and conditions and privacy policy.
        </p>
      </div>
    );
  } else if (t === 'image') {
    control = (
      <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center bg-slate-50">
        <FaRegImage className="text-2xl text-slate-400 mb-1 block mx-auto" />
        <span className="text-xs text-slate-500 font-medium">Image Placeholder</span>
      </div>
    );
  } else if (t === 'file_upload') {
    control = (
      <div className="border-2 border-dashed border-slate-300 rounded-md p-4 text-center bg-slate-50/50">
        <FaCloudArrowUp className="text-slate-400 text-xl mb-1 block mx-auto" />
        <span className="text-xs text-slate-500">Drag & drop files or click to upload</span>
      </div>
    );
  } else if (t === 'date_picker') {
    control = editable ? (
      <div className="relative">
        <input
          type="text"
          value={element.placeholder ?? ''}
          onChange={(e) => onPatch?.({ placeholder: e.target.value })}
          placeholder="Select date (placeholder)"
          className={`w-full pl-8 pr-3 py-2 border border-slate-300 rounded-md text-xs ${
            editable ? 'bg-white text-slate-700' : 'bg-slate-50/50'
          }`}
        />
        <FaRegCalendar className="absolute left-2.5 top-2.5 text-slate-400 text-xs pointer-events-none" />
      </div>
    ) : (
      // Preview mode: real calendar so a date can actually be picked.
      <div className="relative">
        <input
          type="date"
          onChange={() => undefined}
          className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-md text-xs bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <FaRegCalendar className="absolute left-2.5 top-2 text-slate-400 text-xs pointer-events-none" />
      </div>
    );
  } else if (t === 'signature') {
    control = (
      <div className="border border-slate-300 rounded-md h-20 sm:h-24 bg-slate-50 flex items-center justify-center text-slate-400 text-xs italic">
        Sign here
      </div>
    );
  }

  if (control === null) return null;

  const isLayoutOnly = ['sell_products', 'collect_payment', 'html', 'bot_protection', 'image'].includes(t);

  return (
    <div
      style={{
        width: element.widthUnit === 'px' ? `${element.fieldWidth}px` : `${element.fieldWidth}%`,
        userSelect: editable ? 'text' : undefined,
      }}
    >
      {isLayoutOnly ? (
        <div>
          {control}
          {optionsEditor}
        </div>
      ) : t === 'checkbox' || t === 'tnc' ? (
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">{labelText()}</label>
          {control}
          {optionsEditor}
        </div>
      ) : (
        <div>
          {wrapLabel(control)}
          {optionsEditor}
        </div>
      )}
    </div>
  );
}

/** Inline "Field Settings" quick-edit panel rendered directly under the
 * selected field on the canvas (matches the HighLevel inline editing mockup). */
function InlineFieldEditor({
  element,
  index,
  total,
  onPatch,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  onDone,
  onAddOption,
  onEditOption,
  onRemoveOption,
}: {
  element: FormElement;
  index: number;
  total: number;
  onPatch: (patch: Partial<FormElement>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDone: () => void;
  onAddOption: () => void;
  onEditOption: (index: number, value: string) => void;
  onRemoveOption: (index: number) => void;
}) {
  const isChoice = INLINE_OPTION_TYPES.includes(element.type);
  const canPlaceholder = INLINE_PLACEHOLDER_TYPES.includes(element.type);

  const fieldInputCls =
    'w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

  return (
    <div
      className="mt-2.5 bg-white border border-blue-200 shadow-lg rounded-lg p-3 text-xs space-y-3 cursor-default"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header: Field Settings + quick actions */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <span className="font-bold text-blue-600 flex items-center space-x-1.5">
          <FaSliders className="text-[11px]" />
          <span>Field Settings</span>
        </span>
        <div className="flex items-center space-x-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index <= 0}
            className="p-1 hover:bg-slate-100 text-slate-500 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
            title="Move Up"
          >
            <FaArrowUp className="text-[10px]" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index >= total - 1}
            className="p-1 hover:bg-slate-100 text-slate-500 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
            title="Move Down"
          >
            <FaArrowDown className="text-[10px]" />
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="p-1 hover:bg-slate-100 text-blue-600 rounded transition"
            title="Duplicate field"
          >
            <FaCopy className="text-[10px]" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1 hover:bg-rose-50 text-rose-500 rounded transition"
            title="Delete field"
          >
            <FaRegTrashCan className="text-[10px]" />
          </button>
        </div>
      </div>

      {/* Field Label + Placeholder inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Field Label</label>
          <input
            type="text"
            value={element.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            className={fieldInputCls}
          />
        </div>
        {canPlaceholder && (
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1">Placeholder Text</label>
            <input
              type="text"
              value={element.placeholder ?? ''}
              onChange={(e) => onPatch({ placeholder: e.target.value })}
              className={fieldInputCls}
            />
          </div>
        )}
      </div>

      {/* Button style editor */}
      {element.type === 'button' && (
        <div className="pt-2 border-t border-dashed border-blue-200">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Button Style</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Button Color</label>
              <input
                type="color"
                value={element.buttonColor || '#2563EB'}
                onChange={(e) => onPatch({ buttonColor: e.target.value })}
                className="w-full h-9 rounded border border-slate-300 bg-white cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Text Color</label>
              <input
                type="color"
                value={element.buttonTextColor || '#FFFFFF'}
                onChange={(e) => onPatch({ buttonTextColor: e.target.value })}
                className="w-full h-9 rounded border border-slate-300 bg-white cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* Options editor for choice types */}
      {isChoice && (
        <div className="pt-2 border-t border-dashed border-blue-200 space-y-1.5">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Options</div>
          {(element.options ?? []).map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="text"
                value={opt}
                onChange={(e) => onEditOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                className={fieldInputCls}
              />
              <button
                type="button"
                onClick={() => onRemoveOption(i)}
                className="text-slate-400 hover:text-rose-500 p-1 shrink-0 transition"
                title="Remove option"
              >
                <FaRegTrashCan className="w-3 h-3" />
              </button>
            </div>
          ))}
          {(element.options ?? []).length === 0 && (
            <div className="text-[10px] text-slate-400 bg-white border border-dashed border-slate-300 rounded px-2 py-1.5">
              No options yet. Click "Add option" to create choices.
            </div>
          )}
          <button
            type="button"
            onClick={onAddOption}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium text-[10px] border border-blue-200 hover:bg-blue-50 rounded px-1.5 py-0.5 transition"
          >
            <FaPlus className="w-2 h-2" />
            Add option
          </button>
        </div>
      )}

      {/* Required + Done */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <label className="flex items-center space-x-2 text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={element.required}
            onChange={(e) => onPatch({ required: e.target.checked })}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Required Field</span>
        </label>
        <button
          type="button"
          onClick={onDone}
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded font-semibold text-[11px] transition"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function FormsDashboard() {
  const { user, logout } = useAuth();
  const campaigns = useCampaigns();
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [showModal, setShowModal] = useState(false);
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false);
  const [selectedOption, setSelectedOption] = useState<'scratch' | 'template'>('scratch');
  const [searchQuery, setSearchQuery] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  const formCountRef = useRef(1);
  const headerImgRef = useRef<HTMLInputElement>(null);

  const [editorTab, setEditorTab] = useState<EditorTab>('Edit');
  const [sidebarTab, setSidebarTab] = useState<'quickAdd' | 'customFields'>('quickAdd');
  const [editorDevice, setEditorDevice] = useState<'desktop' | 'tablet'>('desktop');
  const [showElementDrawer, setShowElementDrawer] = useState(true);
  const [selectedElement, setSelectedElement] = useState<FormElement | null>(null);
  const [activeForm, setActiveForm] = useState<Form>({
    id: 1,
    name: 'Form 1',
    updatedOn: '',
    updatedBy: '',
    elements: [],
    submissions: [],
  });
  const [forms, setForms] = useState<Form[]>([]);
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('all');
  const [activeMetric, setActiveMetric] = useState<MetricKey>('testDrives');
  const [analyticsMode, setAnalyticsMode] = useState<'all' | number>('all');
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>('week');
  const [analyticsAppointments, setAnalyticsAppointments] = useState<Appointment[]>([]);

  const [draggedSidebarItem, setDraggedSidebarItem] = useState<ElementDef | null>(null);
  const [draggedCanvasIndex, setDraggedCanvasIndex] = useState<number | null>(null);
  const [isDraggingOverCanvas, setIsDraggingOverCanvas] = useState(false);

  // Live values chosen on the canvas for testing Local Dropdown pairs.
  // Keyed by element id -> `parent:<rowId>` / `child:<rowId>`.
  const [previewValues, setPreviewValues] = useState<Record<number, Record<string, string>>>({});

  const [openMenuFor, setOpenMenuFor] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // ---- Submissions tab state ----
  const [submissionFormFilter, setSubmissionFormFilter] = useState<string>('all');
  const [submissionSearch, setSubmissionSearch] = useState('');
  const [submissionStartDate, setSubmissionStartDate] = useState('');
  const [submissionEndDate, setSubmissionEndDate] = useState('');
  const [manageColsOpen, setManageColsOpen] = useState(false);
  const [tempCols, setTempCols] = useState<SubmissionColumn[]>([]);

  // ---- Share modal state ----
  const [shareModalForm, setShareModalForm] = useState<Form | null>(null);
  const [shareModalUrl, setShareModalUrl] = useState('');

  // ---- Move to folder modal state ----
  const [moveFolderForm, setMoveFolderForm] = useState<Form | null>(null);

  const [submissionCols, setSubmissionCols] = useState<SubmissionColumn[]>(() =>
    JSON.parse(JSON.stringify(SUBMISSION_COLUMNS))
  );

  const [submissionRows, setSubmissionRows] = useState<SubmissionRow[]>([]);
  const [submissionLoading, setSubmissionLoading] = useState(false);

  // Real analytics computed from actual submissions + test-ride appointments.
  const analytics = useMemo(
    () => buildAnalytics(submissionRows, analyticsAppointments, forms, analyticsMode, analyticsPeriod),
    [submissionRows, analyticsAppointments, forms, analyticsMode, analyticsPeriod]
  );

  // All appointments (used to count test-ride bookings in the analytics tab).
  const loadAppointments = useCallback(async () => {
    try {
      const res = await api.listAllAppointments();
      setAnalyticsAppointments(res.data ?? []);
    } catch {
      /* keep the last known appointments so the chart does not blank out */
    }
  }, []);

  // Forms that have at least one real submission (from the DB) power the filter
  // dropdown and the table columns.
  const registeredForms = useForms();

  // Merge server-persisted builder forms with submission-registered forms so
  // every created form appears in the filter dropdown and powers the columns.
  const allRegisteredForms = useMemo<StoredForm[]>(() => {
    const byName = new Map<string, StoredForm>();
    for (const f of registeredForms) {
      byName.set(f.name, {
        id: f.id,
        name: f.name,
        elements: f.elements.map((el) => ({ label: el.label, type: el.type })),
      });
    }
    for (const f of forms) {
      byName.set(f.name, {
        id: `form-${f.name}`,
        name: f.name,
        elements: f.elements.map((el) => ({ label: el.label, type: el.type })),
      });
    }
    return Array.from(byName.values());
  }, [registeredForms, forms]);

  // ---- Server persistence: load every saved builder form on mount ----
  useEffect(() => {
    let cancelled = false;
    api.listForms()
      .then((res) => {
        if (cancelled) return;
        const mapped: Form[] = res.data.map((row) => ({
          id: row.id,
          name: row.name,
          updatedOn: formatDbDate(row.updated_at) ?? '',
          updatedBy: row.updated_by ?? '',
          elements: (row.elements as unknown as FormElement[]) ?? [],
          submissions: [],
          header: (row.header as unknown as FormHeader) ?? undefined,
          columns: row.cols === 2 ? 2 : 1,
          campaignId: row.campaign_id ?? undefined,
        }));
        setForms(mapped);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /** Shape a Form for the API payload. */
  const formToInput = (f: Form) => ({
    name: f.name,
    updated_by: f.updatedBy,
    elements: f.elements,
    header: f.header ?? null,
    cols: f.columns ?? 1,
    campaign_id: f.campaignId ?? null,
  });

  /** Swap a temporary (negative) local id for the real database id. */
  const applyRealId = (tempId: number, realId: number) => {
    setForms((prev) => prev.map((f) => (f.id === tempId ? { ...f, id: realId } : f)));
    setActiveForm((prev) => (prev.id === tempId ? { ...prev, id: realId } : prev));
  };

  /** Insert a brand-new form into the database. */
  const persistNewForm = (form: Form) => {
    api.createForm(formToInput(form))
      .then((res) => applyRealId(form.id, res.data.id))
      .catch(() => triggerToast('Warning: form could not be saved to server'));
  };

  /** Save edits to an existing database row (creates it if missing). */
  const persistOnSave = (form: Form) => {
    if (form.id <= 0) {
      persistNewForm(form);
      return;
    }
    const input = formToInput(form);
    api.updateForm(form.id, input).catch(() => {
      api.createForm(input)
        .then((res) => applyRealId(form.id, res.data.id))
        .catch(() => triggerToast('Warning: form could not be saved to server'));
    });
  };

  const loadSubmissions = useCallback(async () => {
    setSubmissionLoading(true);
    try {
      const res = await api.listContacts({});
      const rows: SubmissionRow[] = [];
      for (const c of res.data) {
        // Read the raw stored array so subIndex always points at the real slot
        // inside custom_fields.form_submissions (used later to delete a row).
        const rawSubs = Array.isArray(c.custom_fields?.['form_submissions'])
          ? (c.custom_fields?.['form_submissions'] as unknown[])
          : [];
        rawSubs.forEach((entry, i) => {
          if (!entry || typeof entry !== 'object') return;
          const s = entry as { formName?: unknown; submittedOn?: unknown; values?: unknown };
          if (typeof s.formName !== 'string') return;
          rows.push({
            id: c.id * 1000 + i,
            formName: s.formName,
            submittedOn:
              typeof s.submittedOn === 'string' ? s.submittedOn : c.created_at ?? '',
            contactId: c.id,
            subIndex: i,
            contactInitials: initialsFromName(c.name),
            contactBg: 'bg-slate-200 text-slate-700',
            fullName: c.name,
            email: c.email ?? '',
            phone: c.phone ?? '',
            values: (s.values as Record<string, string>) ?? {},
          });
        });
      }
      rows.sort((a, b) => (a.submittedOn < b.submittedOn ? 1 : -1));
      setSubmissionRows(rows);
    } catch {
      triggerToast('Failed to load submissions');
    } finally {
      setSubmissionLoading(false);
    }
  }, []);

  /** Reload every dataset the analytics tab is derived from. */
  const refreshAnalytics = useCallback(async () => {
    await Promise.all([loadSubmissions(), loadAppointments()]);
  }, [loadSubmissions, loadAppointments]);

  useEffect(() => {
    refreshAnalytics();
  }, [refreshAnalytics]);

  // Submissions usually arrive from the public form in another tab, so nothing
  // notifies this page. Re-pull whenever the user comes back to this window.
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === 'visible') void refreshAnalytics();
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [refreshAnalytics]);

  // Rebuild the visible columns whenever the selected form changes.
  useEffect(() => {
    setSubmissionCols(submissionColumnsFor(submissionFormFilter, allRegisteredForms, forms, submissionRows));
  }, [submissionFormFilter, allRegisteredForms, forms, submissionRows]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuFor(null);
        setMenuPos(null);
      }
    };
    const closeOnScrollOrResize = () => {
      setOpenMenuFor(null);
      setMenuPos(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeOnScrollOrResize, true);
    window.addEventListener('resize', closeOnScrollOrResize);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeOnScrollOrResize, true);
      window.removeEventListener('resize', closeOnScrollOrResize);
    };
  }, []);

  useEffect(() => {
    if (!selectedElement) return;
    setActiveForm((prev) => ({
      ...prev,
      elements: prev.elements.map((el) => (el.id === selectedElement.id ? selectedElement : el)),
    }));
  }, [selectedElement]);

  const filteredForms = searchQuery.trim()
    ? forms.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : forms;

  const filteredSubmissions = submissionRows.filter((sub) => {
    const formMatch = submissionFormFilter === 'all' || sub.formName === submissionFormFilter;
    if (!formMatch) return false;
    const q = submissionSearch.trim().toLowerCase();
    const hay = [sub.formName, sub.fullName, sub.email, sub.phone, ...Object.values(sub.values)]
      .join(' ')
      .toLowerCase();
    const searchMatch = !q || hay.includes(q);
    if (!searchMatch) return false;
    const parseDate = (t: string) => {
      const m = t.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
      if (!m) return null;
      return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    };
    const s = parseDate(submissionStartDate);
    const e = parseDate(submissionEndDate);
    if (!s && !e) return true;
    const d = new Date(sub.submittedOn);
    if (s && d < s) return false;
    if (e) {
      const endOfDay = new Date(e);
      endOfDay.setHours(23, 59, 59, 999);
      if (d > endOfDay) return false;
    }
    return true;
  });

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setShowToast(false), 3000);
  };

  const openModal = () => {
    setSelectedOption('scratch');
    setShowModal(true);
  };

  const closeModal = () => setShowModal(false);

  const handleHeaderImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    fileToDataUrl(file)
      .then((data) =>
        setActiveForm((prev) =>
          prev.header ? { ...prev, header: { ...prev.header, image: data } } : prev
        )
      )
      .catch(() => undefined);
    e.target.value = '';
  };

  const createForm = () => {
    // Negative ids are temporary locals; the real id comes from the database.
    const newId = -(formCountRef.current++);
    const isTemplate = selectedOption === 'template';
    const templateElements = isTemplate
      ? AUTO_DEALER_TEMPLATE.map((el) => ({ ...el, id: Date.now() + Math.random() }))
      : [];
    const formName = isTemplate ? 'Auto Dealer Contact Us' : `Form ${newId}`;
    const newFormObj: Form = {
      id: newId,
      name: formName,
      updatedOn: formatDate(new Date()),
      updatedBy: 'Asad B Zaman',
      elements: isTemplate ? templateElements : makeDefaultFields(),
      submissions: [],
    };
    setForms((prev) => [newFormObj, ...prev]);
    closeModal();
    openEditorWithForm(newFormObj);
    triggerToast(isTemplate ? `Created "${formName}" from Template!` : `Created "${formName}"!`);
    logActivity({ type: 'form', title: 'Form created', detail: formName });
    persistNewForm(newFormObj);
  };

  const openTemplateLibrary = () => {
    setShowModal(false);
    setSelectedOption('template');
    setShowTemplateLibrary(true);
  };

  const createFormFromTemplate = (template: FormTemplate) => {
    const newId = -(formCountRef.current++);
    const elements: FormElement[] = template.elements.map((el) =>
      withGeneralSettings(
        {
          id: Date.now() + Math.random(),
          label: el.label,
          type: el.type,
          placeholder: el.placeholder,
          required: el.required,
        },
        CHOICE_TYPES.includes(el.type) ? DEFAULT_OPTIONS : undefined
      )
    );
    const newFormObj: Form = {
      id: newId,
      name: template.title,
      updatedOn: formatDate(new Date()),
      updatedBy: 'Asad B Zaman',
      elements,
      submissions: [],
      columns: template.columns ?? 1,
      header: {
        image: template.image,
        title: template.headerText,
        accentColor: template.accentColor,
        titleFont: template.headerFont,
        titleColor: template.headerColor,
      },
    };
    setForms((prev) => [newFormObj, ...prev]);
    setShowTemplateLibrary(false);
    openEditorWithForm(newFormObj);
    triggerToast(`Created "${template.title}" from Template!`);
    logActivity({ type: 'form', title: 'Form created', detail: template.title });
    persistNewForm(newFormObj);
  };

  const openEditorWithForm = (form: Form) => {
    setActiveForm(JSON.parse(JSON.stringify(form)));
    setSelectedElement(null);
    setCurrentView('editor');
  };

  const backToDashboard = () => setCurrentView('dashboard');

  const saveFormInEditor = () => {
    const savedForm: Form = JSON.parse(JSON.stringify({ ...activeForm, updatedOn: formatDate(new Date()) }));
    setForms((prev) => {
      const idx = prev.findIndex((f) => f.id === activeForm.id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = savedForm;
      return next;
    });
    persistOnSave(savedForm);

    const h = activeForm.header;
    const template: FormTemplate = {
      id: `user-${activeForm.id}`,
      title: activeForm.name,
      category: 'My Forms',
      color: 'indigo',
      colorHex: h?.accentColor ?? '#6366F1',
      trending: false,
      recentlyAdded: true,
      rating: 'New',
      popularity: 0,
      createdAt: new Date().toISOString(),
      isFavorite: false,
      isMine: true,
      image: h?.image ?? '',
      accentColor: h?.accentColor ?? '#6366F1',
      headerText: h?.title ?? activeForm.name,
      headerFont: h?.titleFont,
      headerColor: h?.titleColor,
      columns: activeForm.columns,
      elements: activeForm.elements
        .filter((el) => !el.isHidden)
        .map((el) => ({
          label: el.label,
          type: el.type,
          placeholder: el.placeholder,
          required: el.required,
        })),
    };
    saveTemplateToLibrary(template);
    triggerToast(`Saved "${activeForm.name}" successfully!`);
  };

  const addElementToCanvas = (item: ElementDef) => {
    const newEl = withGeneralSettings(
      {
        id: Date.now() + Math.random(),
        label: item.label,
        type: item.type,
        placeholder: item.placeholder,
        required: false,
        buttonColor: item.buttonColor,
      },
      CHOICE_TYPES.includes(item.type) ? DEFAULT_OPTIONS : undefined
    );
    if (item.type === 'local_dropdown') newEl.rows = [defaultLocalRow()];
    setActiveForm((prev) => ({ ...prev, elements: [...prev.elements, newEl] }));
    setSelectedElement(newEl);
    triggerToast(`Added ${item.label} field`);
  };

  const removeElement = (id: number) => {
    setActiveForm((prev) => ({
      ...prev,
      elements: prev.elements.filter((e) => e.id !== id),
    }));
    if (selectedElement && selectedElement.id === id) setSelectedElement(null);
    setPreviewValues((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });
  };

  const moveElementUp = (index: number) => {
    setActiveForm((prev) => {
      if (index <= 0) return prev;
      const next = [...prev.elements];
      const [el] = next.splice(index, 1);
      next.splice(index - 1, 0, el);
      return { ...prev, elements: next };
    });
  };

  const moveElementDown = (index: number) => {
    setActiveForm((prev) => {
      if (index >= prev.elements.length - 1) return prev;
      const next = [...prev.elements];
      const [el] = next.splice(index, 1);
      next.splice(index + 1, 0, el);
      return { ...prev, elements: next };
    });
  };

  const insertElementAt = (item: ElementDef, targetIndex: number) => {
    const newEl = withGeneralSettings(
      {
        id: Date.now() + Math.random(),
        label: item.label,
        type: item.type,
        placeholder: item.placeholder,
        required: false,
        buttonColor: item.buttonColor,
      },
      CHOICE_TYPES.includes(item.type) ? DEFAULT_OPTIONS : undefined
    );
    if (item.type === 'local_dropdown') newEl.rows = [defaultLocalRow()];
    setActiveForm((prev) => {
      const next = [...prev.elements];
      next.splice(targetIndex, 0, newEl);
      return { ...prev, elements: next };
    });
    setSelectedElement(newEl);
    triggerToast(`Inserted ${newEl.label}`);
  };

  const handleSidebarDragStart = (e: React.DragEvent, item: ElementDef) => {
    setDraggedSidebarItem(item);
    setDraggedCanvasIndex(null);
    e.dataTransfer.setData('text/plain', JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleCanvasDragOver = (e: React.DragEvent) => {
    setIsDraggingOverCanvas(true);
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleCanvasDragLeave = () => setIsDraggingOverCanvas(false);

  const handleCanvasDrop = () => {
    setIsDraggingOverCanvas(false);
    if (draggedSidebarItem) {
      addElementToCanvas(draggedSidebarItem);
      setDraggedSidebarItem(null);
    }
  };

  const handleElementDragStart = (e: React.DragEvent, index: number) => {
    setDraggedCanvasIndex(index);
    setDraggedSidebarItem(null);
    e.dataTransfer.setData('text/plain', index.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleElementDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleElementDrop = (e: React.DragEvent, targetIndex: number) => {
    e.stopPropagation();
    if (draggedSidebarItem) {
      insertElementAt(draggedSidebarItem, targetIndex);
      setDraggedSidebarItem(null);
    } else if (draggedCanvasIndex !== null && draggedCanvasIndex !== targetIndex) {
      setActiveForm((prev) => {
        const next = [...prev.elements];
        const [movedEl] = next.splice(draggedCanvasIndex, 1);
        next.splice(targetIndex, 0, movedEl);
        return { ...prev, elements: next };
      });
      setDraggedCanvasIndex(null);
    }
  };

  // ---- Inline quick-edit (on the canvas field itself) ----
  const patchSelectedElement = (patch: Partial<FormElement>) => {
    setSelectedElement((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  /** Canvas live-preview for Local Dropdown parent/child pairs. Keyed by `kind:rowId`. */
  const handlePreviewValueChange = (elId: number, key: string, value: string) => {
    setPreviewValues((prev) => {
      const next = { ...prev };
      next[elId] = next[elId] ?? {};
      const el = activeForm.elements.find((e) => e.id === elId);
      const rowId = Number(key.split(':')[1]);
      const row = el?.rows?.find((r) => r.id === rowId);
      if (key.startsWith('parent:')) {
        // Parent changed: drop a stale child value that's no longer in the mapped options.
        next[elId]['parent:' + rowId] = value;
        const childKey = 'child:' + rowId;
        if (next[elId][childKey] && row) {
          const opts = childOptionsFor(row, value);
          if (!opts.includes(next[elId][childKey])) delete next[elId][childKey];
        }
      } else {
        next[elId][key] = value;
      }
      return next;
    });
  };

  const addInlineOption = () => {
    setSelectedElement((prev) =>
      prev
        ? { ...prev, options: [...(prev.options ?? []), `Option ${(prev.options?.length ?? 0) + 1}`] }
        : prev
    );
  };

  const updateInlineOption = (index: number, value: string) => {
    setSelectedElement((prev) => {
      if (!prev) return prev;
      const next = [...(prev.options ?? [])];
      next[index] = value;
      return { ...prev, options: next };
    });
  };

  const removeInlineOption = (index: number) => {
    setSelectedElement((prev) => {
      if (!prev) return prev;
      const next = [...(prev.options ?? [])];
      next.splice(index, 1);
      return { ...prev, options: next };
    });
  };

  const duplicateSelectedElement = () => {
    if (!selectedElement) return;
    const clone: FormElement = {
      ...selectedElement,
      id: Date.now() + Math.random(),
      label: `${selectedElement.label} (Copy)`,
      rows: selectedElement.rows
        ? selectedElement.rows.map((r) => ({
            ...r,
            id: Date.now() + Math.random(),
            rules: (r.rules ?? []).map((rul) => ({ ...rul, id: Date.now() + Math.random() })),
          }))
        : undefined,
    };
    setActiveForm((prev) => {
      const idx = prev.elements.findIndex((e) => e.id === selectedElement.id);
      if (idx === -1) return prev;
      const next = [...prev.elements];
      next.splice(idx + 1, 0, clone);
      return { ...prev, elements: next };
    });
    setSelectedElement(clone);
    triggerToast(`Duplicated "${selectedElement.label}"`);
  };

  const publicFormPayload = () => ({
    name: activeForm.name,
    columns: activeForm.columns,
    campaignId: activeForm.campaignId,
    header: activeForm.header,
    elements: activeForm.elements
      .filter((el) => !el.isHidden)
      .map((el) => ({
        id: el.id,
        label: el.label,
        type: el.type,
        required: el.required,
        placeholder: el.placeholder,
        options: el.options,
        rows: el.rows,
        buttonColor: el.type === 'button' ? el.buttonColor : undefined,
        buttonTextColor: el.type === 'button' ? el.buttonTextColor : undefined,
      })),
  });

  /** Short share link (#/f/{id}) for a saved form. */
  const shortShareUrl = (form: { id?: number }) =>
    form.id ? `${window.location.origin}${window.location.pathname}#/f/${form.id}` : '';

  /** Legacy inline-payload URL, kept only as fallback for unsaved drafts. */
  const legacyTokenUrl = async () => {
    const payload = await publicPayloadWithHostedImage(publicFormPayload());
    const token = serializeFormForUrl(payload);
    return `${window.location.origin}${window.location.pathname}#/form/${token}`;
  };

  const publicFormUrl = async () => {
    if (activeForm?.id) return shortShareUrl(activeForm);
    return legacyTokenUrl();
  };

  const openPublicPreview = async () => {
    window.open(await publicFormUrl(), '_blank', 'noopener,noreferrer');
  };

  const sharePublicLink = async () => {
    const url = await publicFormUrl();
    try {
      await navigator.clipboard.writeText(url);
      triggerToast('Public form link copied!');
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const openFormPreview = async (form: Form) => {
    const url = shortShareUrl(form) || (await (async () => {
      const token = serializeFormForUrl(await publicPayloadWithHostedImage({
        name: form.name,
        columns: form.columns,
        campaignId: form.campaignId,
        header: form.header,
        elements: form.elements
          .filter((el) => !el.isHidden)
          .map((el) => ({
            id: el.id,
            label: el.label,
            type: el.type,
            required: el.required,
            placeholder: el.placeholder,
            options: el.options,
            rows: el.rows,
            buttonColor: el.type === 'button' ? el.buttonColor : undefined,
            buttonTextColor: el.type === 'button' ? el.buttonTextColor : undefined,
          })),
      }));
      return `${window.location.origin}${window.location.pathname}#/form/${token}`;
    })());
    window.open(url, '_blank', 'noopener,noreferrer');
    setOpenMenuFor(null);
    setMenuPos(null);
  };

  const openRowMenu = (e: React.MouseEvent, formId: number) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (openMenuFor === formId) {
      setOpenMenuFor(null);
      setMenuPos(null);
      return;
    }
    setMenuPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - 224) });
    setOpenMenuFor(formId);
  };

  const duplicateForm = (form: Form) => {
    const newId = -(formCountRef.current++);
    const copy: Form = {
      ...JSON.parse(JSON.stringify(form)),
      id: newId,
      name: `${form.name} (Copy)`,
      updatedOn: formatDate(new Date()),
      updatedBy: 'Asad B Zaman',
      submissions: [],
    };
    setForms((prev) => [copy, ...prev]);
    setOpenMenuFor(null);
    triggerToast(`Duplicated "${form.name}"!`);
    logActivity({ type: 'form', title: 'Form duplicated', detail: form.name });
    persistNewForm(copy);
  };

  const deleteForm = (id: number) => {
    const target = forms.find((f) => f.id === id);
    setForms((prev) => prev.filter((f) => f.id !== id));
    if (id > 0) {
      api.deleteForm(id).catch(() => triggerToast('Warning: form could not be deleted from server'));
    }
    triggerToast('Form deleted');
    logActivity({ type: 'delete', title: 'Form deleted', detail: target?.name });
  };

  // ---- Submissions helpers ----
  const renderSubmissionCell = (colKey: string, sub: SubmissionRow) => {
    switch (colKey) {
      case 'submittedAt':
        return <span className="text-slate-600 font-medium">{formatDbDate(sub.submittedOn) || '-'}</span>;
      case 'formName':
        return <span className="text-slate-600">{sub.formName}</span>;
      case 'contact':
        return (
          <span
            className={`w-7 h-7 rounded-full ${sub.contactBg} font-bold text-xs inline-flex items-center justify-center`}
          >
            {sub.contactInitials}
          </span>
        );
      case 'fullName':
        return <span className="font-semibold text-slate-800">{sub.fullName}</span>;
      case 'email':
        return sub.email ? (
          <a href={`mailto:${sub.email}`} className="hover:text-blue-600 flex items-center gap-1.5">
            <FaRegEnvelope className="text-slate-400" />
            <span>{sub.email}</span>
          </a>
        ) : (
          <span className="text-slate-300">-</span>
        );
      case 'phone':
        return sub.phone ? (
          <a href={`tel:${sub.phone}`} className="hover:text-blue-600 flex items-center gap-1.5">
            <FaPhone className="text-slate-400 text-[10px]" />
            <span>{sub.phone}</span>
          </a>
        ) : (
          <span className="text-slate-300">-</span>
        );
      default:
        return <span className="text-slate-600">{sub.values[colKey] || '-'}</span>;
    }
  };

  const exportSubmissionsCSV = () => {
    if (filteredSubmissions.length === 0) {
      triggerToast('No submissions to export');
      return;
    }
    const cols = submissionCols.filter((c) => c.visible).map((c) => c.label);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      cols.join(','),
      ...filteredSubmissions.map((sub) =>
        submissionCols
          .filter((c) => c.visible)
          .map((c) => {
            if (c.key === 'submittedAt') return esc(formatDbDate(sub.submittedOn) ?? '');
            if (c.key === 'formName') return esc(sub.formName);
            if (c.key === 'fullName') return esc(sub.fullName);
            if (c.key === 'email') return esc(sub.email);
            if (c.key === 'phone') return esc(sub.phone);
            if (c.key === 'contact') return esc(sub.contactInitials);
            return esc(sub.values[c.key]);
          })
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `submissions-${submissionFormFilter === 'all' ? 'all' : submissionFormFilter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    triggerToast('Submissions exported to CSV');
  };

  const refreshSubmissions = () => {
    loadSubmissions();
    triggerToast('Submissions list refreshed');
  };

  const toggleSelectAllSubmissions = (checked: boolean) => {
    const checkboxes = document.querySelectorAll('.sub-checkbox');
    checkboxes.forEach((cb) => {
      (cb as HTMLInputElement).checked = checked;
    });
  };

  /** Remove the given entries from their contacts' form_submissions array. */
  const deleteSubmissionEntries = async (
    entries: { contactId: number; subIndex: number }[]
  ) => {
    const byContact = new Map<number, number[]>();
    for (const e of entries) {
      const list = byContact.get(e.contactId) ?? [];
      list.push(e.subIndex);
      byContact.set(e.contactId, list);
    }
    for (const [contactId, indices] of byContact) {
      const res = await api.getContact(contactId);
      const cf: Record<string, unknown> = { ...(res.data.custom_fields ?? {}) };
      const raw = Array.isArray(cf['form_submissions'])
        ? [...(cf['form_submissions'] as unknown[])]
        : [];
      // Remove from the back so earlier indices stay valid.
      [...indices].sort((a, b) => b - a).forEach((i) => {
        if (i >= 0 && i < raw.length) raw.splice(i, 1);
      });
      cf['form_submissions'] = raw;
      await api.updateContact(contactId, { custom_fields: cf });
    }
  };

  const deleteOneSubmission = async (sub: SubmissionRow) => {
    const who = sub.fullName || sub.email || 'this contact';
    if (!window.confirm(`Delete this submission from ${who}?`)) return;
    try {
      await deleteSubmissionEntries([{ contactId: sub.contactId, subIndex: sub.subIndex }]);
      triggerToast('Submission deleted');
      await loadSubmissions();
    } catch (err) {
      triggerToast(`Delete failed: ${(err as Error).message}`);
    }
  };

  const deleteAllSubmissions = async () => {
    if (filteredSubmissions.length === 0) {
      triggerToast('No submissions to delete');
      return;
    }
    if (
      !window.confirm(
        `Delete all ${filteredSubmissions.length} submission(s) currently shown? This cannot be undone.`
      )
    )
      return;
    try {
      await deleteSubmissionEntries(
        filteredSubmissions.map((s) => ({ contactId: s.contactId, subIndex: s.subIndex }))
      );
      triggerToast('Submissions deleted');
      await loadSubmissions();
    } catch (err) {
      triggerToast(`Delete failed: ${(err as Error).message}`);
    }
  };

  const openManageColumnsModal = () => {
    setTempCols(JSON.parse(JSON.stringify(submissionCols)));
    setManageColsOpen(true);
  };

  const closeManageColumnsModal = () => setManageColsOpen(false);

  const toggleTempColumn = (key: string) => {
    setTempCols((prev) => prev.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)));
  };

  const applyManageColumns = () => {
    setSubmissionCols(JSON.parse(JSON.stringify(tempCols)));
    setManageColsOpen(false);
    triggerToast('Table columns updated successfully!');
  };

  // ---- Share helpers ----
  const getShareUrlFor = (form: Form) =>
    `https://app.gohighlevel.com/v2/location/hifi/forms/${form.id}`;

  const openMoveToFolderModal = (form: Form) => {
    setOpenMenuFor(null);
    setMenuPos(null);
    setMoveFolderForm(form);
  };

  const uploadToTemplates = (form: Form) => {
    setOpenMenuFor(null);
    setMenuPos(null);
    triggerToast(`"${form.name}" uploaded to agency templates library.`);
  };

  const openSubmissionsForForm = (form: Form) => {
    setOpenMenuFor(null);
    setMenuPos(null);
    setSubmissionFormFilter(form.name);
    setDashboardTab('submissions');
    triggerToast(`Showing submissions for "${form.name}"`);
  };

  const buildShareModalUrl = async (form: Form) => {
    if (!form) return '';
    // Saved forms get the short numeric share link (#/f/{id}).
    if (form.id) return shortShareUrl(form);
    try {
      const token = serializeFormForUrl(await publicPayloadWithHostedImage({
        name: form.name,
        columns: form.columns,
        campaignId: form.campaignId,
        header: form.header,
        elements: form.elements
          .filter((el) => !el.isHidden)
          .map((el) => ({
            id: el.id,
            label: el.label,
            type: el.type,
            required: el.required,
            placeholder: el.placeholder,
            options: el.options,
            rows: el.rows,
            buttonColor: el.type === 'button' ? el.buttonColor : undefined,
            buttonTextColor: el.type === 'button' ? el.buttonTextColor : undefined,
          })),
      }));
      return `${window.location.origin}${window.location.pathname}#/form/${token}`;
    } catch {
      return getShareUrlFor(form);
    }
  };

  const openShareModal = async (form: Form) => {
    setOpenMenuFor(null);
    setMenuPos(null);
    setShareModalForm(form);
    setShareModalUrl('');
    buildShareModalUrl(form).then(setShareModalUrl).catch(() => undefined);
  };

  const copyShareModalLink = async () => {
    if (!shareModalForm) return;
    const url = shareModalUrl || (await buildShareModalUrl(shareModalForm));
    try {
      await navigator.clipboard.writeText(url);
      triggerToast('Share link copied to clipboard!');
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const shareModalViaEmail = () => {
    if (!shareModalForm) return;
    const subject = encodeURIComponent(`Please fill out: ${shareModalForm.name}`);
    const body = encodeURIComponent(`Fill out this form: ${shareModalUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const shareModalViaSMS = () => {
    if (!shareModalForm) return;
    const text = encodeURIComponent(`Please fill out this form: ${shareModalUrl}`);
    window.location.href = `sms:?&body=${text}`;
  };

  const shareModalViaWhatsApp = () => {
    if (!shareModalForm) return;
    const text = encodeURIComponent(`Please fill out this form: ${shareModalUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  const copyShareEmbedCode = async () => {
    if (!shareModalForm) return;
    const url = shareModalUrl || (await buildShareModalUrl(shareModalForm));
    const embed = `<iframe src="${url}" width="100%" height="600" style="border:none"></iframe>`;
    try {
      await navigator.clipboard.writeText(embed);
      triggerToast('Embed code copied to clipboard!');
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const closeShareModal = () => setShareModalForm(null);

  const confirmMoveToFolder = () => {
    if (moveFolderForm) {
      triggerToast(`"${moveFolderForm.name}" moved to selected folder!`);
    }
    setMoveFolderForm(null);
  };

  const closeMoveToFolder = () => setMoveFolderForm(null);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 text-slate-800 text-sm">
      {currentView === 'dashboard' ? (
        <div className="h-full flex flex-col overflow-hidden">
          <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white">
            {/* Top Navbar with Tabs & Right Utility Actions */}
            <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-2.5 flex items-center justify-between shrink-0 shadow-xs gap-4">
              {/* Horizontal Navigation Tabs */}
              <nav className="flex items-center space-x-4 sm:space-x-6 text-xs font-semibold text-slate-600 overflow-x-auto no-scrollbar whitespace-nowrap">
                <a href="#" className="hover:text-slate-900 transition py-1">
                  Funnels
                </a>
                <a href="#" className="hover:text-slate-900 transition py-1">
                  Websites
                </a>
                <a href="#" className="hover:text-slate-900 transition py-1">
                  Stores
                </a>
                <a href="#" className="hover:text-slate-900 transition py-1">
                  Webinars
                </a>
                <a href="#" className="hover:text-slate-900 transition py-1">
                  Analytics
                </a>
                <a href="#" className="hover:text-slate-900 transition py-1">
                  Blogs
                </a>
                <a href="#" className="hover:text-slate-900 transition py-1">
                  WordPress
                </a>
                <a href="#" className="hover:text-slate-900 transition py-1 flex items-center space-x-1">
                  <span>Client Portal</span>
                  <FaChevronDown className="text-[10px]" />
                </a>
                <a href="#" className="text-blue-600 border-b-2 border-blue-600 font-bold py-1">
                  Forms
                </a>
                <a href="#" className="hover:text-slate-900 transition py-1">
                  Surveys
                </a>
                <a href="#" className="hover:text-slate-900 transition py-1">
                  Quizzes
                </a>
                <a href="#" className="hover:text-slate-900 transition py-1">
                  Chat Widget
                </a>
                <a href="#" className="hover:text-slate-900 transition py-1">
                  QR Codes
                </a>
                <a href="#" className="text-slate-400 hover:text-slate-700 py-1">
                  <FaGear />
                </a>
              </nav>

              {/* Top Right Utility Actions */}
              <div className="flex items-center space-x-2.5 shrink-0 ml-4">
                <button className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs hover:bg-emerald-600 transition shadow-xs">
                  <FaPhone />
                </button>
                <button className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-full flex items-center space-x-1.5 shadow-xs">
                  <FaWandMagicSparkles className="text-[10px]" />
                  <span>Ask AI</span>
                </button>
                <button className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs relative hover:bg-emerald-600 transition">
                  <FaBullhorn className="text-[11px]" />
                  <span className="absolute -top-1 -right-1 bg-red-500 w-2.5 h-2.5 rounded-full border border-white" />
                </button>
                <button className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs relative hover:bg-amber-600 transition">
                  <NotificationsBell />
                </button>
                <button className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs hover:bg-blue-600 transition">
                  <FaRegCircleQuestion className="text-xs" />
                </button>
                {user && <UserMenu user={user} onLogout={logout} />}
              </div>
            </header>

            {/* Forms Specific Sub-Header Bar */}
            <div className="px-4 sm:px-6 py-3 border-b border-slate-200 bg-white flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center space-x-4 sm:space-x-6 text-xs font-medium text-slate-600">
                <span className="font-semibold text-slate-800">Forms</span>
                <button
                  onClick={() => setDashboardTab('all')}
                  className={
                    dashboardTab === 'all'
                      ? 'text-blue-600 border-b-2 border-blue-600 pb-1 font-semibold'
                      : 'hover:text-slate-900 transition pb-1'
                  }
                >
                  All forms
                </button>
                <button
                  onClick={() => setDashboardTab('analytics')}
                  className={
                    dashboardTab === 'analytics'
                      ? 'text-blue-600 border-b-2 border-blue-600 pb-1 font-semibold'
                      : 'hover:text-slate-900 transition pb-1'
                  }
                >
                  Analytics
                </button>
                <button
                  onClick={() => setDashboardTab('submissions')}
                  className={
                    dashboardTab === 'submissions'
                      ? 'text-blue-600 border-b-2 border-blue-600 pb-1 font-semibold'
                      : 'hover:text-slate-900 transition pb-1'
                  }
                >
                  Submissions
                </button>
              </div>

              <div className="flex items-center space-x-2 ml-auto sm:ml-0">
                <button className="border border-slate-300 hover:bg-slate-50 text-blue-600 px-2.5 sm:px-3 py-1.5 rounded text-xs font-medium flex items-center space-x-1.5 transition">
                  <FaRegFlag className="text-blue-600" />
                  <span className="hidden sm:inline">Form features</span>
                </button>
                <button
                  className="border border-slate-300 hover:bg-slate-50 text-slate-600 p-1.5 rounded transition"
                  title="Templates / Add"
                >
                  <FaFolderPlus className="text-sm" />
                </button>
                <button
                  onClick={openModal}
                  className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium px-3 sm:px-3.5 py-1.5 rounded text-xs flex items-center space-x-1.5 shadow-sm transition shrink-0"
                >
                  <FaPlus className="text-xs" />
                  <span>Create form</span>
                </button>
              </div>
            </div>

            {/* Forms Table Container */}
            <div className="flex-1 p-3 sm:p-6 overflow-y-auto bg-slate-50">
              {dashboardTab === 'analytics' ? (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 evee-fade-up">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-blue-600/20">
                        <FaChartLine className="text-sm" />
                      </div>
                      <div>
                        <span className="font-semibold text-sm text-slate-800 block">Analytics</span>
                        <span className="text-xs text-slate-500">Form performance overview</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative">
                        <FaFilter className="absolute left-2.5 top-2 text-slate-400 text-[11px]" />
                        <select
                          value={analyticsMode}
                          onChange={(e) =>
                            setAnalyticsMode(e.target.value === 'all' ? 'all' : Number(e.target.value))
                          }
                          className="pl-7 pr-8 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-700 focus:outline-none focus:border-blue-500 shadow-sm appearance-none cursor-pointer"
                        >
                          <option value="all">All Forms</option>
                          {forms.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                        <FaChevronDown className="absolute right-2.5 top-2.5 text-slate-400 text-[10px] pointer-events-none" />
                      </div>
                      <div className="flex items-center bg-white border border-slate-200 rounded-lg shadow-sm p-0.5 text-xs">
                        {(
                          [
                            ['week', 'Weekly'],
                            ['month', 'Monthly'],
                            ['year', 'Yearly'],
                          ] as [AnalyticsPeriod, string][]
                        ).map(([p, label]) => (
                          <button
                            key={p}
                            onClick={() => setAnalyticsPeriod(p)}
                            className={`px-2.5 py-1 rounded-md font-semibold transition ${
                              analyticsPeriod === p
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => {
                          refreshAnalytics();
                          triggerToast('Analytics refreshed');
                        }}
                        disabled={submissionLoading}
                        className="p-1.5 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-md text-xs shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Refresh analytics"
                      >
                        <FaRotate
                          className={`text-slate-500 text-xs ${submissionLoading ? 'animate-spin' : ''}`}
                        />
                      </button>
                    </div>
                  </div>

                  <div key={`${analyticsPeriod}-${String(analyticsMode)}`} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                    {METRICS.map((m, idx) => {
                      const isActive = activeMetric === m.key;
                      const value = analytics.totals[m.key];
                      const accents: Record<MetricKey, string> = {
                        testDrives: 'from-violet-600 to-fuchsia-500',
                        responses: 'from-emerald-500 to-teal-500',
                        leads: 'from-sky-500 to-blue-500',
                        forms: 'from-amber-500 to-orange-500',
                      };
                      return (
                        <button
                          key={m.key}
                          onClick={() => setActiveMetric(m.key)}
                          className={`text-left bg-white border rounded-xl p-3 sm:p-4 shadow-sm evee-card-hover evee-fade-up evee-delay-${idx + 1} ${
                            isActive
                              ? 'border-blue-500 ring-1 ring-blue-500/40 shadow-lg shadow-blue-600/10'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span
                              className={`w-9 h-9 rounded-xl bg-gradient-to-br ${accents[m.key]} text-white flex items-center justify-center text-sm shadow-md`}
                            >
                              {m.icon}
                            </span>
                            {isActive && (
                              <span className="text-[9px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
                                Active
                              </span>
                            )}
                          </div>
                          <div className="text-2xl font-bold text-slate-900">
                            <AnimatedNumber value={value} format={m.format} />
                          </div>
                          <div className="text-xs text-slate-500 font-medium mt-0.5 flex items-center space-x-1">
                            <span>{m.label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div key={`${activeMetric}-${String(analyticsMode)}-${analyticsPeriod}`} className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 sm:p-5 evee-fade-up">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-800 flex items-center space-x-2">
                          <span>{METRICS.find((m) => m.key === activeMetric)?.label}</span>
                          <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                            {analyticsMode === 'all' ? 'All Forms' : forms.find((f) => f.id === analyticsMode)?.name}
                          </span>
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">{analytics.periodLabel}</p>
                      </div>
                      <div className="flex items-center space-x-1 text-[11px] font-medium bg-slate-100 p-0.5 rounded-lg">
                        {METRICS.map((m) => (
                          <button
                            key={m.key}
                            onClick={() => setActiveMetric(m.key)}
                            className={`px-2.5 py-1 rounded-md evee-tab-pill ${
                              activeMetric === m.key
                                ? 'bg-white text-blue-600 shadow-sm font-semibold'
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="relative">
                      <div className="flex items-end gap-2 sm:gap-4 h-44 border-b border-slate-100 pb-2">
                        {analytics.buckets.map((point, i) => {
                          const max = Math.max(...analytics.buckets.map((p) => p.values[activeMetric]), 1);
                          const h = Math.round((point.values[activeMetric] / max) * 100);
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group">
                              <span className="text-[10px] font-semibold text-slate-600 mb-1 opacity-0 group-hover:opacity-100 transition transform translate-y-1 group-hover:translate-y-0">
                                {METRICS.find((m) => m.key === activeMetric)?.format(point.values[activeMetric])}
                              </span>
                              <div
                                className={`w-full max-w-[42px] rounded-t-md evee-bar evee-delay-${i + 1} evee-bar-glow ${
                                  activeMetric === 'testDrives'
                                    ? 'bg-gradient-to-t from-violet-600 to-fuchsia-400'
                                    : activeMetric === 'responses'
                                    ? 'bg-gradient-to-t from-teal-600 to-emerald-400'
                                    : activeMetric === 'leads'
                                    ? 'bg-gradient-to-t from-sky-600 to-blue-400'
                                    : 'bg-gradient-to-t from-amber-600 to-orange-400'
                                } transition-all duration-300 group-hover:opacity-90`}
                                style={{ height: `${h}%` }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex gap-2 sm:gap-4 mt-2">
                        {analytics.buckets.map((point, i) => (
                          <div key={i} className="flex-1 text-center text-[10px] text-slate-400 font-medium">
                            {point.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : dashboardTab === 'submissions' ? (
                <>
                  {/* Submissions Top Filter Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 evee-fade-up">
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <select
                          value={submissionFormFilter}
                          onChange={(e) => setSubmissionFormFilter(e.target.value)}
                          className="bg-white border border-slate-300 text-slate-700 text-xs rounded-md pl-3 pr-8 py-2 font-medium focus:outline-none focus:border-blue-500 shadow-xs appearance-none cursor-pointer"
                        >
                          <option value="all">All Forms</option>
                          {allRegisteredForms.map((f) => (
                            <option key={f.id} value={f.name}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                        <FaChevronDown className="absolute right-2.5 top-3 text-[10px] text-slate-400 pointer-events-none" />
                      </div>

                      <div className="bg-sky-100/70 border border-sky-200 text-sky-700 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1">
                        <span>Total submissions</span>
                        <span className="bg-sky-600 text-white rounded-full text-[10px] px-1.5 py-0.5 font-bold">
                          {filteredSubmissions.length}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <div className="relative flex items-center">
                        <FaRegCalendarDays className="absolute left-2.5 text-xs text-slate-400 pointer-events-none" />
                        <input
                          type="text"
                          value={submissionStartDate}
                          onChange={(e) => setSubmissionStartDate(e.target.value)}
                          className="bg-white border border-slate-300 text-slate-700 text-xs rounded-md pl-8 pr-3 py-1.5 font-medium focus:outline-none focus:border-blue-500 shadow-xs w-32"
                        />
                      </div>
                      <div className="relative flex items-center">
                        <FaRegCalendarDays className="absolute left-2.5 text-xs text-slate-400 pointer-events-none" />
                        <input
                          type="text"
                          value={submissionEndDate}
                          onChange={(e) => setSubmissionEndDate(e.target.value)}
                          className="bg-white border border-slate-300 text-slate-700 text-xs rounded-md pl-8 pr-3 py-1.5 font-medium focus:outline-none focus:border-blue-500 shadow-xs w-32"
                        />
                      </div>
                      <button
                        onClick={exportSubmissionsCSV}
                        className="px-3 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-md text-xs font-medium flex items-center gap-1.5 shadow-xs transition"
                      >
                        <FaDownload className="text-slate-500 text-xs" />
                        <span>Export</span>
                      </button>
                      <button
                        onClick={() => void deleteAllSubmissions()}
                        disabled={filteredSubmissions.length === 0}
                        className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-xs font-medium flex items-center gap-1.5 shadow-xs transition"
                      >
                        <FaRegTrashCan className="text-xs" />
                        <span>Delete all</span>
                      </button>
                      <button
                        onClick={refreshSubmissions}
                        className="p-1.5 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-md text-xs shadow-xs transition"
                        title="Refresh data"
                      >
                        <FaRotate className="text-slate-500 text-xs" />
                      </button>
                    </div>
                  </div>

                  {/* Table Header Bar: Title, Columns Picker & Search */}
                  <div className="flex items-center justify-between pt-2 evee-fade-up">
                    <h2 className="text-sm font-bold text-slate-800">All submissions</h2>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={openManageColumnsModal}
                        className="px-3 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-md text-xs font-medium flex items-center gap-1.5 shadow-xs transition"
                      >
                        <FaSliders className="text-slate-500 text-xs" />
                        <span>
                          {submissionCols.filter((c) => c.visible).length}/{submissionCols.length} columns
                        </span>
                      </button>
                      <div className="relative w-48">
                        <FaMagnifyingGlass className="absolute left-3 top-2.5 text-xs text-slate-400" />
                        <input
                          type="text"
                          value={submissionSearch}
                          onChange={(e) => setSubmissionSearch(e.target.value)}
                          placeholder="Search"
                          className="w-full bg-white border border-slate-300 rounded-md py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 shadow-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Submissions Data Table Card */}
                  <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-x-auto evee-fade-up">
                    <table className="w-full text-left border-collapse whitespace-nowrap min-w-[1000px]">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 text-xs font-semibold border-b border-slate-200">
                          <th className="py-3 px-3 w-10 text-center">
                            <input
                              type="checkbox"
                              onChange={(e) => toggleSelectAllSubmissions(e.target.checked)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-0"
                            />
                          </th>
                          {submissionCols
                            .filter((c) => c.visible)
                            .map((col) => (
                              <th key={col.key} className="py-3 px-4 font-semibold whitespace-nowrap">
                                {col.label}
                              </th>
                            ))}
                          <th className="py-3 px-3 w-12 text-center font-semibold">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                        {filteredSubmissions.length === 0 && (
                          <tr>
                            <td
                              colSpan={submissionCols.filter((c) => c.visible).length + 2}
                              className="py-8 text-center text-slate-400"
                            >
                              <FaRegFolderOpen className="text-2xl mb-2 block mx-auto" />
                              {submissionLoading
                                ? 'Loading submissions...'
                                : 'No submissions found for selected filters.'}
                            </td>
                          </tr>
                        )}
                        {filteredSubmissions.map((sub) => (
                          <tr key={sub.id} className="hover:bg-slate-50/80 transition border-b border-slate-100">
                            <td className="py-3.5 px-3 text-center">
                              <input
                                type="checkbox"
                                className="sub-checkbox rounded border-slate-300 text-blue-600 focus:ring-0"
                              />
                            </td>
                            {submissionCols
                              .filter((c) => c.visible)
                              .map((col) => (
                                <td key={col.key} className="py-3.5 px-4 whitespace-nowrap">
                                  {renderSubmissionCell(col.key, sub)}
                                </td>
                              ))}
                            <td className="py-3.5 px-3 text-center">
                              <button
                                onClick={() => void deleteOneSubmission(sub)}
                                className="text-red-500 hover:text-red-700 p-1.5 bg-red-50 rounded hover:bg-red-100 transition"
                                title="Delete submission"
                              >
                                <FaRegTrashCan className="text-xs" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Footer */}
                  <div className="flex items-center justify-end space-x-4 text-xs text-slate-500 pt-2 evee-fade-up">
                    <div className="flex items-center space-x-2">
                      <span>Rows per page</span>
                      <select className="border border-slate-300 rounded bg-white py-1 px-2 text-xs focus:outline-none">
                        <option>20</option>
                        <option>50</option>
                        <option>100</option>
                      </select>
                    </div>
                    <span>
                      {filteredSubmissions.length > 0
                        ? `1 - ${filteredSubmissions.length} of ${filteredSubmissions.length}`
                        : '0 - 0 of 0'}
                    </span>
                    <div className="flex items-center space-x-1">
                      <button className="px-2 py-1 border border-slate-200 rounded bg-slate-50 text-slate-400 cursor-not-allowed">
                        Previous
                      </button>
                      <button className="px-2.5 py-1 border border-blue-500 bg-white text-blue-600 font-bold rounded">
                        1
                      </button>
                      <button className="px-2 py-1 border border-slate-200 rounded bg-slate-50 text-slate-400 cursor-not-allowed">
                        Next
                      </button>
                    </div>
                  </div>
                </>
              ) : (
              <>
              <div className="flex items-center justify-end space-x-2 mb-4">
                <div className="flex items-center border border-slate-300 rounded-md bg-white p-0.5 shadow-xs">
                  <button className="px-2 py-1 text-slate-500 hover:text-slate-800 text-xs">
                    <FaRegClock />
                  </button>
                  <button className="px-2 py-1 bg-slate-100 text-blue-600 rounded text-xs font-bold">
                    <FaListUl />
                  </button>
                </div>
                <div className="relative w-64">
                  <FaMagnifyingGlass className="absolute left-3 top-2.5 text-xs text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for forms"
                    className="w-full bg-white border border-slate-300 rounded-md py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 shadow-xs"
                  />
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-visible">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-xs font-semibold border-b border-slate-200">
                      <th className="py-3 px-4 w-1/2 font-semibold">
                        <div className="flex items-center gap-2">
                          <FaRegUser className="text-slate-400" />
                          <span>Name</span>
                        </div>
                      </th>
                      <th className="py-3 px-4 font-semibold">
                        <div className="flex items-center gap-2">
                          <FaRegCalendarDays className="text-slate-400" />
                          <span>Updated on</span>
                        </div>
                      </th>
                      <th className="py-3 px-4 font-semibold">
                        <div className="flex items-center gap-2">
                          <FaRegUser className="text-slate-400" />
                          <span>Updated by</span>
                        </div>
                      </th>
                      <th className="py-3 px-4 w-12 text-center font-semibold" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                    {filteredForms.map((form) => (
                      <tr key={form.id} className="hover:bg-slate-50/80 transition border-b border-slate-100">
                        <td className="py-3.5 px-4 font-normal text-slate-800">
                          <button
                            onClick={() => openEditorWithForm(form)}
                            className="hover:text-blue-600 hover:underline"
                          >
                            {form.name}
                          </button>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">{form.updatedOn}</td>
                        <td className="py-3.5 px-4 text-slate-600">{form.updatedBy}</td>
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={(e) => openRowMenu(e, form.id)}
                            className={`p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus:outline-none transition ${
                              openMenuFor === form.id ? 'bg-slate-100 text-slate-800' : ''
                            }`}
                            title="More actions"
                          >
                            <FaEllipsisVertical className="text-sm" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredForms.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-slate-400">
                          <FaRegFolderOpen className="text-3xl mb-2 block mx-auto" />
                          <span>No forms found</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 text-xs text-slate-500">
                <div className="flex items-center space-x-2">
                  <span>Rows per page</span>
                  <select className="border border-slate-300 rounded px-2 py-1 bg-white text-slate-700 outline-none">
                    <option>20</option>
                    <option>50</option>
                    <option>100</option>
                  </select>
                </div>

                <span>{`1 - ${filteredForms.length} of ${filteredForms.length}`}</span>

                <div className="flex items-center space-x-1">
                  <button className="px-2.5 py-1 border border-slate-200 rounded text-slate-400 bg-white hover:bg-slate-50 disabled:opacity-50" disabled>
                    Previous
                  </button>
                  <button className="px-2.5 py-1 border border-blue-500 rounded text-blue-600 font-semibold bg-blue-50/50">
                    1
                  </button>
                  <button className="px-2.5 py-1 border border-slate-200 rounded text-slate-400 bg-white hover:bg-slate-50 disabled:opacity-50" disabled>
                    Next
                  </button>
                </div>
              </div>
              </>
              )}
            </div>
          </main>

          {/* Fixed Overlay Action Menu for forms rows */}
          {openMenuFor !== null && menuPos && (
            (() => {
              const form = forms.find((f) => f.id === openMenuFor);
              if (!form) return null;
              return (
                <div
                  ref={menuRef}
                  style={{ top: menuPos.top, left: menuPos.left }}
                  className="fixed z-50 w-56 bg-white border border-slate-200 rounded-lg shadow-xl py-1.5 text-xs text-slate-700 text-left evee-fade-up"
                >
                  <button
                    onClick={() => {
                      setOpenMenuFor(null);
                      setMenuPos(null);
                      openEditorWithForm(form);
                    }}
                    className="w-full flex items-center space-x-2 px-3.5 py-2 hover:bg-slate-50 transition text-left"
                  >
                    <FaPen className="text-slate-400" />
                    <span>Edit</span>
                  </button>
                  <button
                    onClick={() => openFormPreview(form)}
                    className="w-full flex items-center space-x-2 px-3.5 py-2 hover:bg-slate-50 transition text-left"
                  >
                    <FaRegEye className="text-slate-400" />
                    <span>Preview</span>
                  </button>
                  <button
                    onClick={() => openSubmissionsForForm(form)}
                    className="w-full flex items-center space-x-2 px-3.5 py-2 hover:bg-slate-50 transition text-left"
                  >
                    <FaListCheck className="text-slate-400" />
                    <span>View submission</span>
                  </button>
                  <button
                    onClick={() => duplicateForm(form)}
                    className="w-full flex items-center space-x-2 px-3.5 py-2 hover:bg-slate-50 transition text-left"
                  >
                    <FaCopy className="text-slate-400" />
                    <span>Duplicate</span>
                  </button>
                  <button
                    onClick={() => openShareModal(form)}
                    className="w-full flex items-center space-x-2 px-3.5 py-2 hover:bg-slate-50 transition text-left"
                  >
                    <FaShareNodes className="text-slate-400" />
                    <span>Share</span>
                  </button>
                  <button
                    onClick={() => uploadToTemplates(form)}
                    className="w-full flex items-center space-x-2 px-3.5 py-2 hover:bg-slate-50 transition text-left"
                  >
                    <FaArrowUpFromBracket className="text-slate-400" />
                    <span>Upload to form templates</span>
                  </button>
                  <button
                    onClick={() => openMoveToFolderModal(form)}
                    className="w-full flex items-center space-x-2 px-3.5 py-2 hover:bg-slate-50 transition text-left"
                  >
                    <FaRegFolder className="text-slate-400" />
                    <span>Move to folder</span>
                  </button>
                  <div className="border-t border-slate-100 my-1" />
                  <button
                    onClick={() => {
                      setOpenMenuFor(null);
                      setMenuPos(null);
                      deleteForm(form.id);
                    }}
                    className="w-full flex items-center space-x-2 px-3.5 py-2 hover:bg-rose-50 transition text-left text-rose-600"
                  >
                    <FaRegTrashCan />
                    <span>Delete</span>
                  </button>
                </div>
              );
            })()
          )}
        </div>
      ) : (
        <div className="h-full flex flex-col overflow-hidden bg-slate-100 text-slate-800 select-none">
          {/* Editor Top Navigation Bar */}
          <header className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex items-center justify-between shrink-0 shadow-sm z-20 gap-2">
            {/* Left Header Controls */}
            <div className="flex items-center space-x-2 sm:space-x-4">
              <button
                onClick={backToDashboard}
                className="flex items-center space-x-1.5 text-xs text-slate-600 hover:text-slate-900 font-medium border border-slate-200 rounded px-2 sm:px-2.5 py-1 hover:bg-slate-50 transition"
              >
                <FaArrowLeft className="text-slate-500" />
                <span className="hidden sm:inline">Back</span>
              </button>

              <div className="hidden sm:flex items-center space-x-1 bg-slate-100 p-0.5 rounded border border-slate-200">
                <button className="p-1 rounded text-slate-400 hover:text-slate-700 transition" title="Add view">
                  <FaPlus className="text-xs" />
                </button>
                <button
                  onClick={() => setEditorDevice('desktop')}
                  className={
                    editorDevice === 'desktop'
                      ? 'p-1 px-2 rounded transition bg-white shadow-sm text-blue-600'
                      : 'p-1 px-2 rounded transition text-slate-500 hover:text-slate-800'
                  }
                  title="Desktop View"
                >
                  <FaDesktop className="text-xs" />
                </button>
                <button
                  onClick={() => setEditorDevice('tablet')}
                  className={
                    editorDevice === 'tablet'
                      ? 'p-1 px-2 rounded transition bg-white shadow-sm text-blue-600'
                      : 'p-1 px-2 rounded transition text-slate-500 hover:text-slate-800'
                  }
                  title="Tablet / Mobile View"
                >
                  <FaMobileScreenButton className="text-xs" />
                </button>
              </div>
            </div>

            {/* Center Form Title & Nav Tabs */}
            <div className="flex items-center space-x-2 sm:space-x-6 min-w-0">
              <div className="flex items-center space-x-1 sm:space-x-2 border-r border-slate-200 pr-2 sm:pr-6 shrink-0">
                <input
                  type="text"
                  value={activeForm.name}
                  onChange={(e) => setActiveForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="font-semibold text-slate-800 text-xs sm:text-sm bg-transparent hover:bg-slate-100 focus:bg-white focus:border focus:border-blue-500 rounded px-1.5 py-0.5 outline-none transition w-24 sm:w-32 truncate"
                />
                <FaPen className="text-slate-400 text-xs cursor-pointer hover:text-slate-600 hidden sm:inline" />
              </div>

              <nav className="flex items-center space-x-3 sm:space-x-6 text-xs font-medium text-slate-500 overflow-x-auto no-scrollbar whitespace-nowrap">
                {(['Edit', 'Settings', 'Submissions', 'Notifications'] as EditorTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setEditorTab(tab)}
                    className={
                      editorTab === tab
                        ? 'text-blue-600 font-semibold border-b-2 border-blue-600 py-1'
                        : 'hover:text-slate-800 py-1'
                    }
                  >
                    {tab}
                  </button>
                ))}
              </nav>
            </div>

            {/* Right Header Actions */}
            <div className="flex items-center space-x-1.5 sm:space-x-3 shrink-0">
              <div className="hidden md:flex items-center space-x-2 text-slate-400 text-xs border-r border-slate-200 pr-3">
                <button className="hover:text-slate-600" title="History">
                  <FaRegClock />
                </button>
                <button className="hover:text-slate-600" title="Undo">
                  <FaRotateLeft />
                </button>
                <button className="hover:text-slate-600" title="Redo">
                  <FaRotateRight />
                </button>
              </div>

              <button
                onClick={sharePublicLink}
                className="border border-slate-300 hover:bg-slate-50 text-slate-700 px-2 sm:px-3 py-1 rounded text-xs font-medium flex items-center space-x-1.5 transition"
                title="Copy public link for ads integration"
              >
                <FaLink />
                <span className="hidden sm:inline">Share</span>
              </button>
              <button
                onClick={openPublicPreview}
                className="border border-slate-300 hover:bg-slate-50 text-slate-700 px-2 sm:px-3 py-1 rounded text-xs font-medium flex items-center space-x-1.5 transition"
                title="Open form preview in a new tab"
              >
                <FaRegEye />
                <span className="hidden sm:inline">Preview</span>
              </button>
              <button
                onClick={saveFormInEditor}
                className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium px-3 sm:px-4 py-1 rounded text-xs flex items-center space-x-1.5 shadow-sm transition"
              >
                <FaRegFloppyDisk />
                <span>Save</span>
              </button>
            </div>
          </header>

          {/* Editor Body */}
          {editorTab === 'Submissions' ? (
            <div className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-sm text-slate-800">{activeForm.name}</span>
                  <span className="text-xs text-slate-500">Submissions</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="flex items-center bg-white border border-slate-200 rounded divide-x divide-slate-200">
                    <button className="px-2.5 py-1 text-slate-500 hover:text-slate-800 transition">
                      <FaRegClock />
                    </button>
                    <button className="px-2.5 py-1 text-slate-800 bg-slate-100 font-semibold transition">
                      <FaListUl />
                    </button>
                  </div>
                </div>
              </div>

              {activeForm.submissions.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-md shadow-sm p-12 text-center">
                  <FaRegFolderOpen className="text-3xl mb-2 text-slate-300 block mx-auto" />
                  <p className="font-semibold text-slate-600 text-sm mb-1">No submissions yet</p>
                  <p className="text-xs text-slate-400">
                    Submit the form via the Preview button to see submission data here.
                  </p>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-md shadow-sm overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-600 text-xs font-medium">
                        {activeForm.elements.map((el) => (
                          <th key={el.id} className="py-3 px-4 font-medium whitespace-nowrap">
                            {el.label}
                          </th>
                        ))}
                        <th className="py-3 px-4 font-medium whitespace-nowrap">Submitted On</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {activeForm.submissions.map((sub) => (
                        <tr key={sub.id} className="hover:bg-slate-50/80 transition">
                          {activeForm.elements.map((el) => (
                            <td key={el.id} className="py-3 px-4 text-slate-700 whitespace-nowrap">
                              {sub.values[el.label] || <span className="text-slate-300">—</span>}
                            </td>
                          ))}
                          <td className="py-3 px-4 text-slate-500 whitespace-nowrap">{sub.submittedOn}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
          <div className="flex-1 flex overflow-hidden relative">
            {/* Left Sidebar: Form Elements Drawer */}
            {showElementDrawer && (
              <aside className="w-72 sm:w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden shadow-sm z-10">
                <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
                  <span className="font-semibold text-xs text-slate-800">Form Elements</span>
                  <button onClick={() => setShowElementDrawer(false)} className="text-slate-400 hover:text-slate-600 p-1">
                    <FaXmark />
                  </button>
                </div>

                <div className="flex border-b border-slate-200 text-xs font-medium text-slate-600 bg-slate-50">
                  <button
                    onClick={() => setSidebarTab('quickAdd')}
                    className={
                      sidebarTab === 'quickAdd'
                        ? 'flex-1 py-2 text-center transition bg-white text-blue-600 border-b-2 border-blue-600 font-semibold'
                        : 'flex-1 py-2 text-center transition hover:text-slate-900'
                    }
                  >
                    Quick Add
                  </button>
                  <button
                    onClick={() => setSidebarTab('customFields')}
                    className={
                      sidebarTab === 'customFields'
                        ? 'flex-1 py-2 text-center transition bg-white text-blue-600 border-b-2 border-blue-600 font-semibold'
                        : 'flex-1 py-2 text-center transition hover:text-slate-900'
                    }
                  >
                    Add Object Fields
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-5 text-xs">
                  <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-2.5 text-[11px] text-blue-700 flex items-center space-x-2 mb-2">
                    <FaHandPointer className="text-blue-500 text-sm shrink-0" />
                    <span>Tap or drag any element to add it directly to your form.</span>
                  </div>

                  {/* Form Settings: layout + header */}
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3 mb-1">
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Form Settings
                    </div>

                    <div>
                      <div className="text-[11px] text-slate-600 mb-1">Field layout</div>
                      <div className="flex rounded-md border border-slate-200 overflow-hidden bg-white">
                        <button
                          type="button"
                          onClick={() => setActiveForm((prev) => ({ ...prev, columns: 1 }))}
                          className={`flex-1 py-1.5 text-[11px] font-medium transition ${
                            (activeForm.columns ?? 1) === 1
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          Stacked
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveForm((prev) => ({ ...prev, columns: 2 }))}
                          className={`flex-1 py-1.5 text-[11px] font-medium transition ${
                            activeForm.columns === 2
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          2 Columns
                        </button>
                      </div>
                      <p className="text-[9px] text-slate-400 mt-1">
                        Stacked = fields one below the other; 2 Columns = side by side.
                      </p>
                    </div>

                    <div>
                      <div className="text-[11px] text-slate-600 mb-1">Campaign</div>
                      <select
                        value={activeForm.campaignId ?? ''}
                        onChange={(e) =>
                          setActiveForm((prev) => ({
                            ...prev,
                            campaignId: e.target.value ? Number(e.target.value) : undefined,
                          }))
                        }
                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-700 focus:outline-none focus:border-blue-400 bg-white"
                      >
                        <option value="">No campaign</option>
                        {campaigns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-[9px] text-slate-400 mt-1">
                        {campaigns.length === 0
                          ? 'No campaigns available. They load automatically when connected to the server.'
                          : 'Submissions will show this campaign in the activity tab.'}
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-slate-600">Form header</span>
                        <label className="flex items-center space-x-1.5 text-[10px] text-slate-500">
                          <input
                            type="checkbox"
                            checked={!!activeForm.header}
                            onChange={(e) =>
                              setActiveForm((prev) => ({
                                ...prev,
                                header: e.target.checked
                                  ? prev.header ?? {
                                      image: '',
                                      title: prev.name,
                                      accentColor: '#2563EB',
                                    }
                                  : undefined,
                              }))
                            }
                            className="rounded border-slate-300 text-blue-600"
                          />
                          <span>Enabled</span>
                        </label>
                      </div>

                      {activeForm.header && (
                        <div className="space-y-2 bg-white border border-slate-200 rounded-md p-2.5">
                          <div className="flex items-center space-x-2">
                            <input
                              ref={headerImgRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handleHeaderImage}
                            />
                            <button
                              type="button"
                              onClick={() => headerImgRef.current?.click()}
                              className="flex-1 border border-slate-200 rounded py-1.5 text-[11px] text-slate-700 hover:bg-slate-50 transition"
                            >
                              <FaRegImage className="mr-1" />
                              Change image
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setActiveForm((prev) =>
                                  prev.header ? { ...prev, header: { ...prev.header, image: '' } } : prev
                                )
                              }
                              className="border border-slate-200 rounded px-2.5 py-1.5 text-[11px] text-slate-500 hover:bg-slate-50 transition"
                              title="Remove image"
                            >
                              <FaRegTrashCan />
                            </button>
                          </div>

                          <input
                            type="text"
                            value={activeForm.header.title}
                            onChange={(e) =>
                              setActiveForm((prev) =>
                                prev.header ? { ...prev, header: { ...prev.header, title: e.target.value } } : prev
                              )
                            }
                            placeholder="Header text"
                            className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-[11px] text-slate-700 focus:outline-none focus:border-blue-400"
                          />

                          <label className="flex items-center space-x-1.5 text-[10px] text-slate-500">
                            <input
                              type="checkbox"
                              checked={!activeForm.header.hideTitle}
                              onChange={(e) =>
                                setActiveForm((prev) =>
                                  prev.header
                                    ? { ...prev, header: { ...prev.header, hideTitle: !e.target.checked } }
                                    : prev
                                )
                              }
                              className="rounded border-slate-300 text-blue-600"
                            />
                            <span>Show title text</span>
                          </label>

                          <select
                            value={activeForm.header.titleFont ?? ''}
                            onChange={(e) =>
                              setActiveForm((prev) =>
                                prev.header
                                  ? { ...prev, header: { ...prev.header, titleFont: e.target.value } }
                                  : prev
                              )
                            }
                            className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-700 focus:outline-none focus:border-blue-400"
                          >
                            <option value="">Default font</option>
                            {HEADER_FONT_FAMILIES.map((f) => (
                              <option key={f.value} value={f.value}>
                                {f.label}
                              </option>
                            ))}
                          </select>

                          <div className="flex items-center space-x-2">
                            <label className="text-[10px] text-slate-500 whitespace-nowrap">Title color</label>
                            <input
                              type="color"
                              value={activeForm.header.titleColor || '#FFFFFF'}
                              onChange={(e) =>
                                setActiveForm((prev) =>
                                  prev.header
                                    ? { ...prev, header: { ...prev.header, titleColor: e.target.value } }
                                    : prev
                                )
                              }
                              className="w-8 h-8 rounded border border-slate-200 cursor-pointer"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {elementCategories.map((category) => (
                    <div key={category.name}>
                      <div className="text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wider flex items-center justify-between">
                        <span>{category.name}</span>
                        {category.updated && (
                          <span className="text-[9px] bg-blue-100 text-blue-700 font-medium px-1.5 py-0.2 rounded-full">
                            Updated
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {category.items.map((item) => (
                          <div
                            key={item.key}
                            draggable
                            onDragStart={(e) => handleSidebarDragStart(e, item)}
                            onClick={() => addElementToCanvas(item)}
                            className="p-2 sm:p-2.5 border border-slate-200 hover:border-blue-500 hover:shadow-sm bg-white rounded-lg text-center flex flex-col items-center justify-between transition cursor-grab active:cursor-grabbing group relative select-none"
                          >
                            <div className="text-slate-300 group-hover:text-slate-400 text-[10px] tracking-widest leading-none mb-1">
                              ⋮⋮
                            </div>
                            <div className="w-7 sm:w-8 h-7 sm:h-8 rounded-md bg-slate-50 group-hover:bg-blue-50 flex items-center justify-center border border-slate-100 group-hover:border-blue-200 transition">
                              {item.icon}
                            </div>
                            <span className="text-[10px] sm:text-[11px] text-slate-700 font-medium leading-tight mt-1">
                              {item.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </aside>
            )}

            {/* Toggle Drawer Floating Control */}
            {!showElementDrawer && (
              <div className="absolute top-3 left-3 z-10 flex items-center space-x-2">
                <button
                  onClick={() => setShowElementDrawer(true)}
                  className="p-2 bg-white border border-slate-300 rounded-md shadow-md hover:bg-slate-50 text-slate-700 transition flex items-center space-x-1.5 text-xs font-medium"
                >
                  <FaPlus className="text-blue-600" />
                  <span className="hidden sm:inline">Add Elements</span>
                </button>
              </div>
            )}

            {/* Canvas Viewport Center Container */}
            <div
              className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 flex flex-col items-center justify-start bg-slate-100 min-w-0"
              onDragOver={handleCanvasDragOver}
              onDragLeave={handleCanvasDragLeave}
              onDrop={handleCanvasDrop}
              onClick={() => setSelectedElement(null)}
            >
              <div
                className={`${
                  editorDevice === 'desktop' ? 'w-full max-w-xl' : 'w-full max-w-sm'
                } rounded-xl shadow-md border border-slate-200 p-4 sm:p-8 transition-all duration-200 my-2 sm:my-auto w-full ${
                  isDraggingOverCanvas ? 'ring-2 ring-blue-500 bg-blue-50/30' : 'bg-white'
                }`}
              >
                {activeForm.elements.length === 0 && (
                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 sm:p-12 text-center text-slate-400 my-4 sm:my-8">
                    <FaCloudArrowDown className="text-3xl mb-3 text-slate-300 block mx-auto" />
                    <p className="font-semibold text-slate-600 text-xs mb-1">Drag and drop elements here</p>
                    <p className="text-[11px]">or tap elements from the sidebar to populate your form</p>
                  </div>
                )}

                {activeForm.elements.length > 0 && (
                  <div className="text-center text-[10px] text-slate-400 mb-2">
                    Click any field to Quick Edit it inline. Drag a field to reorder.
                  </div>
                )}

                {activeForm.header && <FormHeaderBlock header={activeForm.header} />}

                <div
                  className={
                    activeForm.columns === 2
                      ? 'grid grid-cols-2 gap-3 sm:gap-4'
                      : 'space-y-3 sm:space-y-4'
                  }
                >
                  {activeForm.elements.map((element, index) => {
                    const live = element.type === 'local_dropdown';
                    return (
                    <div
                      key={element.id}
                      draggable={selectedElement?.id !== element.id}
                      onDragStart={(e) => handleElementDragStart(e, index)}
                      onDragOver={handleElementDragOver}
                      onDrop={(e) => handleElementDrop(e, index)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedElement(element);
                      }}
                      className={`relative p-2.5 sm:p-3 rounded-lg border transition group cursor-pointer bg-white shadow-sm ${
                        selectedElement?.id === element.id
                          ? 'ring-2 ring-blue-500 bg-blue-50/20 border-blue-300'
                          : 'hover:border-slate-300 border-slate-200 sm:cursor-move'
                      }`}
                    >
                      {selectedElement?.id === element.id && (
                        <div className="mb-2 -mt-1 flex items-center justify-between bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider rounded px-2 py-1">
                          <span className="flex items-center gap-1">
                            <FaPen className="w-2.5 h-2.5" />
                            Quick Edit
                          </span>
                          <span className="font-normal normal-case tracking-normal text-blue-100 text-[9px] hidden sm:inline">
                            Edit field settings below
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-slate-100 sm:border-none sm:pb-0 sm:mb-0">
                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider sm:hidden flex items-center space-x-1">
                          <FaGripVertical />
                          <span>Field</span>
                        </div>

                        <div className="flex sm:absolute sm:-top-3 sm:right-2 items-center space-x-1 bg-slate-800 text-white rounded px-2 py-0.5 text-[10px] shadow-md z-10 ml-auto">
                          <span className="text-slate-400 mr-1 text-[9px] hidden sm:inline">Drag to move</span>
                          {element.isHidden && (
                            <span className="bg-amber-400/20 text-amber-300 px-1 rounded text-[9px] font-semibold">
                              Hidden
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              moveElementUp(index);
                            }}
                            className="hover:text-blue-300 p-0.5"
                            title="Move Up"
                          >
                            <FaArrowUp />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              moveElementDown(index);
                            }}
                            className="hover:text-blue-300 p-0.5"
                            title="Move Down"
                          >
                            <FaArrowDown />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeElement(element.id);
                            }}
                            className="hover:text-rose-300 p-0.5"
                            title="Delete"
                          >
                            <FaRegTrashCan />
                          </button>
                        </div>
                      </div>

                      <FieldRenderer
                        element={element}
                        alignment={
                          element.labelAlignment?.[editorDevice === 'desktop' ? 'desktop' : 'mobile'] ?? 'default'
                        }
                        editable={false}
                        onPatch={patchSelectedElement}
                        onAddOption={addInlineOption}
                        onEditOption={updateInlineOption}
                        onRemoveOption={removeInlineOption}
                        previewValues={previewValues}
                        onPreviewChange={
                          live
                            ? (elId, key, v) => handlePreviewValueChange(elId, key, v)
                            : undefined
                        }
                      />

                      {selectedElement?.id === element.id && (
                        <InlineFieldEditor
                          element={element}
                          index={index}
                          total={activeForm.elements.length}
                          onPatch={patchSelectedElement}
                          onMoveUp={() => moveElementUp(index)}
                          onMoveDown={() => moveElementDown(index)}
                          onDuplicate={duplicateSelectedElement}
                          onDelete={() => removeElement(element.id)}
                          onDone={() => setSelectedElement(null)}
                          onAddOption={addInlineOption}
                          onEditOption={updateInlineOption}
                          onRemoveOption={removeInlineOption}
                        />
                      )}
                    </div>
                  );
                })}
                </div>

                <div className="mt-6 sm:mt-8 pt-4 border-t border-slate-100 text-center text-[11px] text-slate-400 space-x-2">
                  <a href="#" className="hover:underline">
                    Privacy Policy
                  </a>
                  <span>|</span>
                  <a href="#" className="hover:underline">
                    Terms of Service
                  </a>
                </div>
              </div>
            </div>

            {/* Right Inspector Drawer (Active Field Properties) */}
            {selectedElement && (
              <aside className="w-72 sm:w-80 bg-white border-l border-slate-200 p-4 flex flex-col shrink-0 shadow-sm z-10 overflow-y-auto">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4 shrink-0">
                  <span className="font-semibold text-xs text-slate-800">Field Settings</span>
                  <button onClick={() => setSelectedElement(null)} className="text-slate-400 hover:text-slate-600 p-1">
                    <FaXmark />
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <GeneralSettingsAccordion
                    key={selectedElement.id}
                    initialConfig={toGeneralSettings(selectedElement)}
                    allowOptions={CHOICE_TYPES.includes(selectedElement.type)}
                    isButton={selectedElement.type === 'button'}
                    onChange={(updated: GeneralSettingsState) =>
                      setSelectedElement((prev) =>
                        prev
                          ? {
                              ...prev,
                              label: updated.label,
                              placeholder: updated.placeholder,
                              shortLabel: updated.shortLabel,
                              queryKey: updated.queryKey,
                              fieldWidth: updated.fieldWidth,
                              widthUnit: updated.widthUnit,
                              required: updated.isRequired,
                              isHidden: updated.isHidden,
                              labelAlignment: {
                                desktop: updated.labelAlignment.desktop,
                                mobile: updated.labelAlignment.mobile,
                              },
                              options: updated.options,
                              buttonColor: updated.buttonColor,
                              buttonTextColor: updated.buttonTextColor,
                            }
                          : prev
                      )
                    }
                  />

                  {selectedElement.type === 'local_dropdown' && (
                    <LocalDropdownSettings
                      key={selectedElement.id}
                      rows={selectedElement.rows ?? []}
                      onChange={(rows) =>
                        setSelectedElement((prev) =>
                          prev ? { ...prev, rows } : prev
                        )
                      }
                    />
                  )}

                  <div className="pt-4">
                    <button
                      onClick={() => removeElement(selectedElement.id)}
                      className="w-full border border-rose-200 text-rose-600 hover:bg-rose-50 rounded py-1.5 font-medium transition"
                    >
                      <FaRegTrashCan className="mr-1" />
                      <span>Remove Field</span>
                    </button>
                  </div>
                </div>
              </aside>
            )}
          </div>
          )}
        </div>
      )}

      {/* Create New Form Modal Backdrop */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl p-4 sm:p-6 relative overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 sm:pb-4 mb-4 border-b border-slate-100 shrink-0">
              <h3 className="text-sm sm:text-base font-semibold text-slate-800">Create new form</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition">
                <FaXmark className="text-lg" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6 overflow-y-auto">
              <div
                onClick={() => setSelectedOption('scratch')}
                className={`border rounded-xl p-3 sm:p-4 cursor-pointer transition relative bg-white flex flex-col justify-between h-48 sm:h-64 ${
                  selectedOption === 'scratch'
                    ? 'border-blue-500 ring-1 ring-blue-500'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between mb-1">
                    <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Start from Scratch</h4>
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center transition shrink-0 ${
                        selectedOption === 'scratch' ? 'border-blue-600 bg-white' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {selectedOption === 'scratch' && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                    </div>
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-500 mb-2 leading-snug">
                    Design from scratch using the form builder
                  </p>
                </div>

                <div className="bg-slate-100/90 rounded-lg h-24 sm:h-36 flex items-center justify-center">
                  <div className="w-8 sm:w-10 h-8 sm:h-10 rounded-full bg-white flex items-center justify-center shadow-sm text-slate-700">
                    <FaPlus className="text-base sm:text-lg" />
                  </div>
                </div>
              </div>

              <div
                onClick={openTemplateLibrary}
                className={`border rounded-xl p-3 sm:p-4 cursor-pointer transition relative bg-white flex flex-col justify-between h-48 sm:h-64 evee-card-hover ${
                  selectedOption === 'template'
                    ? 'border-blue-500 ring-1 ring-blue-500'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between mb-1">
                    <h4 className="font-bold text-slate-800 text-xs sm:text-sm">From templates</h4>
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center transition shrink-0 ${
                        selectedOption === 'template' ? 'border-blue-600 bg-white' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {selectedOption === 'template' && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                    </div>
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-500 mb-2 leading-snug">
                    Jump start with an awesome prebuilt form
                  </p>
                </div>

                {selectedOption === 'template' ? (
                  <div className="bg-gradient-to-br from-orange-50 via-white to-orange-50 rounded-lg h-24 sm:h-36 p-3 sm:p-4 relative overflow-hidden flex flex-col justify-between border border-orange-200">
                    <div className="z-10">
                      <div className="font-bold text-slate-800 text-xs sm:text-sm leading-tight">
                        Dealership Registration
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        Name · Phone · Email · Dealership Code · Whatsapp · City · Area
                      </div>
                    </div>
                    <div className="flex items-center justify-between z-10">
                      <span className="text-[9px] font-semibold text-[#EB5F1B] bg-orange-100 px-1.5 py-0.5 rounded-full">
                        Yadea Form
                      </span>
                      <div className="flex -space-x-1.5">
                        {['bg-orange-200', 'bg-amber-200', 'bg-slate-200'].map((c) => (
                          <div key={c} className={`w-5 h-5 rounded-full ${c} border-2 border-white`} />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-50/90 rounded-lg h-24 sm:h-36 p-3 sm:p-4 relative overflow-hidden flex flex-col justify-between border border-amber-100">
                    <div className="z-10">
                      <div className="font-bold text-slate-800 text-xs leading-tight max-w-[100px]">
                        Over 1000+ Templates
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2 shrink-0">
              <button
                onClick={closeModal}
                className="px-3.5 sm:px-4 py-1.5 border border-slate-300 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => (selectedOption === 'template' ? openTemplateLibrary() : createForm())}
                className="px-4 sm:px-5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium shadow-sm transition"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Library Modal */}
      <TemplateLibrary
        open={showTemplateLibrary}
        onClose={() => setShowTemplateLibrary(false)}
        onUseTemplate={createFormFromTemplate}
      />

      {/* Manage Columns Slide-Out Drawer */}
      {manageColsOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div onClick={closeManageColumnsModal} className="fixed inset-0 bg-slate-900/30 backdrop-blur-[1px]" />
          <div className="relative w-80 max-w-full bg-white h-full shadow-2xl flex flex-col z-10">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-800">Manage columns</h2>
              <button onClick={closeManageColumnsModal} className="text-slate-400 hover:text-slate-600 transition p-1">
                <FaXmark className="text-base" />
              </button>
            </div>

            <div className="p-4 border-b border-slate-100">
              <div className="relative">
                <FaMagnifyingGlass className="absolute left-3 top-2.5 text-xs text-slate-400" />
                <input
                  type="text"
                  placeholder="Search fields"
                  className="w-full bg-white border border-slate-300 rounded-md py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-xs font-semibold text-slate-700 mb-3">Fields in table</div>
              <div className="space-y-3">
                {tempCols.map((col) => (
                  <div key={col.key} className="flex items-center justify-between py-1 text-xs text-slate-700 select-none">
                    <div className="flex items-center gap-3">
                      <FaGripVertical className="text-slate-300 cursor-grab text-xs" />
                      <label className={`flex items-center gap-2 cursor-pointer ${col.locked ? 'cursor-not-allowed opacity-80' : ''}`}>
                        <input
                          type="checkbox"
                          checked={col.visible}
                          disabled={col.locked}
                          onChange={() => toggleTempColumn(col.key)}
                          className="rounded text-blue-600 border-slate-300 focus:ring-0 w-4 h-4"
                        />
                        <span className="font-medium text-slate-800">{col.label}</span>
                      </label>
                    </div>
                    {col.locked && <FaLock className="text-slate-400 text-xs" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 flex items-center justify-end gap-2 bg-white">
              <button
                onClick={closeManageColumnsModal}
                className="px-4 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium text-xs rounded-md transition"
              >
                Cancel
              </button>
              <button
                onClick={applyManageColumns}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-md shadow-xs transition"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Form Modal */}
      {shareModalForm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <FaShareNodes className="text-blue-600" /> Share Form
              </h3>
              <button onClick={closeShareModal} className="text-slate-400 hover:text-slate-600 text-sm">
                <FaXmark />
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-3">
              <p className="mb-1">
                Share <strong>{shareModalForm.name}</strong> with your audience via the options below.
              </p>

              {/* Copy link */}
              <div>
                <div className="font-semibold text-slate-700 mb-1">Public form link</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareModalUrl}
                    className="w-full bg-slate-100 border border-slate-300 rounded p-2 text-xs font-mono text-slate-600"
                  />
                  <button
                    onClick={copyShareModalLink}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shrink-0 transition"
                  >
                    Copy
                  </button>
                </div>
              </div>

              {/* Share via channels */}
              <div>
                <div className="font-semibold text-slate-700 mb-2">Share via</div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={shareModalViaEmail}
                    className="flex flex-col items-center gap-1.5 border border-slate-200 hover:border-blue-300 hover:bg-blue-50 rounded-lg py-3 transition"
                  >
                    <FaRegEnvelope className="text-lg text-blue-600" />
                    <span className="text-[10px] font-semibold text-slate-600">Email</span>
                  </button>
                  <button
                    onClick={shareModalViaSMS}
                    className="flex flex-col items-center gap-1.5 border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 rounded-lg py-3 transition"
                  >
                    <FaMessage className="text-lg text-emerald-600" />
                    <span className="text-[10px] font-semibold text-slate-600">SMS</span>
                  </button>
                  <button
                    onClick={shareModalViaWhatsApp}
                    className="flex flex-col items-center gap-1.5 border border-slate-200 hover:border-green-300 hover:bg-green-50 rounded-lg py-3 transition"
                  >
                    <FaWhatsapp className="text-lg text-green-600" />
                    <span className="text-[10px] font-semibold text-slate-600">WhatsApp</span>
                  </button>
                </div>
              </div>

              {/* Embed code */}
              <div>
                <div className="font-semibold text-slate-700 mb-1">Embed code</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`<iframe src="${shareModalUrl}" width="100%" height="600" style="border:none"></iframe>`}
                    className="w-full bg-slate-100 border border-slate-300 rounded p-2 text-xs font-mono text-slate-600"
                  />
                  <button
                    onClick={copyShareEmbedCode}
                    className="px-3 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded text-xs font-bold shrink-0 transition"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={closeShareModal}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-md"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move to Folder Modal */}
      {moveFolderForm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <FaRegFolder className="text-blue-600" /> Move to Folder
              </h3>
              <button onClick={closeMoveToFolder} className="text-slate-400 hover:text-slate-600 text-sm">
                <FaXmark />
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-3">
              <p className="mb-2">
                Select target destination folder for <strong>{moveFolderForm.name}</strong>:
              </p>
              <select className="w-full border border-slate-300 rounded p-2 text-xs">
                <option>Root Directory (No Folder)</option>
                <option>Auto Dealer Leads</option>
                <option>Contact Forms</option>
                <option>Marketing Campaigns</option>
              </select>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={closeMoveToFolder}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={confirmMoveToFolder}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-md"
              >
                Move Form
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast Notification */}
      {showToast && (
        <div className="fixed bottom-4 right-4 sm:bottom-5 sm:right-5 bg-slate-900 text-white text-xs px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-lg shadow-xl flex items-center space-x-2 z-50">
          <FaCircleCheck className="text-emerald-400 text-sm" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

export default FormsDashboard;
