export interface Contact {
  id: number;
  name: string;
  initials: string;
  avatarColor: string;
  image?: string;
  phone?: string;
  email?: string;
  businessName?: string;
  contactType?: string;
  owner?: string;
  ownerAvatar?: string;
  assignedTo?: number | null;
  createdPkt?: string;
  lastActivityPkt?: string;
  updatedPkt?: string;
  sortCreated?: string;
  sortActivity?: string;
  sortUpdated?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
  followers?: { id: number; first_name: string; last_name: string; full_name: string; avatar_data?: string | null }[];
  tagExtraCount?: number;
  isHighlighted?: boolean;
}

export interface FormSubmissionData {
  formName: string;
  submittedOn?: string;
  /** Platform the submission arrived from (auto-detected on the public form). */
  source?: string;
  values: Record<string, string>;
}

export interface ImportedContactInput {
  name: string;
  phone: string;
  email: string;
  business: string;
  tag: string;
  color: string;
}

export interface ImportSheetData {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
}

export interface ImportResult {
  fileName: string;
  sheets: ImportSheetData[];
  totalRows: number;
  cityColumn: string | null;
}
