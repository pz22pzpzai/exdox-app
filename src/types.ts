export type DocumentKind = 'receipt' | 'invoice';
export type WorkspaceContext = 'cost' | 'sales' | 'vault';
export type PaymentMethod = 'business_card' | 'cash_personal' | 'bank_transfer' | 'not_applicable';
export type UkTaxRate = '20% Standard' | '5% Reduced' | '0% Zero' | 'Exempt' | 'No VAT';

export type DocumentStatus =
  | 'awaiting_review'
  | 'ready_to_submit'
  | 'submitted'
  | 'paid';

export type ExtractionStatus = 'pending' | 'complete' | 'failed';

export type ClaimStatus = 'pending' | 'approved' | 'paid' | 'rejected';

export type TabKey = 'home' | 'documents' | 'claims' | 'settings';

export interface ExpenseDocument {
  id: string;
  type: DocumentKind;
  workspaceContext: WorkspaceContext;
  paymentMethod: PaymentMethod;
  title: string;
  supplier: string;
  amount: number;
  netAmount: number;
  vatAmount: number;
  taxRateApplied: UkTaxRate;
  taxAmount: number;
  currency: string;
  status: DocumentStatus;
  category: string;
  date: string;
  dueDate?: string;
  invoiceNumber?: string;
  notes: string;
  tags: string[];
  fileUri?: string;
  fileName: string;
  source: 'camera' | 'gallery' | 'files' | 'seeded';
  claimId?: string;
  cloudReceiptId?: number;
  storageKey?: string;
  storageBucket?: string;
  extractionStatus: ExtractionStatus;
  extractionSource: 'backend_proxy' | 'fallback_review';
  confidenceScore?: number | null;
  needsReview?: boolean;
  lineItems?: Array<{
    description: string;
    quantity: number | null;
    unitPrice: number | null;
    total: number | null;
    taxAmount: number | null;
  }>;
  taxBreakdown?: Array<{
    label: string;
    rate: number | null;
    amount: number | null;
  }>;
  createdAt: string;
  updatedAt?: string;
}

export interface Claim {
  id: string;
  cloudClaimId?: number;
  name: string;
  status: ClaimStatus;
  total: number;
  currency: string;
  documentIds: string[];
  trip: string;
  owner: string;
  description?: string;
  submittedOn?: string;
}

export interface Vehicle {
  id: string;
  name: string;
  registration: string;
}

export interface UserSettings {
  openOnCamera: boolean;
  lowResolution: boolean;
  saveToGallery: boolean;
  inAppSounds: boolean;
  marketingNotifications: boolean;
  theme: 'system' | 'light' | 'dark';
}

export interface AppState {
  documents: ExpenseDocument[];
  claims: Claim[];
  vehicles: Vehicle[];
  settings: UserSettings;
}

export interface AppErrorLog {
  id: string;
  createdAt: string;
  source: string;
  message: string;
  stack?: string;
  isFatal: boolean;
}

export interface AuthUser {
  id: number;
  organisationId: number;
  email: string;
  fullName: string | null;
  role: 'Business_Admin' | 'Standard_Employee';
  status: 'pending_invite' | 'active';
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}
