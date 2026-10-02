import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  FaFileInvoice,
  FaFilePdf,
  FaFloppyDisk,
  FaMagnifyingGlass,
  FaPlus,
  FaPrint,
  FaRegTrashCan,
  FaRotateRight,
  FaCircleInfo,
  FaPenToSquare,
  FaChartLine,
  FaPalette,
  FaMotorcycle,
} from 'react-icons/fa6';
import { api, type ApiInvoice, type InvoiceContent, type InvoiceInput } from '../api';
import { useAuth } from '../auth';
import YadeaLogo from './YadeaLogo';

/* ------------------------------ helpers ------------------------------ */

function parseNum(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/[^0-9.-]+/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatMoney(amount: number): string {
  if (!Number.isFinite(amount)) return '0.00';
  return amount.toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * True when a stored amount override exists and is genuinely different from
 * the calculated figure. Rows written before amounts were overridable just
 * carry the calculated total, so comparing on load keeps them auto-calculating
 * instead of freezing the number they happened to save.
 */
function differsFromCalc(stored: string | null | undefined, calc: number): boolean {
  if (typeof stored !== 'string' || stored.trim() === '') return false;
  return Math.abs(parseNum(stored) - calc) > 0.005;
}

function todayDMY(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/* ----------------------- inline-editable text node ----------------------- */

/**
 * A text node on the invoice sheet that can be edited in place.
 *
 * Uses contentEditable rather than an <input> so it sizes to its own content
 * and prints with its inherited typography instead of a form-control box.
 * The node is only re-synced from props while it is NOT focused, otherwise
 * React would reset the caret on every keystroke.
 */
function EditableText({
  value,
  onChange,
  className = '',
  style,
  ariaLabel,
  title,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
  title?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const shown = useRef(value);

  // Adopt a new value only when the node is idle, so typing is never clobbered.
  useEffect(() => {
    if (focused.current) return;
    if (shown.current === value) return;
    shown.current = value;
    if (ref.current) ref.current.innerText = value;
  }, [value]);

  // Restore the initial/default copy if this node mounts empty.
  useEffect(() => {
    if (ref.current && !ref.current.innerText && value) {
      shown.current = value;
      ref.current.innerText = value;
    }
    // Mount only — later syncing is handled by the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      tabIndex={0}
      aria-label={ariaLabel}
      title={title}
      data-placeholder={placeholder}
      className={`inv-editable ${className}`}
      style={style}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        const next = (ref.current?.innerText ?? '').replace(/ /g, ' ').trim();
        shown.current = next;
        onChange(next);
      }}
      onKeyDown={(e) => {
        // Enter commits instead of inserting a newline; Shift+Enter still allows one.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        }
        // Keep the sheet's drag/select canvas from swallowing the keystroke.
        e.stopPropagation();
      }}
    />
  );
}

/* --------------------- dashboard history filters --------------------- */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type InvoiceRangeKey =
  | 'all'
  | 'today'
  | 'tomorrow'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'year'
  | 'custom';

export const INVOICE_RANGES: { key: InvoiceRangeKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'yesterday', label: 'Previous Day' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
  { key: 'custom', label: 'Custom' },
];

/** Parse the slip's free-text "DD/MM/YYYY" date into a Date (or null). */
function parseDMY(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Resolve a preset (or custom range) into an inclusive [start, end] window. */
function getRange(key: InvoiceRangeKey, from: string, to: string): [Date | null, Date | null] {
  const now = new Date();
  switch (key) {
    case 'today':
      return [startOfDay(now), endOfDay(now)];
    case 'tomorrow': {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      return [startOfDay(t), endOfDay(t)];
    }
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return [startOfDay(y), endOfDay(y)];
    }
    case 'week': {
      // Monday-start current week through today.
      const s = startOfDay(now);
      s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
      return [s, endOfDay(now)];
    }
    case 'month':
      return [new Date(now.getFullYear(), now.getMonth(), 1), endOfDay(now)];
    case 'year':
      return [new Date(now.getFullYear(), 0, 1), endOfDay(now)];
    case 'custom': {
      const f = from ? new Date(from) : null;
      const t = to ? new Date(to) : null;
      const validF = f && !Number.isNaN(f.getTime()) ? f : null;
      const validT = t && !Number.isNaN(t.getTime()) ? endOfDay(t) : null;
      return [validF, validT];
    }
    default:
      return [null, null];
  }
}

interface InvoiceFormState {
  invoiceNo: string;
  dated: string;
  strn: string;
  address: string;
  ms: string;
  qty: string;
  motorcycle: string;
  year: string;
  color: string;
  engine: string;
  chassis: string;
  valueExcl: string;
  taxRate: string;
}

/** Defaults carried over from the printed Yadea slip (fixed shop details). */
const EMPTY_FORM: InvoiceFormState = {
  invoiceNo: '',
  dated: '',
  strn: '3277876272668',
  address: 'Plaza # 27, Mini Ext 1, Bahria Town Phase 7, Rawalpindi.',
  ms: '',
  qty: '1',
  motorcycle: '',
  year: '',
  color: '',
  engine: '',
  chassis: '',
  valueExcl: '',
  taxRate: '18',
};

function emptyFormWithDefaults(): InvoiceFormState {
  return { ...EMPTY_FORM, dated: todayDMY() };
}

/**
 * Shipped wording for every text node on the sheet. Keeping the defaults in one
 * place means a text node stores an override only when it actually differs, so
 * invoices created before a wording change still follow the current copy.
 */
const DEFAULT_TEXT: Record<string, string> = {
  brandText: 'Yadea',
  titleText: 'Invoice',
  labelInvoiceNo: 'Invoice No',
  labelInvoiceDate: 'Invoice Date',
  labelInvoiceTo: 'Invoice To:',
  labelInvoiceFrom: 'Invoice From:',
  sellerName: 'Yadea Hussain Motors',
  labelStrn: 'STRN Number:',
  labelValueExclTax: 'Value Excl. Tax:',
  labelTaxRate: 'Sales Tax Rate:',
  labelTotalInclTax: 'Total Incl. Tax:',
  thQty: 'Qty',
  thDescription: 'Description',
  thValueExcl: 'Value Excl. Sales Tax',
  thTaxRate: 'Tax Rate',
  thSalesTaxPayable: 'Sales Tax Payable',
  thValueIncl: 'Value Incl. Tax',
  rowTotal: 'TOTAL',
  lblMotorcycle: 'Motorcycle',
  lblYear: 'M/Year',
  lblColor: 'Colur',
  lblEngine: 'Engine#',
  lblChasis: 'Chasis',
  labelTermsHeading: 'Terms and Conditions:',
  term1Num: '1.',
  term2Num: '2.',
  term1: 'Payment is due in full at the time of delivery of the vehicle.',
  term2: 'Warranty and service claims are processed as per official Yadea Hussain Motors policy.',
  labelTotalsValueExcl: 'Value Excl. Tax:',
  labelTotalsTaxPayable: 'Sales Tax Payable:',
  labelTotalPayable: 'Total Payable:',
  labelForOnBehalfOf: 'For & on Behalf of',
  signatureName: 'Yadea Hussain Motors',
  labelSignature: 'Signature',
  currencyText: 'Rs',
};

/* ----------------------- invoice design studio ------------------------- */

/** Per-element Canva-style overrides: position nudge, scale, colours, size. */
interface ElemOverride {
  x: number;
  y: number;
  scale: number;
  colorA?: string;
  colorB?: string;
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
}

const EMPTY_EL: ElemOverride = { x: 0, y: 0, scale: 1 };

/** Selectable regions on the invoice canvas + the colours each exposes. */
const REGION_META: Record<string, { label: string; colors: [keyof ElemOverride, string][] }> = {
  lockup: { label: 'Brand Logo', colors: [['colorA', 'YADEA text']] },
  titleBlock: { label: 'INVOICE Title', colors: [['colorA', 'Title colour']] },
  infoCols: { label: 'Info Columns', colors: [['colorA', 'Headings']] },
  itemsTable: { label: 'Items Table', colors: [['colorA', 'Header pill'], ['colorB', 'Row rules']] },
  termsBlock: { label: 'Terms & Conditions', colors: [['colorA', 'Text']] },
  totalsBlock: { label: 'Totals Summary', colors: [['colorA', 'Pill bg'], ['colorB', 'Pill label']] },
  signature: { label: 'Signature', colors: [['colorA', 'Name colour']] },
  waves: { label: 'Footer Waves', colors: [['colorA', 'Top wave'], ['colorB', 'Bottom wave']] },
};

/** Everything the user can customise about the invoice look. */
interface InvoiceDesign {
  accentColor: string; // title, bars, row rules, pill label
  darkColor: string; // navy: header wave, table pill, totals pill
  brandTextColor: string; // YADEA lockup text
  logoSide: 'left' | 'right'; // where the brand lockup sits
  titleAlign: 'left' | 'right'; // alignment of title + number block
  brandTextSize: number; // px
  iconSize: number; // px
  headerHeight: number; // px
  pillRound: boolean; // rounded-full vs rounded-lg table header
  showWaves: boolean;
  showTerms: boolean;
  showSignature: boolean;
  elements: Record<string, Partial<ElemOverride>>;
}

const DEFAULT_DESIGN: InvoiceDesign = {
  accentColor: '#FF5400',
  darkColor: '#021C35',
  brandTextColor: '#0f172a',
  logoSide: 'left',
  titleAlign: 'right',
  brandTextSize: 25,
  iconSize: 32,
  headerHeight: 210,
  pillRound: true,
  showWaves: true,
  showTerms: true,
  showSignature: true,
  elements: {},
};

const designStorageKey = (uid?: number | null) => `yadea_invoice_design_v1_u${uid ?? 0}`;

function loadDesign(uid?: number | null): InvoiceDesign {
  try {
    const raw = localStorage.getItem(designStorageKey(uid));
    if (!raw) return DEFAULT_DESIGN;
    const parsed = JSON.parse(raw) as Partial<InvoiceDesign>;
    return { ...DEFAULT_DESIGN, ...parsed };
  } catch {
    return DEFAULT_DESIGN;
  }
}

/* --------------------- lazy html2pdf (CDN) loader -------------------- */

const HTML2PDF_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

type Html2PdfApi = {
  (): {
    set: (opt: Record<string, unknown>) => {
      from: (el: HTMLElement) => { save: () => Promise<void> };
    };
  };
};

function getHtml2Pdf(): Html2PdfApi | null {
  const w = window as unknown as { html2pdf?: Html2PdfApi };
  return w.html2pdf ?? null;
}

function loadHtml2Pdf(): Promise<Html2PdfApi> {
  return new Promise((resolve, reject) => {
    const existing = getHtml2Pdf();
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    script.src = HTML2PDF_CDN;
    script.async = true;
    script.onload = () => {
      const lib = getHtml2Pdf();
      if (lib) resolve(lib);
      else reject(new Error('PDF library failed to initialise'));
    };
    script.onerror = () =>
      reject(new Error('Could not load the PDF library (check your internet connection)'));
    document.head.appendChild(script);
  });
}

/* ------------------------------- icons ------------------------------ */

const DESC_ROWS: { key: keyof InvoiceFormState; textKey: string; placeholder: string }[] = [
  { key: 'motorcycle', textKey: 'lblMotorcycle', placeholder: 'e.g. Yadea T9 Electric Scooter' },
  { key: 'year', textKey: 'lblYear', placeholder: '2026' },
  { key: 'color', textKey: 'lblColor', placeholder: 'Grey / Red' },
  { key: 'engine', textKey: 'lblEngine', placeholder: 'Engine No.' },
  { key: 'chassis', textKey: 'lblChasis', placeholder: 'Chassis No.' },
];

/* ================================ page ============================== */

interface InvoicesPageProps {
  onNotify: (msg: string) => void;
}

export default function InvoicesPage({ onNotify }: InvoicesPageProps) {
  const { user, hasActionPermission } = useAuth();
  const canEdit = hasActionPermission('invoices', 'Invoices', 'edit');
  const canDelete = hasActionPermission('invoices', 'Invoices', 'delete');
  const canExport = hasActionPermission('invoices', 'Invoices', 'export');

  const [form, setForm] = useState<InvoiceFormState>(emptyFormWithDefaults);
  const [content, setContent] = useState<InvoiceContent>({});
  const [design, setDesign] = useState<InvoiceDesign>(() => loadDesign(user?.id));
  const [designOpen, setDesignOpen] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  /* Persist the design per user so it survives reloads. */
  useEffect(() => {
    try {
      localStorage.setItem(designStorageKey(user?.id), JSON.stringify(design));
    } catch {
      /* ignore storage errors */
    }
  }, [design, user?.id]);

  const updDesign = (patch: Partial<InvoiceDesign>) => setDesign((d) => ({ ...d, ...patch }));

  /* ------------------- Canva-style canvas editing ------------------- */

  /** Selected canvas region id (null = nothing selected). */
  const [sel, setSel] = useState<string | null>(null);

  const elO = useCallback(
    (id: string): ElemOverride => ({ ...EMPTY_EL, ...(design.elements?.[id] ?? {}) }),
    [design.elements]
  );

  const setElO = (id: string, patch: Partial<ElemOverride>) =>
    setDesign((d) => {
      const cur = { ...EMPTY_EL, ...(d.elements?.[id] ?? {}) };
      return { ...d, elements: { ...(d.elements ?? {}), [id]: { ...cur, ...patch } } };
    });

  // Esc deselects, like a real design tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dragState = useRef<null | {
    mode: 'move' | 'scale';
    id: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    os: number;
  }>(null);

  const beginGesture = (e: React.PointerEvent, id: string, mode: 'move' | 'scale') => {
    e.preventDefault();
    e.stopPropagation();
    setSel(id);
    const o = elO(id);
    dragState.current = { mode, id, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, os: o.scale };

    const move = (ev: PointerEvent) => {
      const st = dragState.current;
      if (!st) return;
      const dx = ev.clientX - st.sx;
      const dy = ev.clientY - st.sy;
      if (st.mode === 'move') {
        setElO(st.id, { x: Math.round(st.ox + dx), y: Math.round(st.oy + dy) });
      } else {
        const factor = Math.max(0.55, Math.min(1.9, st.os + dx / 220));
        setElO(st.id, { scale: Math.round(factor * 100) / 100 });
      }
    };
    const up = () => {
      dragState.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const [invoices, setInvoices] = useState<ApiInvoice[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Dashboard view + history filters.
  const [view, setView] = useState<'editor' | 'dashboard'>('editor');
  const [rangeKey, setRangeKey] = useState<InvoiceRangeKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [dashSearch, setDashSearch] = useState('');

  const docRef = useRef<HTMLDivElement | null>(null);

  /* While the editor is mounted every print (button or Ctrl+P) outputs only
      the invoice sheet - the CSS below hides everything else. */
  useEffect(() => {
    if (view !== 'editor') {
      document.body.classList.remove('inv-printing');
      return undefined;
    }
    document.body.classList.add('inv-printing');
    return () => document.body.classList.remove('inv-printing');
  }, [view]);

  /* Load the Poppins display font once for the invoice sheet. */
  useEffect(() => {
    const id = 'yadea-invoice-poppins';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap';
    document.head.appendChild(link);
  }, []);

  /* Suggested next sequential number for a fresh invoice. */
  useEffect(() => {
    let active = true;
    api
      .nextInvoiceNumber()
      .then((res) => {
        if (!active) return;
        setForm((prev) =>
          prev.invoiceNo === '' ? { ...prev, invoiceNo: res.data.invoice_no } : prev
        );
      })
      .catch(() => {
        /* offline: leave the field empty for manual entry */
      });
    return () => {
      active = false;
    };
  }, []);

  /* Invoice listing for the dashboard (search/filtering happens client-side). */
  const loadInvoices = useCallback(async () => {
    setLoadingList(true);
    try {
      const params: { created_by?: number } = {};
      if (user && user.user_type !== 'Admin') params.created_by = user.id;
      const res = await api.listInvoices(params);
      setInvoices(res.data);
    } catch (err) {
      onNotify(`Failed to load invoices: ${(err as Error).message}`);
    } finally {
      setLoadingList(false);
    }
  }, [user, onNotify]);

  // Fetch whenever the dashboard view opens (and on user change).
  useEffect(() => {
    if (view === 'dashboard') void loadInvoices();
  }, [view, loadInvoices]);

  /* ------------------------- live calculations ------------------------ */

  const qtyNum = parseNum(form.qty) || 1;
  const valueExcl = parseNum(form.valueExcl);
  const taxRate = parseNum(form.taxRate);
  const calcTotalExcl = valueExcl * qtyNum;
  const calcTaxPayable = calcTotalExcl * (taxRate / 100);
  const calcTotalIncl = calcTotalExcl + calcTaxPayable;

  /* --------- editable copy + manual amount overrides --------- */

  /** A blank/absent override means "work it out from the line values". */
  const hasOverride = (v?: string) => typeof v === 'string' && v.trim() !== '';

  const totalExcl = hasOverride(content.totalExcl) ? parseNum(content.totalExcl) : calcTotalExcl;
  const taxPayable = hasOverride(content.taxPayable) ? parseNum(content.taxPayable) : calcTaxPayable;
  const totalIncl = hasOverride(content.totalIncl) ? parseNum(content.totalIncl) : calcTotalIncl;

  const setOverride = (key: 'totalExcl' | 'taxPayable' | 'totalIncl', raw: string) =>
    setContent((c) => ({ ...c, [key]: raw.trim() === '' ? '' : raw.trim() }));

  /** Edited copy for a sheet text node, falling back to the shipped wording. */
  const txt = (key: string) => content.text?.[key] ?? DEFAULT_TEXT[key] ?? '';

  const setTxt = (key: string, value: string) =>
    setContent((c) => ({
      ...c,
      text: { ...(c.text ?? {}), [key]: value === DEFAULT_TEXT[key] ? '' : value },
    }));

  const resetAmounts = () =>
    setContent((c) => ({ ...c, totalExcl: '', taxPayable: '', totalIncl: '' }));

  const amountOverridden = hasOverride(content.totalExcl) || hasOverride(content.taxPayable) || hasOverride(content.totalIncl);

  /** The "Rs"-style currency prefix shown before each total. */
  const currencyEl = (
    <EditableText
      value={txt('currencyText')}
      onChange={(v) => setTxt('currencyText', v)}
      ariaLabel="Currency prefix"
      title="Currency prefix"
    />
  );

  /**
   * An amount on the sheet. Shows the effective figure (manual override when
   * one is set, otherwise the calculated value) and stores whatever is typed;
   * clearing the text drops the override and returns to calculating.
   */
  const moneyNode = (
    key: 'totalExcl' | 'taxPayable' | 'totalIncl',
    effective: number,
    auto: number,
    className = '',
    ariaLabel = 'Amount'
  ) => (
    <EditableText
      value={formatMoney(effective)}
      onChange={(raw) => setOverride(key, raw === formatMoney(auto) ? '' : raw)}
      className={`text-right ${className}`}
      ariaLabel={`${ariaLabel} (click to type a custom figure, clear it to calculate automatically)`}
      title="Click to type a custom figure. Clear the field to calculate it automatically."
    />
  );

  /* ----------------------- dashboard derivations ---------------------- */

  const [rangeStart, rangeEnd] = useMemo(
    () => getRange(rangeKey, customFrom, customTo),
    [rangeKey, customFrom, customTo]
  );

  const filteredInvoices = useMemo(() => {
    const q = dashSearch.trim().toLowerCase();
    return invoices
      .filter((inv) => {
        const d = parseDMY(inv.dated);
        if (rangeStart && (!d || d < rangeStart)) return false;
        if (rangeEnd && (!d || d > rangeEnd)) return false;
        if (q) {
          const hay =
            `${inv.invoice_no} ${inv.customer_name} ${inv.motorcycle} ${inv.engine_no} ${inv.chassis_no}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const da = parseDMY(a.dated)?.getTime() ?? 0;
        const db = parseDMY(b.dated)?.getTime() ?? 0;
        return db - da || b.id - a.id;
      });
  }, [invoices, rangeStart, rangeEnd, dashSearch]);

  const dashCount = filteredInvoices.length;
  const dashRevenue = filteredInvoices.reduce((s, i) => s + (Number(i.value_incl) || 0), 0);
  const dashUnits = filteredInvoices.reduce((s, i) => s + (Number(i.qty) || 0), 0);

  /** Model-wise breakdown of the currently filtered history. */
  const modelSummary = useMemo(() => {
    const map = new Map<string, { model: string; units: number; revenue: number }>();
    filteredInvoices.forEach((inv) => {
      const key = (inv.motorcycle || '').trim();
      if (!key) return;
      const cur = map.get(key.toLowerCase()) ?? { model: key, units: 0, revenue: 0 };
      cur.units += Number(inv.qty) || 0;
      cur.revenue += Number(inv.value_incl) || 0;
      map.set(key.toLowerCase(), cur);
    });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }, [filteredInvoices]);

  const openInvoiceInEditor = (inv: ApiInvoice) => {
    handleLoad(inv);
    setView('editor');
  };

  const setField =
    (key: keyof InvoiceFormState) =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  /* ----------------------------- actions ------------------------------ */

  const handleNew = () => {
    setEditingId(null);
    setView('editor');
    setForm(emptyFormWithDefaults());
    setContent({});
    api
      .nextInvoiceNumber()
      .then((res) => setForm((prev) => ({ ...prev, invoiceNo: res.data.invoice_no })))
      .catch(() => undefined);
  };

  const buildPayload = (): InvoiceInput => ({
    invoice_no: form.invoiceNo.trim(),
    dated: form.dated.trim(),
    strn: form.strn.trim(),
    address: form.address.trim(),
    customer_name: form.ms.trim(),
    qty: Math.max(1, Math.round(qtyNum)),
    motorcycle: form.motorcycle.trim(),
    model_year: form.year.trim(),
    colour: form.color.trim(),
    engine_no: form.engine.trim(),
    chassis_no: form.chassis.trim(),
    value_excl: valueExcl,
    tax_rate: taxRate,
    tax_payable: Math.round(taxPayable * 100) / 100,
    value_incl: Math.round(totalIncl * 100) / 100,
    content: {
      ...(Object.keys(content.text ?? {}).length ? { text: content.text } : {}),
      totalExcl: content.totalExcl ?? '',
      taxPayable: content.taxPayable ?? '',
      totalIncl: content.totalIncl ?? '',
    },
    created_by: user?.id ?? null,
  });

  const handleSave = async () => {
    if (!canEdit || saving) return;
    if (!form.invoiceNo.trim()) {
      onNotify('Invoice number is required');
      return;
    }
    if (!form.ms.trim()) {
      onNotify('Customer name (M/S) is required');
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      if (editingId !== null) {
        await api.updateInvoice(editingId, payload);
        onNotify(`Invoice "${payload.invoice_no}" updated`);
      } else {
        const res = await api.createInvoice(payload);
        setEditingId(res.data.id);
        onNotify(`Invoice "${payload.invoice_no}" saved to database`);
      }
      await loadInvoices();
    } catch (err) {
      onNotify(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = (inv: ApiInvoice) => {
    setEditingId(inv.id);
    setForm({
      invoiceNo: inv.invoice_no,
      dated: inv.dated ?? '',
      strn: inv.strn ?? '',
      address: inv.address ?? 'Plaza # 27, Mini Ext 1, Bahria Town Phase 7, Rawalpindi.',
      ms: inv.customer_name ?? '',
      qty: String(inv.qty ?? 1),
      motorcycle: inv.motorcycle ?? '',
      year: inv.model_year ?? '',
      color: inv.colour ?? '',
      engine: inv.engine_no ?? '',
      chassis: inv.chassis_no ?? '',
      valueExcl: String(inv.value_excl ?? 0),
      taxRate: String(inv.tax_rate ?? 18),
    });
    setContent({
      ...(inv.content?.text ? { text: inv.content.text } : {}),
      // Only treat a stored amount as an override when it differs from what the
      // line values work out to, so older rows that stored plain totals keep
      // calculating automatically.
      totalExcl: differsFromCalc(inv.content?.totalExcl, inv.value_excl * (Number(inv.qty) || 1))
        ? inv.content?.totalExcl ?? ''
        : '',
      taxPayable: differsFromCalc(inv.content?.taxPayable, inv.tax_payable)
        ? inv.content?.taxPayable ?? ''
        : '',
      totalIncl: differsFromCalc(inv.content?.totalIncl, inv.value_incl)
        ? inv.content?.totalIncl ?? ''
        : '',
    });
    onNotify(`Loaded invoice "${inv.invoice_no}"`);
  };

  const handleDelete = async (inv: ApiInvoice) => {
    if (!canDelete) return;
    if (!window.confirm(`Delete invoice "${inv.invoice_no}"? This cannot be undone.`)) return;
    try {
      await api.deleteInvoice(inv.id);
      if (editingId === inv.id) setEditingId(null);
      onNotify(`Invoice "${inv.invoice_no}" deleted`);
      await loadInvoices();
    } catch (err) {
      onNotify(`Delete failed: ${(err as Error).message}`);
    }
  };

  const handlePrint = () => {
    setSel(null);
    window.print();
  };

  const handleDownloadPdf = async () => {
    if (!docRef.current || pdfBusy) return;
    setSel(null);
    setPdfBusy(true);
    try {
      const html2pdf = await loadHtml2Pdf();
      await html2pdf()
        .set({
          margin: [0.15, 0.15, 0.15, 0.15],
          filename: `Yadea_Sales_Tax_Invoice_${form.invoiceNo.trim() || 'draft'}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0 },
          jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
        })
        .from(docRef.current)
        .save();
    } catch (err) {
      onNotify(`${(err as Error).message} - opening the print dialog instead`);
      window.print();
    } finally {
      setPdfBusy(false);
    }
  };

  /* ------------------------------- view ------------------------------- */

  /* Header building blocks — driven entirely by the Design Studio + canvas overrides. */
  const tRight = design.titleAlign === 'right';

  /** Selection chrome: drag grip, scale handle, reset dot (never printed). */
  const Handles = ({ id }: { id: string }) => {
    if (sel !== id) return null;
    return (
      <>
        <span
          className="inv-ui"
          onPointerDown={(e) => beginGesture(e, id, 'move')}
          style={{
            position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
            background: '#2563eb', color: '#fff', borderRadius: 6, padding: '2px 10px',
            cursor: 'grab', fontSize: 11, fontWeight: 800, zIndex: 40, whiteSpace: 'nowrap',
            boxShadow: '0 2px 6px rgba(0,0,0,.3)',
          }}
          title="Drag to move"
        >
          ✥ {REGION_META[id]?.label ?? id}
        </span>
        <span
          className="inv-ui"
          onPointerDown={(e) => beginGesture(e, id, 'scale')}
          style={{
            position: 'absolute', right: -8, bottom: -8, width: 16, height: 16,
            background: '#2563eb', border: '2px solid #fff', borderRadius: '50%',
            cursor: 'nwse-resize', zIndex: 40, boxShadow: '0 1px 4px rgba(0,0,0,.35)',
          }}
          title="Drag to resize"
        />
        <button
          type="button"
          className="inv-ui"
          onClick={(e) => {
            e.stopPropagation();
            setElO(id, { x: 0, y: 0, scale: 1 });
            setDesign((d) => {
              const elements = { ...(d.elements ?? {}) };
              delete elements[id];
              return { ...d, elements };
            });
          }}
          style={{
            position: 'absolute', top: -12, right: -12, width: 18, height: 18,
            background: '#ef4444', color: '#fff', borderRadius: '50%',
            fontSize: 11, lineHeight: '18px', zIndex: 40, border: 'none', cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(0,0,0,.35)',
          }}
          title="Reset this element"
        >
          ×
        </button>
      </>
    );
  };

  /** Shared wrapper props for a canvas region. */
  const regionProps = (id: string) => {
    const o = elO(id);
    return {
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        setSel(id);
      },
      className: `relative ${sel === id ? 'inv-selected' : ''}`,
      style: {
        transform: `translate(${o.x}px, ${o.y}px) scale(${o.scale})`,
        transition: dragState.current ? 'none' : 'transform .08s ease-out',
      } as React.CSSProperties,
    };
  };

  const lockupEl = (
    <div {...regionProps('lockup')}>
      <div className="flex flex-col items-center shrink-0 mt-[20px] ml-[20px]">
        <div className="flex items-end" style={{ height: design.iconSize }}>
          <YadeaLogo wordmark={false} className="h-full w-auto" />
        </div>
        <span
          className="leading-none font-black uppercase tracking-[0.05em] mt-1.5"
          style={{ fontSize: design.brandTextSize, color: elO('lockup').colorA ?? design.brandTextColor }}
        >
          <EditableText
            value={txt('brandText')}
            onChange={(v) => setTxt('brandText', v)}
            ariaLabel="Brand name"
            className="inv-editable-strong"
          />
        </span>
      </div>
      <Handles id="lockup" />
    </div>
  );

  const tAlign = elO('titleBlock').align ?? (tRight ? 'right' : 'left');

  const titleEl = (
    <div
      {...regionProps('titleBlock')}
      className={`relative max-w-[240px] shrink-0 mt-0.5 ${
        sel === 'titleBlock' ? 'inv-selected' : ''
      } ${tAlign === 'right' ? 'text-right mr-0 sm:mr-[4px]' : 'text-left ml-0 sm:ml-[4px]'}`}
      style={regionProps('titleBlock').style}
    >
      <h1
        className="leading-none font-black uppercase"
        style={{
          color: elO('titleBlock').colorA ?? design.accentColor,
          fontSize: elO('titleBlock').fontSize ?? 38,
          letterSpacing: '0.03em',
        }}
      >
        <EditableText
          value={txt('titleText')}
          onChange={(v) => setTxt('titleText', v)}
          ariaLabel="Document title"
        />
      </h1>
      <div
        className={`${tAlign === 'right' ? 'ml-auto' : ''} mt-1.5 h-[3px] w-20 rounded-full`}
        style={{ backgroundColor: elO('titleBlock').colorA ?? design.accentColor }}
      />
      <div className="mt-3 space-y-2.5">
        <div className={`flex items-center gap-2 ${tAlign === 'right' ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[8.5px] font-bold tracking-[0.18em] uppercase text-white/70 whitespace-nowrap">
            <EditableText
              value={txt('labelInvoiceNo')}
              onChange={(v) => setTxt('labelInvoiceNo', v)}
              ariaLabel="Invoice number label"
            />
          </span>
          <input
            type="text"
            value={form.invoiceNo}
            onChange={setField('invoiceNo')}
            className="inv-bare w-28 text-left bg-transparent border-b border-white/30 focus:border-white/80 text-white font-semibold placeholder-white/40 transition-colors"
            aria-label="Invoice number"
          />
        </div>
        <div className={`flex items-center gap-2 ${tAlign === 'right' ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[8.5px] font-bold tracking-[0.18em] uppercase text-white/70 whitespace-nowrap">
            <EditableText
              value={txt('labelInvoiceDate')}
              onChange={(v) => setTxt('labelInvoiceDate', v)}
              ariaLabel="Invoice date label"
            />
          </span>
          <input
            type="text"
            placeholder="DD/MM/YYYY"
            value={form.dated}
            onChange={setField('dated')}
            className="inv-bare w-28 text-left bg-transparent border-b border-white/30 focus:border-white/80 text-white font-semibold placeholder-white/40 transition-colors"
            aria-label="Invoice date"
          />
        </div>
      </div>
      <Handles id="titleBlock" />
    </div>
  );

  return (
    <>
      {/* Scoped styles: editable-field look + print isolation */}
      <style>{`
        .inv-dotted { border-bottom: 1.5px dotted #94a3b8; background: transparent; transition: border-color .15s ease; }
        .inv-dotted:focus { border-bottom: 1.5px solid #EB5F1B; outline: none; }
        .inv-underlined { border-bottom: 1px solid #1e293b; background: transparent; }
        .inv-underlined:focus { border-bottom: 2px solid #EB5F1B; outline: none; }
        .inv-bare:focus { outline: none; background-color: rgba(254, 243, 199, 0.45); }
        .inv-selected { outline: 2px dashed #2563eb !important; outline-offset: 2px; cursor: move; }
        .inv-ui { font-family: Inter, ui-sans-serif, system-ui, sans-serif; user-select: none; }
        .preview-x::-webkit-scrollbar, .inv-scroll-y::-webkit-scrollbar { height: 6px; width: 6px; }
        .preview-x::-webkit-scrollbar-thumb, .inv-scroll-y::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
        .preview-x::-webkit-scrollbar-track, .inv-scroll-y::-webkit-scrollbar-track { background: transparent; }
        .inv-table-wrap { border: 2px solid #111827; border-radius: 14px; overflow: hidden; background: #fff; }
        .inv-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .inv-table th { border-right: 1.5px solid #111827; border-bottom: 2px solid #111827; font-size: 11px; font-weight: 800; color: #0f172a; padding: 6px 4px; text-align: center; background: #fff; }
        .inv-table td { border-right: 1.5px solid #111827; border-bottom: 1.5px solid #111827; padding: 6px 4px; vertical-align: top; }
        .inv-table th:last-child, .inv-table td:last-child { border-right: none; }
        .inv-table tr.inv-total-row td { border-bottom: none; border-top: 2px solid #111827; background: #fff; }
        .inv-editable {
          min-width: 4px;
          display: inline-block;
          max-width: 100%;
          outline: none;
          border-bottom: 1.5px dashed transparent;
          border-radius: 3px;
          cursor: text;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .inv-editable:hover { border-bottom-color: rgba(100, 116, 139, 0.5); }
        .inv-editable:focus {
          border-bottom-color: #EB5F1B;
          background-color: rgba(254, 243, 199, 0.45);
        }
        .inv-editable:empty::before {
          content: attr(data-placeholder);
          opacity: 0.45;
        }
        .inv-editable-strong { font-weight: 900; }
        .inv-editable-hint {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 11px;
          font-weight: 700;
          color: #B45309;
          background: #FEF3C7;
          border: 1px solid #FDE68A;
          border-radius: 999px;
          padding: 0.15rem 0.6rem;
        }
        @media print {
          body.inv-printing * { visibility: hidden !important; }
          body.inv-printing .inv-page, body.inv-printing .inv-page * { visibility: visible !important; }
          body.inv-printing .inv-scroll-host { overflow: visible !important; padding: 0 !important; }
          body.inv-printing .inv-page { position: absolute; left: 0; top: 0; width: 100% !important; min-width: 0 !important; border: none !important; box-shadow: none !important; border-radius: 0 !important; }
          body.inv-printing input { border: none !important; box-shadow: none !important; background: transparent !important; }
          body.inv-printing .inv-editable { border-bottom-color: transparent !important; background: transparent !important; }
          .inv-selected { outline: none !important; }
          .inv-ui { display: none !important; }
        }
      `}</style>

      <div className="h-full overflow-y-auto bg-slate-100 min-w-0">
        <div className="max-w-[1440px] mx-auto px-3 md:px-6 pb-8">
          {/* Page heading + sticky action bar */}
          <div className="inv-no-print sticky top-0 z-30 -mx-3 md:-mx-6 px-3 md:px-6 pt-4 pb-3 mb-5 bg-slate-100/85 backdrop-blur-md border-b border-slate-200/70 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-yadea-black flex items-center justify-center shadow-md shadow-slate-900/20 ring-1 ring-black/10">
                <YadeaLogo wordmark={false} className="h-7 w-auto" />
              </div>
              <div>
                <h1 className="text-lg font-extrabold text-slate-900 leading-tight">
                  Sales Tax Invoice
                </h1>
                <p className="text-xs text-slate-500">
                  Create, save and export official Yadea Hussain Motors invoices
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {editingId !== null && (
                <span className="inline-flex items-center gap-1.5 bg-yadea-orange/10 text-yadea-dark border border-yadea-orange/30 rounded-lg px-2.5 py-2 text-[11px] font-bold">
                  <FaPenToSquare className="text-[10px]" />
                  Editing #{form.invoiceNo || editingId}
                </span>
              )}
              <button
                type="button"
                onClick={() => setView((v) => (v === 'editor' ? 'dashboard' : 'editor'))}
                className={`inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-bold rounded-lg shadow-sm transition active:scale-[0.98] ${
                  view === 'dashboard'
                    ? 'bg-slate-900 hover:bg-slate-800 text-white'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 hover:border-slate-400'
                }`}
              >
                <FaChartLine className="text-yadea-orange" />
                {view === 'editor' ? 'Invoice Dashboard' : 'Back to Editor'}
              </button>
              {view === 'editor' && (
                <>
                  <button
                    type="button"
                    onClick={handleNew}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg border border-slate-300 hover:border-slate-400 shadow-sm transition active:scale-[0.98]"
                  >
                    <FaPlus className="text-[10px]" /> New
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!canEdit || saving}
                    title={canEdit ? 'Save invoice to database' : 'You do not have edit permission'}
                    className="inline-flex items-center gap-1.5 h-9 px-4 bg-yadea-orange hover:bg-yadea-dark text-white text-xs font-bold rounded-lg shadow-sm shadow-yadea-orange/40 transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    <FaFloppyDisk className={saving ? 'animate-pulse' : ''} />
                    {saving ? 'Saving...' : editingId !== null ? 'Update' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg border border-slate-300 hover:border-slate-400 shadow-sm transition active:scale-[0.98]"
                  >
                    <FaPrint /> Print
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadPdf()}
                    disabled={!canExport || pdfBusy}
                    title={canExport ? 'Download as PDF' : 'You do not have export permission'}
                    className="inline-flex items-center gap-1.5 h-9 px-4 bg-yadea-black hover:bg-slate-800 text-white text-xs font-bold rounded-lg shadow-sm transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FaFilePdf className={`text-yadea-orange ${pdfBusy ? 'animate-pulse' : ''}`} />
                    {pdfBusy ? 'Preparing...' : 'Download PDF'}
                  </button>
                  {amountOverridden && (
                    <button
                      type="button"
                      onClick={resetAmounts}
                      title="Clear the manual totals and calculate Value Excl. / Sales Tax / Total from the line values again"
                      className="inv-editable-hint"
                    >
                      <FaRotateRight className="text-[10px]" />
                      Totals are set manually — reset
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {view === 'dashboard' ? (
            /* --------------------- Invoice Dashboard --------------------- */
            <div className="space-y-4">
              {/* Summary stat cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-yadea-orange/10 text-yadea-dark flex items-center justify-center shrink-0">
                    <FaFileInvoice />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Invoices</div>
                    <div className="text-xl font-black text-slate-900">{loadingList ? '...' : dashCount}</div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-yadea-orange/10 text-yadea-dark flex items-center justify-center shrink-0">
                    <FaChartLine />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Total Sales</div>
                    <div className="text-xl font-black text-slate-900 truncate">
                      Rs {loadingList ? '...' : formatMoney(dashRevenue)}
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-yadea-orange/10 text-yadea-dark flex items-center justify-center shrink-0">
                    <FaMotorcycle />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Bikes Sold</div>
                    <div className="text-xl font-black text-slate-900">{loadingList ? '...' : dashUnits}</div>
                  </div>
                </div>
              </div>

              {/* Filters bar */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center gap-2">
                {INVOICE_RANGES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setRangeKey(r.key)}
                    className={`h-7 px-3 rounded-full text-[11px] font-bold transition active:scale-[0.97] ${
                      rangeKey === r.key
                        ? 'bg-yadea-orange text-white shadow-sm shadow-yadea-orange/40'
                        : 'bg-slate-50 text-slate-500 border border-slate-200 hover:border-yadea-orange/50 hover:text-yadea-dark'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
                {rangeKey === 'custom' && (
                  <span className="inline-flex flex-wrap items-center gap-1.5 ml-1">
                    <input
                      type="datetime-local"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="h-7 text-[11px] border border-slate-300 rounded-md px-1.5 text-slate-700 focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/30"
                      aria-label="From date and time"
                    />
                    <span className="text-[11px] text-slate-400 font-semibold">to</span>
                    <input
                      type="datetime-local"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="h-7 text-[11px] border border-slate-300 rounded-md px-1.5 text-slate-700 focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/30"
                      aria-label="To date and time"
                    />
                    {(customFrom || customTo) && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomFrom('');
                          setCustomTo('');
                        }}
                        className="h-7 px-2 rounded-md text-[10px] font-bold text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                      >
                        Clear
                      </button>
                    )}
                  </span>
                )}
                <div className="relative ml-auto">
                  <FaMagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]" />
                  <input
                    type="text"
                    placeholder="Search customer, model, #no..."
                    value={dashSearch}
                    onChange={(e) => setDashSearch(e.target.value)}
                    className="h-7 w-full sm:w-56 bg-slate-50 border border-slate-200 rounded-full pl-8 pr-3 text-[11px] focus:outline-none focus:border-yadea-orange focus:ring-1 focus:ring-yadea-orange/40"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void loadInvoices()}
                  className="w-7 h-7 rounded-full bg-slate-50 border border-slate-200 text-slate-400 hover:text-yadea-orange hover:border-yadea-orange/50 transition flex items-center justify-center shrink-0"
                  aria-label="Refresh history"
                  title="Refresh"
                >
                  <FaRotateRight className="text-[11px]" />
                </button>
              </div>

              {/* Model-wise sales summary */}
              {!loadingList && modelSummary.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-2.5">
                    Model-wise Sales
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {modelSummary.map((m) => (
                      <span
                        key={m.model}
                        className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[11px]"
                      >
                        <b className="text-slate-800">{m.model}</b>
                        <span className="text-slate-300">|</span>
                        <span className="text-slate-500">
                          {m.units} unit{m.units === 1 ? '' : 's'}
                        </span>
                        <span className="font-extrabold text-yadea-dark">Rs {formatMoney(m.revenue)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Invoice history table */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    Invoice History
                    <span className="text-[10px] bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded font-bold">
                      {loadingList ? '...' : dashCount}
                    </span>
                  </h3>
                  <span className="text-xs font-extrabold text-yadea-dark whitespace-nowrap">
                    Rs {formatMoney(dashRevenue)}
                  </span>
                </div>
                <div className="overflow-x-auto inv-scroll-y">
                  <table className="w-full text-xs min-w-[760px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 bg-slate-50/70 border-b border-slate-200">
                        <th className="py-2.5 pl-4 pr-3 font-extrabold">Date &amp; Day</th>
                        <th className="py-2.5 pr-3 font-extrabold">Invoice#</th>
                        <th className="py-2.5 pr-3 font-extrabold">Customer</th>
                        <th className="py-2.5 pr-3 font-extrabold">Bike Model</th>
                        <th className="py-2.5 pr-3 font-extrabold text-center">Qty</th>
                        <th className="py-2.5 pr-3 font-extrabold text-right">Price (Incl. Tax)</th>
                        <th className="py-2.5 pr-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {loadingList ? (
                        <tr>
                          <td colSpan={7} className="text-center text-slate-400 py-8">
                            Loading invoices...
                          </td>
                        </tr>
                      ) : dashCount === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-10">
                            <FaFileInvoice className="text-3xl text-slate-200 mx-auto mb-2" />
                            <p className="text-slate-400 text-[11px]">
                              No invoices found for this filter.
                            </p>
                          </td>
                        </tr>
                      ) : (
                        filteredInvoices.map((inv) => {
                          const d = parseDMY(inv.dated);
                          return (
                            <tr
                              key={inv.id}
                              onClick={() => openInvoiceInEditor(inv)}
                              className={`border-b border-slate-50 last:border-0 cursor-pointer transition hover:bg-yadea-orange/[0.04] ${
                                editingId === inv.id ? 'bg-yadea-orange/[0.06]' : ''
                              }`}
                              title="Open in editor"
                            >
                              <td className="py-2.5 pl-4 pr-3">
                                <div className="font-bold text-slate-800 whitespace-nowrap">{inv.dated || '-'}</div>
                                <div className="text-[10px] text-slate-400">
                                  {d ? DAY_NAMES[d.getDay()] : 'Unknown day'}
                                </div>
                              </td>
                              <td className="py-2.5 pr-3 font-mono font-extrabold text-green-800 whitespace-nowrap">
                                #{inv.invoice_no}
                              </td>
                              <td className="py-2.5 pr-3 font-bold text-slate-800 max-w-[190px] truncate">
                                {inv.customer_name || 'Unnamed customer'}
                              </td>
                              <td className="py-2.5 pr-3 text-slate-600 max-w-[190px] truncate">
                                {inv.motorcycle || '-'}
                              </td>
                              <td className="py-2.5 pr-3 text-center font-semibold text-slate-700">{inv.qty}</td>
                              <td className="py-2.5 pr-3 text-right font-extrabold text-yadea-dark whitespace-nowrap">
                                Rs {formatMoney(Number(inv.value_incl) || 0)}
                              </td>
                              <td
                                className="py-2.5 pr-4 text-right whitespace-nowrap"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDelete(inv)}
                                    className="text-slate-300 hover:text-red-600 transition p-1.5 rounded-md hover:bg-red-50"
                                    aria-label={`Delete invoice ${inv.invoice_no}`}
                                    title="Delete"
                                  >
                                    <FaRegTrashCan className="text-xs" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* ---------------------- Entry panel ---------------------- */}
            <div className="lg:col-span-4 flex flex-col gap-4">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                <h2 className="text-sm font-bold text-slate-800 mb-3 pb-2 border-b border-slate-100 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <FaFileInvoice className="text-yadea-orange" /> Invoice Entry
                  </span>
                  <span className="text-[10px] bg-yadea-orange/10 text-yadea-dark border border-yadea-orange/25 px-2 py-0.5 rounded font-bold">
                    Live Preview
                  </span>
                </h2>

                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="block font-semibold text-slate-700 mb-1">Invoice No</span>
                      <input
                        type="text"
                        value={form.invoiceNo}
                        onChange={setField('invoiceNo')}
                        className="w-full p-2 border border-slate-300 rounded font-mono font-bold text-slate-800 focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                      />
                    </label>
                    <label className="block">
                      <span className="block font-semibold text-slate-700 mb-1">Dated</span>
                      <input
                        type="text"
                        placeholder="DD/MM/YYYY"
                        value={form.dated}
                        onChange={setField('dated')}
                        className="w-full p-2 border border-slate-300 rounded focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="block font-semibold text-slate-700 mb-1">STRN Number</span>
                    <input
                      type="text"
                      value={form.strn}
                      onChange={setField('strn')}
                      className="w-full p-2 border border-slate-300 rounded font-mono focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                    />
                  </label>

                  <label className="block">
                    <span className="block font-semibold text-slate-700 mb-1">Customer / M/S</span>
                    <input
                      type="text"
                      placeholder="Customer or company name"
                      value={form.ms}
                      onChange={setField('ms')}
                      className="w-full p-2 border border-slate-300 rounded font-semibold focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                    />
                  </label>

                  <div className="pt-2 border-t border-slate-100">
                    <span className="font-bold text-slate-900 block mb-2 uppercase tracking-wide text-[11px]">
                      Vehicle Specifications
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="block text-slate-600 mb-1">Quantity (Qty)</span>
                        <input
                          type="number"
                          min={1}
                          value={form.qty}
                          onChange={setField('qty')}
                          className="w-full p-2 border border-slate-300 rounded font-bold focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-slate-600 mb-1">Motorcycle</span>
                        <input
                          type="text"
                          placeholder="Yadea T9 Scooter"
                          value={form.motorcycle}
                          onChange={setField('motorcycle')}
                          className="w-full p-2 border border-slate-300 rounded focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <label className="block">
                        <span className="block text-slate-600 mb-1">M/Year</span>
                        <input
                          type="text"
                          placeholder="2026"
                          value={form.year}
                          onChange={setField('year')}
                          className="w-full p-2 border border-slate-300 rounded focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-slate-600 mb-1">Colour</span>
                        <input
                          type="text"
                          placeholder="Metallic Grey"
                          value={form.color}
                          onChange={setField('color')}
                          className="w-full p-2 border border-slate-300 rounded focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <label className="block">
                        <span className="block text-slate-600 mb-1">Engine#</span>
                        <input
                          type="text"
                          value={form.engine}
                          onChange={setField('engine')}
                          className="w-full p-2 border border-slate-300 rounded font-mono text-[11px] focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-slate-600 mb-1">Chasis</span>
                        <input
                          type="text"
                          value={form.chassis}
                          onChange={setField('chassis')}
                          className="w-full p-2 border border-slate-300 rounded font-mono text-[11px] focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100">
                    <span className="font-bold text-slate-900 block mb-2 uppercase tracking-wide text-[11px]">
                      Sales Tax Calculation
                    </span>
                    <label className="block">
                      <span className="block text-slate-600 mb-1 font-semibold">
                        Value Excluding Sales Tax (PKR)
                      </span>
                      <input
                        type="number"
                        step="1"
                        placeholder="e.g. 245000"
                        value={form.valueExcl}
                        onChange={setField('valueExcl')}
                        className="w-full p-2 border border-slate-300 rounded font-bold text-sm text-slate-800 focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <label className="block">
                        <span className="block text-slate-600 mb-1">Rate Of Sales Tax (%)</span>
                        <input
                          type="number"
                          step="0.5"
                          value={form.taxRate}
                          onChange={setField('taxRate')}
                          className="w-full p-2 border border-slate-300 rounded font-semibold focus:border-yadea-orange focus:outline-none focus:ring-1 focus:ring-yadea-orange/40"
                        />
                      </label>
                      <div>
                        <span className="block text-slate-600 mb-1">Sales Tax Payable</span>
                        <div className="w-full p-2 bg-slate-50 border border-slate-200 rounded font-semibold text-slate-700 text-right">
                          {formatMoney(taxPayable)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 bg-yadea-orange/10 p-2.5 rounded-lg border border-yadea-orange/25">
                      <span className="block text-yadea-dark mb-1 text-[11px] font-bold">
                        Total Value Including Sales Tax
                      </span>
                      <div className="w-full p-2 bg-white border border-yadea-orange rounded font-black text-yadea-dark text-base text-right">
                        Rs {formatMoney(totalIncl)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Saved invoices live in the Invoice Dashboard (top button). */}
              <div className="bg-yadea-orange/[0.06] border border-yadea-orange/20 rounded-xl p-4 text-xs">
                <div className="font-bold text-slate-800 flex items-center gap-2 mb-1">
                  <FaChartLine className="text-yadea-orange" /> Looking for saved invoices?
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Open the <button type="button" onClick={() => setView('dashboard')} className="font-bold text-yadea-dark underline underline-offset-2 hover:text-yadea-orange">Invoice Dashboard</button> from
                  the top bar to browse full history with date filters and prices.
                </p>
              </div>

              {/* ------------------ Design Studio ------------------ */}
              <div className="inv-no-print bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden order-first">
                <button
                  type="button"
                  onClick={() => setDesignOpen((v) => !v)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-slate-800 hover:bg-slate-50 transition"
                >
                  <span className="flex items-center gap-2">
                    <FaPalette className="text-yadea-orange" /> Design Studio
                  </span>
                  <span className="text-[10px] font-medium text-slate-400">
                    {designOpen ? 'Hide' : 'Colours · Layout · Sections'}
                  </span>
                </button>

                {designOpen && (
                  <div className="px-4 pb-4 pt-1 space-y-4 text-[11px] border-t border-slate-100">
                    {/* Colours */}
                    <div className="space-y-2">
                      <p className="font-extrabold uppercase tracking-wider text-slate-500">Colours</p>
                      {(
                        [
                          ['accentColor', 'Accent / Title'],
                          ['darkColor', 'Dark / Navy'],
                          ['brandTextColor', 'YADEA Text'],
                        ] as const
                      ).map(([key, label]) => (
                        <div key={key} className="flex items-center justify-between gap-2">
                          <span className="text-slate-600 font-semibold">{label}</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={design[key]}
                              onChange={(e) => updDesign({ [key]: e.target.value } as Partial<InvoiceDesign>)}
                              className="h-7 w-9 rounded border border-slate-200 cursor-pointer p-0.5"
                              aria-label={label}
                            />
                            <input
                              type="text"
                              value={design[key]}
                              onChange={(e) => updDesign({ [key]: e.target.value } as Partial<InvoiceDesign>)}
                              className="w-20 font-mono text-[10px] px-1.5 py-1 border border-slate-200 rounded"
                              aria-label={`${label} hex`}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Layout */}
                    <div className="space-y-2">
                      <p className="font-extrabold uppercase tracking-wider text-slate-500">Layout</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-600 font-semibold">Logo block</span>
                        <div className="flex rounded-md overflow-hidden border border-slate-200">
                          {(['left', 'right'] as const).map((side) => (
                            <button
                              key={side}
                              type="button"
                              onClick={() => updDesign({ logoSide: side })}
                              className={`px-3 py-1 font-bold capitalize transition ${
                                design.logoSide === side
                                  ? 'bg-yadea-orange text-white'
                                  : 'bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {side}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-600 font-semibold">Title align</span>
                        <div className="flex rounded-md overflow-hidden border border-slate-200">
                          {(['left', 'right'] as const).map((align) => (
                            <button
                              key={align}
                              type="button"
                              onClick={() => updDesign({ titleAlign: align })}
                              className={`px-3 py-1 font-bold capitalize transition ${
                                design.titleAlign === align
                                  ? 'bg-yadea-orange text-white'
                                  : 'bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {align}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-600 font-semibold">Pill header</span>
                        <div className="flex rounded-md overflow-hidden border border-slate-200">
                          <button
                            type="button"
                            onClick={() => updDesign({ pillRound: true })}
                            className={`px-3 py-1 font-bold transition ${
                              design.pillRound ? 'bg-yadea-orange text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            Round
                          </button>
                          <button
                            type="button"
                            onClick={() => updDesign({ pillRound: false })}
                            className={`px-3 py-1 font-bold transition ${
                              !design.pillRound ? 'bg-yadea-orange text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            Square
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Sizes */}
                    <div className="space-y-2">
                      <p className="font-extrabold uppercase tracking-wider text-slate-500">Sizes</p>
                      {(
                        [
                          ['brandTextSize', 'YADEA text', 14, 44],
                          ['iconSize', 'Logo icon', 20, 60],
                          ['headerHeight', 'Header height', 150, 280],
                        ] as const
                      ).map(([key, label, min, max]) => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-slate-600 font-semibold w-24 shrink-0">{label}</span>
                          <input
                            type="range"
                            min={min}
                            max={max}
                            value={design[key]}
                            onChange={(e) => updDesign({ [key]: Number(e.target.value) } as Partial<InvoiceDesign>)}
                            className="flex-1 accent-yadea-orange cursor-pointer"
                            aria-label={label}
                          />
                          <span className="w-8 text-right font-mono text-[10px] text-slate-500">{design[key]}</span>
                        </div>
                      ))}
                    </div>

                    {/* Sections */}
                    <div className="space-y-2">
                      <p className="font-extrabold uppercase tracking-wider text-slate-500">Sections</p>
                      {(
                        [
                          ['showWaves', 'Footer waves'],
                          ['showTerms', 'Terms & conditions'],
                          ['showSignature', 'Signature row'],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="flex items-center justify-between cursor-pointer">
                          <span className="text-slate-600 font-semibold">{label}</span>
                          <input
                            type="checkbox"
                            checked={design[key]}
                            onChange={(e) => updDesign({ [key]: e.target.checked } as Partial<InvoiceDesign>)}
                            className="w-4 h-4 accent-yadea-orange cursor-pointer"
                          />
                        </label>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setDesign(DEFAULT_DESIGN)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 hover:text-yadea-dark transition"
                    >
                      <FaRotateRight className="text-[10px]" /> Reset design
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-slate-900 text-slate-300 rounded-xl p-4 text-xs space-y-1.5 shadow-sm">
                <div className="font-bold text-white flex items-center gap-1.5">
                  <FaCircleInfo className="text-yadea-orange text-sm" /> Live Interactive Editor
                </div>
                <p className="leading-relaxed">
                  Fill the form above or type directly on any dotted line inside the document
                  preview - both stay in sync. Press Save to persist the invoice to the database.
                </p>
              </div>
            </div>

            {/* -------------------- Document canvas -------------------- */}
            <div className="lg:col-span-8">
              <div className="inv-scroll-host flex justify-start md:justify-center items-start overflow-x-auto pb-6 preview-x">
                <div className="w-full min-w-[640px] max-w-[780px] px-0.5">
                  <div
                    ref={docRef}
                    onClick={() => setSel(null)}
                    className="inv-page bg-white shadow-xl shadow-slate-900/10 rounded-2xl text-slate-900 relative flex flex-col justify-between overflow-hidden ring-1 ring-slate-200 w-full"
                    style={{ minHeight: 1050, fontFamily: "'Poppins', 'Segoe UI', sans-serif" }}
                  >
                    <div>
                      {/* Header: curved vectors + brand lockup + title block.
                          Colours, sides and sizes come from the Design Studio. */}
                      <div className="relative w-full overflow-hidden" style={{ height: design.headerHeight }}>
                        <svg
                          className="absolute top-0 right-0 pointer-events-none"
                          style={{ width: 600, height: design.headerHeight + 10 }}
                          viewBox="0 0 600 220"
                          preserveAspectRatio="none"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          {/* Top accent shape */}
                          <path d="M 120 0 C 170 100, 260 130, 360 0 Z" fill={design.accentColor} />
                          {/* Dark wave overlay */}
                          <path
                            d="M 160 0 C 200 110, 280 180, 440 170 C 510 165, 550 145, 600 130 L 600 0 Z"
                            fill={design.darkColor}
                          />
                          {/* Accent swoosh under the dark curve */}
                          <path
                            d="M 330 170 C 430 215, 530 205, 600 150 L 600 130 C 550 145, 510 165, 440 170 C 390 170, 350 170, 330 170 Z"
                            fill={design.accentColor}
                          />
                        </svg>

                        <div className="relative z-10 px-6 sm:px-7 pt-5 pb-4 flex justify-between items-start gap-5">
                          {design.logoSide === 'left' && lockupEl}
                          {titleEl}
                          {design.logoSide === 'right' && lockupEl}
                        </div>
                      </div>

                      {/* Buyer / seller / quick-summary columns */}
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setSel('infoCols');
                        }}
                        className={`relative px-8 sm:px-9 mt-3 grid grid-cols-12 gap-2 text-xs leading-snug ${
                          sel === 'infoCols' ? 'inv-selected' : ''
                        }`}
                        style={{
                          transform: `translate(${elO('infoCols').x}px, ${elO('infoCols').y}px)`,
                            textAlign: elO('infoCols').align ?? undefined,
                          transition: dragState.current ? 'none' : 'transform .08s ease-out',
                        }}
                      >
                        <Handles id="infoCols" />
                        {/* Column 1: buyer */}
                        <div className="col-span-4 pr-2">
                          <h3
                            className="font-extrabold text-[13px] mb-1"
                            style={{ color: elO('infoCols').colorA || '#0f172a' }}
                          >
                            <EditableText
                              value={txt('labelInvoiceTo')}
                              onChange={(v) => setTxt('labelInvoiceTo', v)}
                              ariaLabel="Buyer column heading"
                            />
                          </h3>
                          <input
                            type="text"
                            placeholder="Customer Name / Buyer Name"
                            value={form.ms}
                            onChange={setField('ms')}
                            className="inv-underlined w-full font-bold text-slate-800 px-0.5 py-0.5"
                            aria-label="Customer name"
                          />
                        </div>

                        {/* Column 2: seller */}
                        <div className="col-span-4 px-3 border-l-2 border-slate-700">
                          <h3
                            className="font-extrabold text-[13px] mb-1"
                            style={{ color: elO('infoCols').colorA || '#0f172a' }}
                          >
                            <EditableText
                              value={txt('labelInvoiceFrom')}
                              onChange={(v) => setTxt('labelInvoiceFrom', v)}
                              ariaLabel="Seller column heading"
                            />
                          </h3>
                          <p className="font-bold text-slate-800">
                            <EditableText
                              value={txt('sellerName')}
                              onChange={(v) => setTxt('sellerName', v)}
                              ariaLabel="Seller name"
                            />
                          </p>
                          <input
                            type="text"
                            placeholder="Shop address"
                            value={form.address}
                            onChange={setField('address')}
                            className="inv-underlined w-full text-slate-700 font-medium leading-tight px-0.5 py-0.5 mb-0.5"
                            aria-label="Seller address"
                          />
                          <p className="text-slate-700 font-bold flex items-center gap-1 flex-wrap">
                            <span>
                              <EditableText
                                value={txt('labelStrn')}
                                onChange={(v) => setTxt('labelStrn', v)}
                                ariaLabel="STRN label"
                              />
                            </span>
                            <input
                              type="text"
                              value={form.strn}
                              onChange={setField('strn')}
                              className="inv-bare font-mono text-slate-900 font-semibold w-28 bg-transparent"
                              aria-label="STRN number"
                            />
                          </p>
                        </div>

                        {/* Column 3: live amounts summary */}
                        <div className="col-span-4 pl-3 border-l-2 border-slate-700 flex flex-col justify-start space-y-1">
                          <div className="flex justify-between items-center pr-1 gap-2">
                            <span className="font-extrabold text-slate-900">
                              <EditableText
                                value={txt('labelValueExclTax')}
                                onChange={(v) => setTxt('labelValueExclTax', v)}
                                ariaLabel="Value excluding tax label"
                              />
                            </span>
                            {moneyNode('totalExcl', totalExcl, calcTotalExcl, 'font-semibold text-slate-800', 'Value excluding tax')}
                          </div>
                          <div className="flex justify-between items-center pr-1 gap-2">
                            <span className="font-extrabold text-slate-900">
                              <EditableText
                                value={txt('labelTaxRate')}
                                onChange={(v) => setTxt('labelTaxRate', v)}
                                ariaLabel="Sales tax rate label"
                              />
                            </span>
                            <span className="font-semibold text-slate-800 whitespace-nowrap flex items-baseline justify-end gap-0.5">
                              <EditableText
                                value={`${form.taxRate || 0}`}
                                onChange={(v) => setForm((f) => ({ ...f, taxRate: v }))}
                                ariaLabel="Sales tax rate (click to edit)"
                                title="Click to type a different rate, e.g. 18"
                              />
                              %
                            </span>
                          </div>
                          <div className="flex justify-between items-center pr-1 gap-2">
                            <span className="font-extrabold text-slate-900">
                              <EditableText
                                value={txt('labelTotalInclTax')}
                                onChange={(v) => setTxt('labelTotalInclTax', v)}
                                ariaLabel="Total including tax label"
                              />
                            </span>
                            {moneyNode('totalIncl', totalIncl, calcTotalIncl, 'font-semibold text-slate-800', 'Total including tax')}
                          </div>
                        </div>
                      </div>

                        {/* Items table: pill header + accent row rules */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setSel('itemsTable');
                          }}
                          className={`relative px-8 sm:px-9 mt-7 ${sel === 'itemsTable' ? 'inv-selected' : ''}`}
                          style={{
                            transform: `translate(${elO('itemsTable').x}px, ${elO('itemsTable').y}px)`,
                            transition: dragState.current ? 'none' : 'transform .08s ease-out',
                          }}
                        >
                          <Handles id="itemsTable" />
                          <div
                            className={`${
                              design.pillRound ? 'rounded-full' : 'rounded-lg'
                            } text-white px-6 py-2.5 flex items-center text-[10px] sm:text-[11px] font-extrabold tracking-wider uppercase`}
                            style={{ backgroundColor: elO('itemsTable').colorA ?? design.darkColor }}
                          >
                            <div className="w-[8%] text-center px-1">
                              <EditableText
                                value={txt('thQty')}
                                onChange={(v) => setTxt('thQty', v)}
                                ariaLabel="Quantity column heading"
                              />
                            </div>
                            <div className="w-[36%] pl-2 text-left px-1">
                              <EditableText
                                value={txt('thDescription')}
                                onChange={(v) => setTxt('thDescription', v)}
                                ariaLabel="Description column heading"
                              />
                            </div>
                            <div className="w-[14%] text-center px-1">
                              <EditableText
                                value={txt('thValueExcl')}
                                onChange={(v) => setTxt('thValueExcl', v)}
                                ariaLabel="Value excluding sales tax column heading"
                              />
                            </div>
                            <div className="w-[12%] text-center px-1">
                              <EditableText
                                value={txt('thTaxRate')}
                                onChange={(v) => setTxt('thTaxRate', v)}
                                ariaLabel="Tax rate column heading"
                              />
                            </div>
                            <div className="w-[14%] text-right px-1 pr-1">
                              <EditableText
                                value={txt('thSalesTaxPayable')}
                                onChange={(v) => setTxt('thSalesTaxPayable', v)}
                                ariaLabel="Sales tax payable column heading"
                              />
                            </div>
                            <div className="w-[16%] text-right pr-1 px-1">
                              <EditableText
                                value={txt('thValueIncl')}
                                onChange={(v) => setTxt('thValueIncl', v)}
                                ariaLabel="Value including tax column heading"
                              />
                            </div>
                          </div>

                          <div className="text-xs sm:text-sm font-bold text-slate-900">
                            {/* Item row */}
                            <div
                              className="py-3 px-6 flex items-start justify-between border-b-2"
                              style={{ borderColor: elO('itemsTable').colorB ?? design.accentColor }}
                            >
                              <div className="w-[8%] text-center pt-3">
                                <input
                                  type="text"
                                  value={form.qty}
                                  onChange={setField('qty')}
                                  className="inv-bare w-full text-center font-bold bg-transparent"
                                  aria-label="Quantity"
                                />
                              </div>
                              <div className="w-[36%] px-2 space-y-3 text-xs">
                                {DESC_ROWS.map((row) => (
                                  <div key={row.key} className="flex items-center gap-1">
                                    <span className="w-20 font-bold text-slate-900 shrink-0">
                                      <EditableText
                                        value={txt(row.textKey)}
                                        onChange={(v) => setTxt(row.textKey, v)}
                                        ariaLabel={`${row.textKey} label`}
                                      />
                                    </span>
                                    <input
                                      type="text"
                                      placeholder={row.placeholder}
                                      value={form[row.key]}
                                      onChange={setField(row.key)}
                                      className="inv-dotted flex-1 px-1 py-0 font-medium"
                                      aria-label={row.textKey}
                                    />
                                  </div>
                                ))}
                              </div>
                              <div className="w-[14%] text-right pt-3 px-1">
                                <input
                                  type="text"
                                  placeholder="0.00"
                                  value={form.valueExcl}
                                  onChange={setField('valueExcl')}
                                  className="inv-bare w-full text-right font-bold bg-transparent"
                                  aria-label="Value excluding sales tax"
                                />
                              </div>
                              <div className="w-[12%] text-center pt-3 px-1">
                                <input
                                  type="text"
                                  placeholder="18%"
                                  value={form.taxRate}
                                  onChange={setField('taxRate')}
                                  className="inv-bare w-full text-center font-bold bg-transparent"
                                  aria-label="Rate of sales tax"
                                />
                              </div>
                              <div className="w-[14%] text-right pt-3 px-1">
                                {moneyNode('taxPayable', taxPayable, calcTaxPayable, 'font-bold', 'Sales tax payable')}
                              </div>
                              <div className="w-[16%] text-right pt-3 px-1 pr-1 font-black">
                                {moneyNode('totalIncl', totalIncl, calcTotalIncl, 'font-black', 'Value including tax')}
                              </div>
                            </div>

                            {/* Total row */}
                            <div
                              className="py-2.5 px-6 flex items-center justify-between border-b-2"
                              style={{ borderColor: elO('itemsTable').colorB ?? design.accentColor }}
                            >
                              <div className="w-[44%] text-left font-extrabold tracking-wide px-1">
                                <EditableText
                                  value={txt('rowTotal')}
                                  onChange={(v) => setTxt('rowTotal', v)}
                                  ariaLabel="Total row label"
                                />
                              </div>
                              <div className="w-[14%] text-right font-extrabold px-1">
                                {moneyNode('totalExcl', totalExcl, calcTotalExcl, 'font-extrabold', 'Total value excluding tax')}
                              </div>
                              <div className="w-[12%] text-center" />
                              <div className="w-[14%] text-right font-extrabold px-1">
                                {moneyNode('taxPayable', taxPayable, calcTaxPayable, 'font-extrabold', 'Total sales tax payable')}
                              </div>
                              <div
                                className="w-[16%] text-right pr-1 font-black text-base px-1"
                                style={{ color: elO('itemsTable').colorB ?? design.accentColor }}
                              >
                                {moneyNode('totalIncl', totalIncl, calcTotalIncl, 'font-black text-base', 'Total value including tax')}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Terms & conditions + totals summary */}
                        <div className="px-8 sm:px-9 mt-9 grid grid-cols-12 gap-4 items-start">
                          {design.showTerms && (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                setSel('termsBlock');
                              }}
                              className={`relative col-span-7 pr-2 text-xs ${sel === 'termsBlock' ? 'inv-selected' : ''}`}
                              style={{
                                color: elO('termsBlock').colorA || undefined,
                                transform: `translate(${elO('termsBlock').x}px, ${elO('termsBlock').y}px)`,
                                  textAlign: elO('termsBlock').align ?? undefined,
                                transition: dragState.current ? 'none' : 'transform .08s ease-out',
                              }}
                            >
                              <Handles id="termsBlock" />
                              <h4
                                className="font-extrabold text-[13px] mb-2"
                                style={{ color: elO('termsBlock').colorA || '#0f172a' }}
                              >
                                <EditableText
                                  value={txt('labelTermsHeading')}
                                  onChange={(v) => setTxt('labelTermsHeading', v)}
                                  ariaLabel="Terms heading"
                                />
                              </h4>
                              <ol className="space-y-1 font-semibold text-slate-700 leading-relaxed list-none p-0 m-0">
                                <li className="flex gap-1.5">
                                  <span className="shrink-0">
                                    <EditableText
                                      value={txt('term1Num')}
                                      onChange={(v) => setTxt('term1Num', v)}
                                      ariaLabel="Term 1 number"
                                    />
                                  </span>
                                  <span className="flex-1">
                                    <EditableText
                                      value={txt('term1')}
                                      onChange={(v) => setTxt('term1', v)}
                                      ariaLabel="Term 1"
                                    />
                                  </span>
                                </li>
                                <li className="flex gap-1.5">
                                  <span className="shrink-0">
                                    <EditableText
                                      value={txt('term2Num')}
                                      onChange={(v) => setTxt('term2Num', v)}
                                      ariaLabel="Term 2 number"
                                    />
                                  </span>
                                  <span className="flex-1">
                                    <EditableText
                                      value={txt('term2')}
                                      onChange={(v) => setTxt('term2', v)}
                                      ariaLabel="Term 2"
                                    />
                                  </span>
                                </li>
                              </ol>
                            </div>
                          )}

                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setSel('totalsBlock');
                            }}
                            className={`relative ml-auto w-full max-w-[270px] space-y-1.5 text-xs sm:text-[13px] font-extrabold text-slate-900 ${
                              design.showTerms ? 'col-span-5' : 'col-span-12'
                            } ${sel === 'totalsBlock' ? 'inv-selected' : ''}`}
                            style={{
                              transform: `translate(${elO('totalsBlock').x}px, ${elO('totalsBlock').y}px)`,
                                textAlign: elO('totalsBlock').align ?? undefined,
                              transition: dragState.current ? 'none' : 'transform .08s ease-out',
                            }}
                          >
                            <Handles id="totalsBlock" />
                            <div className="flex justify-between items-center px-1 gap-2">
                              <span>
                                <EditableText
                                  value={txt('labelTotalsValueExcl')}
                                  onChange={(v) => setTxt('labelTotalsValueExcl', v)}
                                  ariaLabel="Totals value excluding tax label"
                                />
                              </span>
                              <span className="flex items-baseline justify-end whitespace-nowrap">
                                {currencyEl}{' '}
                                {moneyNode(
                                  'totalExcl',
                                  totalExcl,
                                  calcTotalExcl,
                                  'text-right',
                                  'Totals value excluding tax'
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between items-center px-1 gap-2">
                              <span>
                                <EditableText
                                  value={txt('labelTotalsTaxPayable')}
                                  onChange={(v) => setTxt('labelTotalsTaxPayable', v)}
                                  ariaLabel="Totals sales tax payable label"
                                />
                              </span>
                              <span className="flex items-baseline justify-end whitespace-nowrap">
                                {currencyEl}{' '}
                                {moneyNode(
                                  'taxPayable',
                                  taxPayable,
                                  calcTaxPayable,
                                  'text-right',
                                  'Totals sales tax payable'
                                )}
                              </span>
                            </div>
                            <div className="pt-2">
                              <div
                                className="rounded-full overflow-hidden flex items-center justify-between p-1 shadow-sm text-white"
                                style={{ backgroundColor: elO('totalsBlock').colorA ?? design.darkColor }}
                              >
                                <div
                                  className="px-3.5 py-1 rounded-full text-[10px] sm:text-xs uppercase tracking-wider"
                                  style={{ backgroundColor: elO('totalsBlock').colorB ?? design.accentColor }}
                                >
                                  <EditableText
                                    value={txt('labelTotalPayable')}
                                    onChange={(v) => setTxt('labelTotalPayable', v)}
                                    ariaLabel="Total payable label"
                                  />
                                </div>
                                <div className="pr-3 flex items-baseline justify-end tracking-wide text-xs sm:text-sm font-black whitespace-nowrap">
                                  {currencyEl}{' '}
                                  {moneyNode(
                                    'totalIncl',
                                    totalIncl,
                                    calcTotalIncl,
                                    'text-right font-black',
                                    'Total payable'
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {design.showSignature && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setSel('signature');
                          }}
                          className={`relative px-8 sm:px-9 mt-10 flex justify-between items-end z-10 ${
                            sel === 'signature' ? 'inv-selected' : ''
                          }`}
                          style={{
                            transform: `translate(${elO('signature').x}px, ${elO('signature').y}px)`,
                              textAlign: elO('signature').align ?? undefined,
                            transition: dragState.current ? 'none' : 'transform .08s ease-out',
                          }}
                        >
                          <Handles id="signature" />
                          <div className="text-left pb-1">
                            <p className="text-xs font-semibold text-slate-700 italic mb-0.5">
                              <EditableText
                                value={txt('labelForOnBehalfOf')}
                                onChange={(v) => setTxt('labelForOnBehalfOf', v)}
                                ariaLabel="Signature company prefix"
                              />
                            </p>
                            <h3
                              className="text-base md:text-lg font-black tracking-tight"
                              style={{ color: elO('signature').colorA ?? design.accentColor }}
                            >
                              <EditableText
                                value={txt('signatureName')}
                                onChange={(v) => setTxt('signatureName', v)}
                                ariaLabel="Signature company name"
                              />
                            </h3>
                          </div>
                          <div className="text-center w-48">
                            <div className="border-b-2 border-slate-900 h-10" />
                            <span className="text-xs font-bold text-slate-900 tracking-wider uppercase mt-1 block">
                              <EditableText
                                value={txt('labelSignature')}
                                onChange={(v) => setTxt('labelSignature', v)}
                                ariaLabel="Signature caption"
                              />
                            </span>
                          </div>
                        </div>
                      )}

                      {design.showWaves && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setSel('waves');
                          }}
                          className={`relative w-full overflow-hidden mt-2 ${sel === 'waves' ? 'inv-selected' : ''}`}
                          style={{
                            height: 120,
                            transform: `translate(${elO('waves').x}px, ${elO('waves').y}px) scale(${elO('waves').scale})`,
                            transition: dragState.current ? 'none' : 'transform .08s ease-out',
                          }}
                        >
                          <Handles id="waves" />
                          <svg
                            className="absolute bottom-0 left-0 w-full pointer-events-none"
                            style={{ height: 120 }}
                            viewBox="0 0 800 140"
                            preserveAspectRatio="none"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            {/* Top wave (accent) */}
                            <path d="M 0 55 C 220 135, 480 10, 800 55 L 800 140 L 0 140 Z" fill={elO('waves').colorA ?? design.accentColor} />
                            {/* Foreground bottom wave (dark) */}
                            <path d="M 0 75 C 240 10, 500 125, 800 60 L 800 140 L 0 140 Z" fill={elO('waves').colorB ?? design.darkColor} />
                          </svg>
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}
        </div>

      {/* Canva-style floating context toolbar for the selected element */}
      {view === 'editor' && sel && REGION_META[sel] && (
        <div className="inv-no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-[95] bg-slate-900 text-white rounded-xl shadow-2xl px-3 py-2 flex items-center gap-3 text-xs flex-wrap justify-center max-w-[92vw]">
          <span className="font-bold whitespace-nowrap">{REGION_META[sel].label}</span>

          <div className="flex items-center gap-1.5">
            {REGION_META[sel].colors.map(([key, label]) => (
              <label key={key} className="flex items-center gap-1 cursor-pointer" title={label}>
                <input
                  type="color"
                  value={elO(sel)[key] ?? design.accentColor}
                  onChange={(e) => setElO(sel, { [key]: e.target.value } as Partial<ElemOverride>)}
                  className="h-6 w-7 rounded cursor-pointer p-0.5 border border-slate-600"
                />
              </label>
            ))}
          </div>

          <div className="flex items-center gap-1 border-l border-slate-700 pl-3">
            <button
              type="button"
              onClick={() =>
                sel === 'titleBlock'
                  ? setElO('titleBlock', { fontSize: Math.max(18, (elO('titleBlock').fontSize ?? 38) - 2) })
                  : setElO(sel, { scale: Math.max(0.55, Math.round((elO(sel).scale - 0.05) * 100) / 100) })
              }
              className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 font-bold transition"
              title="Smaller"
            >
              −
            </button>
            <span className="font-mono text-[10px] w-10 text-center">
              {sel === 'titleBlock'
                ? `${elO('titleBlock').fontSize ?? 38}px`
                : `${Math.round(elO(sel).scale * 100)}%`}
            </span>
            <button
              type="button"
              onClick={() =>
                sel === 'titleBlock'
                  ? setElO('titleBlock', { fontSize: Math.min(72, (elO('titleBlock').fontSize ?? 38) + 2) })
                  : setElO(sel, { scale: Math.min(1.9, Math.round((elO(sel).scale + 0.05) * 100) / 100) })
              }
              className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 font-bold transition"
              title="Bigger"
            >
              +
            </button>
          </div>

          <div className="flex items-center gap-1 border-l border-slate-700 pl-3">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setElO(sel, { align: a })}
                className={`px-2 py-0.5 rounded font-bold transition ${
                  elO(sel).align === a ? 'bg-yadea-orange text-white' : 'bg-slate-700 hover:bg-slate-600'
                }`}
              >
                {a[0].toUpperCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setElO(sel, EMPTY_EL);
              setDesign((d) => {
                const elements = { ...(d.elements ?? {}) };
                delete elements[sel];
                return { ...d, elements };
              });
            }}
            className="flex items-center gap-1 bg-slate-700 hover:bg-red-600 px-2 py-1 rounded transition"
            title="Reset this element"
          >
            <FaRotateRight className="text-[10px]" /> Reset
          </button>

          <button
            type="button"
            onClick={() => setSel(null)}
            className="w-6 h-6 rounded-full bg-slate-700 hover:bg-red-600 font-bold transition"
            title="Deselect (Esc)"
          >
            ×
          </button>
        </div>
      )}
      </div>
    </>
  );
}