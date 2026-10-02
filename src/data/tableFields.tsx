import type { ReactNode } from 'react';
import type { Contact } from '../types';
import type { FilterGroup } from './smartListOptions';
import { getForms, type StoredForm } from './formsStore';
import { getImportColumns } from './importColumnsStore';
import { resolveContactSource } from './contactSource';
import { findCustomValue } from '../utils';
import Avatar from '../components/Avatar';
import Tag from '../components/Tag';
import { FaEnvelope, FaPhone } from 'react-icons/fa6';

export interface TableField {
  id: string;
  label: string;
  group: string | null;
  locked?: boolean;
  render: (c: Contact) => ReactNode;
}

export interface FieldGroup {
  id: string;
  label: string;
}

export const FIELD_GROUPS: FieldGroup[] = [
  { id: 'contact', label: 'Contact' },
  { id: 'general', label: 'General Info' },
  { id: 'additional', label: 'Additional Info' },
  { id: 'activity', label: 'Contact activity' },
];

const firstOf = (c: Contact) => c.name.split(' ').filter(Boolean)[0] ?? '';
const lastOf = (c: Contact) => {
  const parts = c.name.split(' ').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
};

/** Read a built-in field's value from the contact's custom fields / form submissions / imported Excel data. */
const customText = (c: Contact, label: string): string => {
  const v = findCustomValue(c, label);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return (v as unknown[]).map(String).join(', ');
  return '';
};

/* ----------------------- DYNAMIC FORM FIELDS -----------------------
 * One dropdown per form: when a form is submitted it is recorded in
 * formsStore, and every one of its fields becomes an addable table
 * column that shows what the lead filled in.
 * ------------------------------------------------------------------- */

const FORM_GROUP_PREFIX = 'form:';

export function formGroupId(formName: string): string {
  return `${FORM_GROUP_PREFIX}${formName}`;
}

export function formFieldId(formName: string, label: string): string {
  return `${FORM_GROUP_PREFIX}${formName}:${label}`;
}

function formFieldDef(form: StoredForm, label: string): TableField {
  return {
    id: formFieldId(form.name, label),
    label,
    group: formGroupId(form.name),
    render: (c: Contact): string => {
      const subs = c.customFields?.['form_submissions'];
      if (!Array.isArray(subs)) return '';
      const sub = subs.find(
        (s) => !!s && typeof s === 'object' && (s as { formName?: unknown }).formName === form.name
      );
      const values = sub && typeof sub === 'object' ? (sub as { values?: unknown }).values : undefined;
      const v = values && typeof values === 'object' ? (values as Record<string, unknown>)[label] : undefined;
      return typeof v === 'string' ? v : '';
    },
  };
}

function formGroupFor(form: StoredForm): FieldGroup {
  return { id: formGroupId(form.name), label: `Form | ${form.name}` };
}

export function dynamicFormGroups(): FieldGroup[] {
  return getForms().map(formGroupFor);
}

/* ----------------------- IMPORTED EXCEL FIELDS -----------------------
 * Every column present in an uploaded Excel file becomes an addable
 * table column whose value is read from the contact's import_data.
 * -------------------------------------------------------------------- */

const IMPORT_GROUP_ID = 'imported';
const IMPORT_PREFIX = 'import:';

export function importFieldId(label: string): string {
  return `${IMPORT_PREFIX}${label}`;
}

function importFieldDef(label: string): TableField {
  return {
    id: importFieldId(label),
    label,
    group: IMPORT_GROUP_ID,
    render: (c: Contact): string => {
      const data = c.customFields?.['import_data'];
      if (!data || typeof data !== 'object') return '';
      const rec = data as Record<string, unknown>;
      if (typeof rec[label] === 'string') return rec[label];
      const key = Object.keys(rec).find((k) => k.trim().toLowerCase() === label.trim().toLowerCase());
      const v = key ? rec[key] : undefined;
      return typeof v === 'string' ? v : '';
    },
  };
}

export function importedFields(): TableField[] {
  return getImportColumns().filter((c) => !isStaticFieldLabel(c)).map(importFieldDef);
}

export function importedGroup(): FieldGroup | null {
  return getImportColumns().length > 0 ? { id: IMPORT_GROUP_ID, label: 'Imported Fields' } : null;
}

export function allFieldGroups(): FieldGroup[] {
  const groups = [...FIELD_GROUPS, ...dynamicFormGroups()];
  const imp = importedGroup();
  if (imp) groups.push(imp);
  return groups;
}

export const TABLE_FIELDS: Record<string, TableField> = {
  contact_name: {
    id: 'contact_name',
    label: 'Contact name',
    group: null,
    locked: true,
    render: (c) => {
      const list = c.followers ?? [];
      return (
        <div className="flex items-center space-x-1.5">
          <Avatar initials={c.initials} color={c.avatarColor} image={c.image} size="w-5 h-5" />
          <div className="min-w-0 flex items-center gap-1">
            <span className="text-slate-800 group-hover:text-blue-600 truncate text-xs">{c.name}</span>
            {c.ownerAvatar && (
              <img
                src={c.ownerAvatar}
                alt={c.owner}
                title={`Owner: ${c.owner}`}
                className="w-4 h-4 rounded-full object-cover border-2 border-indigo-200 shadow-sm flex-shrink-0"
              />
            )}
            {list.length > 0 && (
              <span className="flex items-center gap-0.5 flex-shrink-0">
                {list.map((f) =>
                  f.avatar_data ? (
                    <img
                      key={f.id}
                      src={f.avatar_data}
                      alt={f.full_name}
                      title={f.full_name}
                      className="w-4 h-4 rounded-full object-cover border border-white shadow-sm flex-shrink-0"
                    />
                  ) : (
                    <span
                      key={f.id}
                      title={f.full_name}
                      className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 text-[7px] font-bold flex items-center justify-center flex-shrink-0"
                    >
                      {(f.first_name[0] ?? '').toUpperCase()}
                      {(f.last_name[0] ?? '').toUpperCase()}
                    </span>
                  )
                )}
              </span>
            )}
          </div>
        </div>
      );
    },
  },
  phone: {
    id: 'phone',
    label: 'Phone',
    group: 'contact',
    render: (c) =>
      c.phone ? (
        <div className="flex items-center space-x-1">
          <FaPhone className="text-slate-400 text-[9px]" />
          <span>{c.phone}</span>
        </div>
      ) : (
        ''
      ),
  },
  email: {
    id: 'email',
    label: 'Email',
    group: 'contact',
    render: (c) =>
      c.email ? (
        <div className="flex items-center space-x-1">
          <FaEnvelope className="text-slate-400 text-[9px]" />
          <span>{c.email}</span>
        </div>
      ) : (
        ''
      ),
  },
  business_name: {
    id: 'business_name',
    label: 'Business name',
    group: 'general',
    render: (c) => c.businessName ?? customText(c, 'Business name'),
  },
  created: {
    id: 'created',
    label: 'Created (PKT)',
    group: 'contact',
    render: (c) => <span className="whitespace-nowrap text-[11px]">{c.createdPkt ?? ''}</span>,
  },
  last_activity: {
    id: 'last_activity',
    label: 'Last activity (PKT)',
    group: 'activity',
    render: (c) => <span className="whitespace-nowrap text-[11px]">{c.lastActivityPkt ?? ''}</span>,
  },
  tags: {
    id: 'tags',
    label: 'Tags',
    group: 'contact',
    render: (c) => (
      <div className="flex items-center space-x-1">
        {(c.tags ?? []).map((tag) => (
          <Tag key={tag} label={tag} />
        ))}
        {c.tagExtraCount !== undefined && (
          <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-medium border border-slate-200">
            +{c.tagExtraCount}
          </span>
        )}
      </div>
    ),
  },
  first_name: { id: 'first_name', label: 'First name', group: 'contact', render: firstOf },
  last_name: { id: 'last_name', label: 'Last name', group: 'contact', render: lastOf },
  date_of_birth: {
    id: 'date_of_birth',
    label: 'Date of birth',
    group: 'contact',
    render: (c) => customText(c, 'Date of birth'),
  },
  contact_source: {
    id: 'contact_source',
    label: 'Contact source',
    group: 'contact',
    // Resolved rather than read by label: the stored key is "source", and
    // leads from a public form carry no stored value at all — it is derived
    // from the submission.
    render: (c) => resolveContactSource(c.customFields).value,
  },
  contact_type: {
    id: 'contact_type',
    label: 'Contact type',
    group: 'contact',
    render: (c) =>
      c.contactType ? (
        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
          {c.contactType}
        </span>
      ) : (
        ''
      ),
  },
  dnd: { id: 'dnd', label: 'DND', group: 'contact', render: () => '' },
  additional_emails: { id: 'additional_emails', label: 'Additional emails', group: 'contact', render: () => '' },
  additional_phones: { id: 'additional_phones', label: 'Additional phones', group: 'contact', render: () => '' },
  updated: { id: 'updated', label: 'Updated (PKT)', group: 'contact', render: (c) => <span className="whitespace-nowrap text-[11px]">{c.updatedPkt ?? ''}</span> },
  followers: {
    id: 'followers',
    label: 'Followers',
    group: 'contact',
    render: (c) => {
      const list = c.followers ?? [];
      if (list.length === 0) return '';
      return (
        <div className="flex items-center gap-0.5 flex-wrap">
          {list.map((f) =>
            f.avatar_data ? (
              <img
                key={f.id}
                src={f.avatar_data}
                alt={f.full_name}
                title={f.full_name}
                className="w-4 h-4 rounded-full object-cover border border-white shadow-sm flex-shrink-0"
              />
            ) : (
              <span
                key={f.id}
                title={f.full_name}
                className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 text-[7px] font-bold flex items-center justify-center flex-shrink-0"
              >
                {(f.first_name[0] ?? '').toUpperCase()}
                {(f.last_name[0] ?? '').toUpperCase()}
              </span>
            )
          )}
        </div>
      );
    },
  },
  owner: {
    id: 'owner',
    label: 'Owner',
    group: 'contact',
    render: (c) =>
      c.owner ? (
        <div className="flex items-center gap-1">
          {c.ownerAvatar ? (
            <img
              src={c.ownerAvatar}
              alt={c.owner}
              title={c.owner}
              className="w-4 h-4 rounded-full object-cover border border-white shadow-sm flex-shrink-0"
            />
          ) : (
            <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-600 text-[7px] font-bold flex items-center justify-center flex-shrink-0">
              {(c.owner[0] ?? '').toUpperCase()}
            </span>
          )}
          <span className="text-slate-600">{c.owner}</span>
        </div>
      ) : (
        ''
      ),
  },
  valid_whatsapp: { id: 'valid_whatsapp', label: 'Valid WhatsApp', group: 'contact', render: () => '' },
  street_address: {
    id: 'street_address',
    label: 'Street address',
    group: 'general',
    render: (c) => customText(c, 'Street address'),
  },
  city: { id: 'city', label: 'City', group: 'general', render: (c) => customText(c, 'City') },
  country: { id: 'country', label: 'Country', group: 'general', render: (c) => customText(c, 'Country') },
  state: { id: 'state', label: 'State', group: 'general', render: (c) => customText(c, 'State') },
  postal_code: {
    id: 'postal_code',
    label: 'Postal code',
    group: 'general',
    render: (c) => customText(c, 'Postal code') || customText(c, 'Postal zip code'),
  },
  website: { id: 'website', label: 'Website', group: 'general', render: (c) => customText(c, 'Website') },
  timezone: { id: 'timezone', label: 'Timezone', group: 'general', render: (c) => customText(c, 'Timezone') },
  company_name: {
    id: 'company_name',
    label: 'Company name',
    group: 'general',
    render: (c) => customText(c, 'Company name'),
  },
  full_address: {
    id: 'full_address',
    label: 'Full address',
    group: 'general',
    render: (c) => customText(c, 'Full address'),
  },
  flooring_interest: {
    id: 'flooring_interest',
    label: 'What Type of Flooring Are You Interested In?',
    group: 'additional',
    render: (c) => customText(c, 'What Type Of Flooring Are You Interested In?'),
  },
  project_size: {
    id: 'project_size',
    label: 'Approximate Project Size',
    group: 'additional',
    render: (c) => customText(c, 'Approximate Project Size'),
  },
  start_time: {
    id: 'start_time',
    label: 'When Would You Like to Start?',
    group: 'additional',
    render: (c) => customText(c, 'When Would You Like To Start?'),
  },
  additional_project_details: {
    id: 'additional_project_details',
    label: 'Additional Project Details',
    group: 'additional',
    render: (c) => customText(c, 'Additional Project Details'),
  },
  flooring_type: {
    id: 'flooring_type',
    label: 'Project Flooring Type',
    group: 'additional',
    render: (c) => customText(c, 'Project Flooring Type'),
  },
  workflows_active: { id: 'workflows_active', label: 'Workflows active', group: 'activity', render: () => '' },
  workflows_finished: { id: 'workflows_finished', label: 'Workflows finished', group: 'activity', render: () => '' },
  opportunities: { id: 'opportunities', label: 'Opportunities', group: 'activity', render: () => '' },
  offers: { id: 'offers', label: 'Offers', group: 'activity', render: () => '' },
  products: { id: 'products', label: 'Products', group: 'activity', render: () => '' },
  last_appointment: {
    id: 'last_appointment',
    label: 'Last appointment - confirmed/open (PKT)',
    group: 'activity',
    render: () => '',
  },
  last_note: { id: 'last_note', label: 'Last note', group: 'activity', render: () => '' },
};

export const DEFAULT_VISIBLE_FIELDS = [
  'contact_name',
  'phone',
  'email',
  'business_name',
  'created',
  'last_activity',
  'tags',
];

/** Normalized labels of all built-in table columns (used to avoid duplicate imported columns). */
const STATIC_FIELD_LABELS = new Set(
  Object.values(TABLE_FIELDS)
    .filter((f) => f.group !== null)
    .map((f) => f.label.trim().toLowerCase())
);

/** True when an imported column label matches a built-in table column. */
export function isStaticFieldLabel(label: string): boolean {
  return STATIC_FIELD_LABELS.has(label.trim().toLowerCase());
}

/** Name-ish labels that map to the contact's name columns instead of a table column. */
const NAME_LIKE_LABEL = /^(full\s*)?name$/i;

export function isNameLikeLabel(label: string): boolean {
  return NAME_LIKE_LABEL.test(label.trim());
}

/** True when a form field maps to an existing built-in column (e.g. Email,
 *  Phone, City) or to the contact name. Such fields must reuse the existing
 *  column and NEVER generate a duplicate form-specific column. */
export function isCoreFieldLabel(label: string): boolean {
  return isStaticFieldLabel(label) || isNameLikeLabel(label);
}

export function fieldById(id: string): TableField | undefined {
  if (TABLE_FIELDS[id]) return TABLE_FIELDS[id];
  if (id.startsWith(IMPORT_PREFIX)) {
    const label = id.slice(IMPORT_PREFIX.length);
    const match = getImportColumns().find((c) => c.toLowerCase() === label.toLowerCase());
    return match ? importFieldDef(match) : undefined;
  }
  if (!id.startsWith(FORM_GROUP_PREFIX)) return undefined;
  const rest = id.slice(FORM_GROUP_PREFIX.length);
  const sep = rest.lastIndexOf(':');
  if (sep <= 0) return undefined;
  const formName = rest.slice(0, sep);
  const label = rest.slice(sep + 1);
  if (isCoreFieldLabel(label)) return undefined;
  const form = getForms().find((f) => f.name === formName);
  if (!form || !form.elements.some((el) => el.label === label)) return undefined;
  return formFieldDef(form, label);
}

export function fieldsInGroup(groupId: string): TableField[] {
  const staticFields = Object.values(TABLE_FIELDS).filter((f) => f.group === groupId);
  if (groupId === IMPORT_GROUP_ID) return [...staticFields, ...importedFields()];
  if (!groupId.startsWith(FORM_GROUP_PREFIX)) return staticFields;
  const formName = groupId.slice(FORM_GROUP_PREFIX.length);
  const form = getForms().find((f) => f.name === formName);
  if (!form) return staticFields;
  const formFields = form.elements
    .filter((el) => el.type !== 'button' && !isCoreFieldLabel(el.label))
    .map((el) => formFieldDef(form, el.label));
  return [...staticFields, ...formFields];
}

export const TABLE_FILTER_GROUPS: FilterGroup[] = allFieldGroups().map((g) => ({
  id: g.id,
  label: g.label,
  options: fieldsInGroup(g.id).map((f) => f.label),
}));
