import { memo, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState as RNAppState,
  FlatList,
  Image,
  InteractionManager,
  Linking,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Camera, CameraView } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

import { seedState } from './src/data/seed';
import { loginWithEmail, registerWithEmail } from './src/services/auth';
import { documentExtractionService, ExtractedDocumentDraft } from './src/services/documentExtraction';
import {
  attachCloudReceiptToClaim,
  createCloudClaim,
  deleteCloudReceipt,
  fetchCloudReceiptAssetUrl,
  fetchCloudReceipts,
  fetchExpenseClaims,
  updateCloudReceipt,
} from './src/services/receiptsApi';
import { fetchOrganisationSettings, saveOrganisationSettings } from './src/services/settingsApi';
import { setSessionToken } from './src/services/session';
import { colors, radius, spacing } from './src/theme';
import {
  AppErrorLog,
  AppState,
  AuthSession,
  Claim,
  DocumentKind,
  ExpenseDocument,
  OrganisationSettings,
  PaymentMethod,
  UkTaxRate,
  UserSettings,
  Vehicle,
  WorkspaceContext,
} from './src/types';
import { clearAuthSession, loadAuthSession, saveAuthSession } from './src/utils/authStorage';
import { buildDraftDocument, extractionLooksUnreadable } from './src/utils/documents';
import { prepareImportedImageForApp } from './src/utils/uploadAsset';
import {
  appendStoredDiagnosticLog,
  appendStoredErrorLog,
  clearStoredDiagnosticLogs,
  clearStoredErrorLogs,
  loadScopedStoredState,
  loadStoredDiagnosticLogs,
  loadStoredErrorLogs,
  saveStoredState,
} from './src/utils/storage';

type MainTab = 'costs' | 'sales' | 'claims' | 'more';
type MoreSheetTarget = 'menu' | 'capture_actions';
type SettingsPanelTarget =
  | 'business_admin'
  | 'logins'
  | 'extract_email'
  | 'vehicles'
  | 'analytics'
  | 'team_exports'
  | 'vault'
  | 'team_admin';
type StatusFilter = 'all' | ExpenseDocument['status'];
type SortMode = 'newest' | 'oldest' | 'amount_high' | 'amount_low';
type ThemeOption = UserSettings['theme'];

const brandLogo = require('./assets/exdox-logo.png');
const brandMark = require('./assets/exdox-mark.png');
const brandBadge = require('./assets/brand-badge.png');
const workspaceName = 'exdox Workspace';
const TAX_RATE_OPTIONS: UkTaxRate[] = ['20% Standard', '5% Reduced', '0% Zero', 'Exempt', 'No VAT'];
const COST_CATEGORY_OPTIONS = [
  'Staff Welfare',
  '1 - Taxi',
  '2 - Bus/ Tram',
  '3 - Car Wash',
  '4 - Fuel',
  '5 - Train',
  '6 - Toll Road',
  '7 - Motor Expenses',
  '8 - Other',
  '9 - Uniform',
  '10 - EV Charging',
] as const;
const SALES_CATEGORY_OPTIONS = [
  'Accounts Receivable',
  'Consulting Income',
  'Product Sales',
  'Subscription Income',
  'Travel Recharge',
  'Other Income',
] as const;
const previewableImagePattern = /\.(jpg|jpeg|png|webp|heic)$/i;
const pdfDocumentPattern = /\.pdf(\?|$)/i;

type NativeGalleryAsset = {
  uri: string;
  fileName: string;
};

const NativeGalleryPicker = NativeModules.NativeGalleryPicker as
  | { open: () => Promise<NativeGalleryAsset | null> }
  | undefined;

const getWorkspaceContextForTab = (tab: MainTab): WorkspaceContext => (tab === 'sales' ? 'sales' : 'cost');
const getCategoryOptions = (workspaceContext: WorkspaceContext) =>
  workspaceContext === 'sales' ? [...SALES_CATEGORY_OPTIONS] : [...COST_CATEGORY_OPTIONS];
const getDefaultPaymentMethod = (workspaceContext: WorkspaceContext, isAdmin: boolean): PaymentMethod => {
  if (workspaceContext === 'vault') {
    return 'not_applicable';
  }
  if (workspaceContext === 'sales') {
    return 'bank_transfer';
  }
  return isAdmin ? 'business_card' : 'cash_personal';
};

const formatErrorLog = (source: string, error: unknown, isFatal = false): AppErrorLog => {
  const normalized =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'Unknown application error');

  return {
    id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    source,
    message: normalized.message || 'Unknown application error',
    stack: normalized.stack,
    isFatal,
  };
};

const buildManualDraftDocument = ({
  fileName,
  type,
  uri,
  source,
  workspaceContext,
  paymentMethod,
}: {
  fileName: string;
  type: DocumentKind;
  uri?: string;
  source: ExpenseDocument['source'];
  workspaceContext: WorkspaceContext;
  paymentMethod: PaymentMethod;
}): ExpenseDocument => {
  const now = new Date().toISOString();
  const isInvoice = type === 'invoice';

  return {
    id: `doc-${Date.now()}`,
    type,
    workspaceContext,
    paymentMethod,
    title: isInvoice ? 'Invoice to review' : 'Receipt to review',
    supplier: isInvoice ? 'Supplier to review' : 'Merchant to review',
    amount: 0,
    taxAmount: 0,
    currency: 'GBP',
    status: 'awaiting_review',
    category: '',
    description: '',
    customer: '',
    date: now,
    netAmount: 0,
    vatAmount: 0,
    taxRateApplied: 'No VAT',
    dueDate: undefined,
    invoiceNumber: undefined,
    notes:
      source === 'camera'
        ? 'Captured with camera and saved for manual review.'
        : 'Imported from gallery and saved for manual review.',
    tags: [type, 'draft'],
    fileUri: uri,
    fileName,
    source,
    extractionStatus: 'pending',
    extractionSource: 'backend_proxy',
    confidenceScore: null,
    needsReview: true,
    lineItems: [],
    taxBreakdown: [],
    createdAt: now,
    updatedAt: now,
  };
};

const resolveExtractedDraftStatus = (extracted: ExtractedDocumentDraft): ExpenseDocument['extractionStatus'] =>
  extracted.extractionOutcome ??
  (extracted.extractionSource === 'backend_proxy' && !extractionLooksUnreadable(extracted) ? 'complete' : 'failed');

const applyExtractedDocumentDraft = (
  document: ExpenseDocument,
  extracted: ExtractedDocumentDraft,
): ExpenseDocument => ({
  ...document,
  title: extracted.supplier?.trim() ? extracted.supplier : document.title,
  supplier: extracted.supplier?.trim() ? extracted.supplier : document.supplier,
  amount: resolveDocumentAmount({
    amount: extracted.amount,
    netAmount: extracted.netAmount,
    vatAmount: extracted.vatAmount,
    taxAmount: extracted.taxAmount,
  }),
  netAmount: extracted.netAmount ?? document.netAmount ?? extracted.amount ?? document.amount,
  vatAmount: extracted.vatAmount ?? extracted.taxAmount ?? document.vatAmount ?? document.taxAmount,
  taxRateApplied: extracted.taxRateApplied ?? document.taxRateApplied ?? 'No VAT',
  taxAmount: extracted.taxAmount ?? document.taxAmount,
  currency: extracted.currency ?? document.currency,
  category: document.category.trim() ? document.category : extracted.category ?? document.category,
  description: extracted.description ?? document.description ?? '',
  customer: extracted.customer ?? document.customer ?? '',
  dueDate: extracted.dueDate,
  invoiceNumber: extracted.invoiceNumber,
  notes: extracted.notes || document.notes,
  extractionStatus: resolveExtractedDraftStatus(extracted),
  extractionSource: extracted.extractionSource,
  confidenceScore: extracted.confidenceScore ?? null,
  needsReview: extracted.needsReview ?? true,
  lineItems: extracted.lineItems ?? [],
  taxBreakdown: extracted.taxBreakdown ?? [],
  updatedAt: new Date().toISOString(),
  cloudReceiptId: extracted.cloudReceiptId ?? document.cloudReceiptId,
  storageKey: extracted.storageKey ?? document.storageKey,
  storageBucket: extracted.storageBucket ?? document.storageBucket,
  workspaceContext: extracted.workspaceContext ?? document.workspaceContext,
  paymentMethod: extracted.paymentMethod ?? document.paymentMethod,
});

const markDuplicateUploadDraft = (
  currentDocument: ExpenseDocument | undefined,
  extracted: ExtractedDocumentDraft,
  documents: ExpenseDocument[],
): ExtractedDocumentDraft => {
  if (!currentDocument || extracted.cloudReceiptId || extractionLooksLikeDuplicateUpload(extracted)) {
    return extracted;
  }

  const nextDocument = applyExtractedDocumentDraft(currentDocument, extracted);
  const matchingCloudDocument = documents.find((candidate) => isLikelyDuplicateReceiptMatch(nextDocument, candidate));
  if (!matchingCloudDocument) {
    return extracted;
  }

  return {
    ...extracted,
    notes: duplicateReceiptStatusMessage,
    needsReview: true,
  };
};

const canPreviewDocumentInline = (document: Pick<ExpenseDocument, 'fileName' | 'fileUri'>) =>
  Boolean(document.fileUri) &&
  !pdfDocumentPattern.test(document.fileName) &&
  !pdfDocumentPattern.test(document.fileUri ?? '') &&
  (previewableImagePattern.test(document.fileName) ||
    previewableImagePattern.test(document.fileUri ?? '') ||
    Boolean(document.fileName));

const canHydrateDocumentPreview = (document: Pick<ExpenseDocument, 'fileName'>) =>
  !pdfDocumentPattern.test(document.fileName) && Boolean(document.fileName);

const isTransientNetworkError = (error: unknown) => {
  const message =
    error instanceof Error
      ? `${error.message} ${error.stack ?? ''}`.toLowerCase()
      : String(error).toLowerCase();

  return /unknownhostexception|unable to resolve host|network request failed|failed to fetch|timeout/.test(message);
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveDocumentAmount = ({
  amount,
  netAmount,
  vatAmount,
  taxAmount,
}: {
  amount?: number | null;
  netAmount?: number | null;
  vatAmount?: number | null;
  taxAmount?: number | null;
}) => {
  if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
    return amount;
  }

  const derivedTaxAmount =
    typeof vatAmount === 'number' && Number.isFinite(vatAmount)
      ? vatAmount
      : typeof taxAmount === 'number' && Number.isFinite(taxAmount)
        ? taxAmount
        : null;

  if (
    typeof netAmount === 'number' &&
    Number.isFinite(netAmount) &&
    netAmount >= 0 &&
    derivedTaxAmount !== null &&
    derivedTaxAmount >= 0
  ) {
    return Number((netAmount + derivedTaxAmount).toFixed(2));
  }

  return amount ?? 0;
};

const isVatTrackingEnabled = (settings: OrganisationSettings | null) => settings?.isVatRegistered !== false;

const normalizeVatDisabledValues = ({
  amount,
  netAmount,
  vatAmount,
}: Pick<ExpenseDocument, 'amount' | 'netAmount' | 'vatAmount'>) => {
  const grossAmount = resolveDocumentAmount({ amount, netAmount, vatAmount });
  return {
    amount: grossAmount,
    netAmount: grossAmount,
    vatAmount: 0,
    taxAmount: 0,
    taxRateApplied: 'No VAT' as UkTaxRate,
  };
};

const isPlaceholderSupplierLabel = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase() ?? '';
  return !normalized || normalized === 'merchant to review' || normalized === 'supplier to review';
};

const looksLikeGeneratedUploadTitle = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return false;
  }

  return (
    /^[0-9_-]{10,}$/.test(normalized) ||
    normalized.includes('screenshot') ||
    normalized.includes('receipt-') ||
    normalized.includes('invoice-')
  );
};

const normalizeDocumentFileName = (fileName: string) =>
  fileName
    .trim()
    .toLowerCase()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-z0-9]+/g, '');

const normalizeDuplicateComparisonText = (value: string | null | undefined) =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const duplicateReceiptStatusMessage = 'Error: Duplicate';

const getDocumentFileNameCandidates = (document: Pick<ExpenseDocument, 'fileName' | 'fileUri'>) => {
  const candidates = new Set<string>();
  const normalizedFileName = normalizeDocumentFileName(document.fileName);
  if (normalizedFileName) {
    candidates.add(normalizedFileName);
  }

  if (document.fileUri) {
    const fileUriName = document.fileUri.split(/[\\/]/).pop() ?? '';
    const normalizedUriName = normalizeDocumentFileName(fileUriName);
    if (normalizedUriName) {
      candidates.add(normalizedUriName);
      const trimmedPrefixedName = normalizedUriName.replace(/^doc\d+/, '');
      if (trimmedPrefixedName) {
        candidates.add(trimmedPrefixedName);
      }
    }
  }

  return [...candidates];
};

const isLikelyTimedOutUploadDuplicate = (localDocument: ExpenseDocument, cloudDocument: ExpenseDocument) => {
  if (localDocument.cloudReceiptId) {
    return false;
  }

  if (localDocument.type !== cloudDocument.type || localDocument.workspaceContext !== cloudDocument.workspaceContext) {
    return false;
  }

  const localFileNameCandidates = getDocumentFileNameCandidates(localDocument);
  const cloudFileName = normalizeDocumentFileName(cloudDocument.fileName);
  if (
    !cloudFileName ||
    !localFileNameCandidates.some(
      (candidate) => candidate === cloudFileName || candidate.endsWith(cloudFileName) || cloudFileName.endsWith(candidate),
    )
  ) {
    return false;
  }

  const localCreatedAt = Date.parse(localDocument.createdAt);
  const cloudCreatedAt = Date.parse(cloudDocument.createdAt);
  if (!Number.isFinite(localCreatedAt) || !Number.isFinite(cloudCreatedAt)) {
    return false;
  }

  return Math.abs(localCreatedAt - cloudCreatedAt) <= 1000 * 60 * 15;
};

const extractionLooksLikeDuplicateUpload = (input: { notes?: string | null }) =>
  /upload error:\s*duplicate receipt|duplicate receipt/.test((input.notes ?? '').toLowerCase());

const isLikelyDuplicateReceiptMatch = (document: ExpenseDocument, candidate: ExpenseDocument) => {
  if (!candidate.cloudReceiptId || document.id === candidate.id) {
    return false;
  }

  if (document.type !== candidate.type || document.workspaceContext !== candidate.workspaceContext) {
    return false;
  }

  const amountMatches = Math.abs((document.amount ?? 0) - (candidate.amount ?? 0)) < 0.01;
  if (!amountMatches || document.amount <= 0 || candidate.amount <= 0) {
    return false;
  }

  const documentDate = new Date(document.date).toISOString().slice(0, 10);
  const candidateDate = new Date(candidate.date).toISOString().slice(0, 10);
  if (documentDate !== candidateDate) {
    return false;
  }

  const documentSupplier = normalizeDuplicateComparisonText(document.supplier || document.title);
  const candidateSupplier = normalizeDuplicateComparisonText(candidate.supplier || candidate.title);
  return Boolean(documentSupplier) && documentSupplier === candidateSupplier;
};

const mergeWorkspaceDocuments = (
  currentDocuments: ExpenseDocument[],
  cloudDocuments: ExpenseDocument[],
  deletedCloudReceiptIds: Set<number>,
) => {
  const cloudReceiptIds = new Set(cloudDocuments.map((document) => document.cloudReceiptId).filter(Boolean));
  const duplicateLocalDocumentIds = new Set(
    currentDocuments
      .filter((document) => !document.cloudReceiptId)
      .flatMap((document) =>
        cloudDocuments.some((cloudDocument) => isLikelyTimedOutUploadDuplicate(document, cloudDocument))
          ? [document.id]
          : [],
      ),
  );
  const retainedLocalDocuments = currentDocuments.filter(
    (document) =>
      (!document.cloudReceiptId || !cloudReceiptIds.has(document.cloudReceiptId)) &&
      (!document.cloudReceiptId || !deletedCloudReceiptIds.has(document.cloudReceiptId)) &&
      !duplicateLocalDocumentIds.has(document.id),
  );
  const localCloudDocuments = new Map(
    currentDocuments
      .filter((document) => Boolean(document.cloudReceiptId))
      .map((document) => [document.cloudReceiptId, document] as const),
  );
  const mergedCloudDocuments = cloudDocuments.map((document) => {
    const localDocument = document.cloudReceiptId ? localCloudDocuments.get(document.cloudReceiptId) : undefined;
    const duplicateLocalDocument = currentDocuments.find((current) => isLikelyTimedOutUploadDuplicate(current, document));
    const mergedLocalDocument = localDocument ?? duplicateLocalDocument;
    if (!mergedLocalDocument) {
      return document;
    }

    const preferLocalSupplier =
      isPlaceholderSupplierLabel(document.supplier) &&
      !isPlaceholderSupplierLabel(mergedLocalDocument.supplier);
    const preferLocalTitle =
      (!document.title.trim() || looksLikeGeneratedUploadTitle(document.title)) &&
      Boolean(mergedLocalDocument.title.trim());

    return {
      ...document,
      id: mergedLocalDocument.id,
      title: preferLocalTitle ? mergedLocalDocument.title : document.title,
      supplier: preferLocalSupplier ? mergedLocalDocument.supplier : document.supplier,
      category: mergedLocalDocument.category.trim() ? mergedLocalDocument.category : document.category,
      fileUri: mergedLocalDocument.fileUri ?? document.fileUri,
      source: mergedLocalDocument.source,
      createdAt: mergedLocalDocument.createdAt,
      updatedAt: mergedLocalDocument.updatedAt ?? document.updatedAt,
    };
  });

  return [...retainedLocalDocuments, ...mergedCloudDocuments].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
};

const galleryResultAssetName = (asset: { uri?: string | null; fileName?: string | null; assetId?: string | null }) =>
  asset.assetId ?? asset.uri ?? asset.fileName ?? `gallery-${Date.now()}`;

const statusFilterOptions: Array<{ label: string; value: StatusFilter }> = [
  { label: 'All statuses', value: 'all' },
  { label: 'To review', value: 'awaiting_review' },
  { label: 'Reviewed', value: 'ready_to_submit' },
  { label: 'Submitted', value: 'submitted' },
  { label: 'Paid', value: 'paid' },
];

const sortOptions: Array<{ label: string; value: SortMode }> = [
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Amount high to low', value: 'amount_high' },
  { label: 'Amount low to high', value: 'amount_low' },
];

const themeOptions: Array<{ label: string; value: ThemeOption }> = [
  { label: 'System default', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

const formatCurrency = (amount: number, currency = 'GBP') =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

const getStatusLabel = (status: ExpenseDocument['status']) =>
  status === 'awaiting_review'
    ? 'To review'
    : status === 'ready_to_submit'
      ? 'Reviewed'
      : status === 'submitted'
        ? 'Submitted'
        : 'Paid';

const buildInboundEmailAddress = (organisationName: string, organisationId: number) => {
  const slug = organisationName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 18);
  return `${slug || 'workspace'}-${organisationId}@exdox.co.uk`;
};

const DocumentThumbnail = memo(function DocumentThumbnail({
  fileUri,
  hasPreviewImage,
}: {
  fileUri?: string;
  hasPreviewImage: boolean;
}) {
  if (hasPreviewImage && fileUri) {
    return (
      <Image
        source={{ uri: fileUri }}
        fadeDuration={0}
        resizeMethod="resize"
        resizeMode="cover"
        style={styles.documentThumb}
      />
    );
  }

  return (
    <View style={styles.documentThumbFallback}>
      <View style={styles.documentDot} />
    </View>
  );
}, (previousProps, nextProps) =>
  previousProps.fileUri === nextProps.fileUri && previousProps.hasPreviewImage === nextProps.hasPreviewImage,
);

const DocumentSheetPreviewImage = memo(function DocumentSheetPreviewImage({
  fileUri,
  fullScreen = false,
}: {
  fileUri?: string;
  fullScreen?: boolean;
}) {
  const source = useMemo(() => (fileUri ? { uri: fileUri } : null), [fileUri]);

  if (!source) {
    return null;
  }

  return (
    <Image
      source={source}
      fadeDuration={0}
      resizeMethod="resize"
      resizeMode="contain"
      style={fullScreen ? styles.previewFullscreenImage : styles.documentSheetPreview}
    />
  );
}, (previousProps, nextProps) =>
  previousProps.fileUri === nextProps.fileUri && previousProps.fullScreen === nextProps.fullScreen,
);

export default function App() {
  const systemTheme = useColorScheme();
  const hasLoggedLaunchRef = useRef(false);
  const hasRecoveredPickerResultRef = useRef(false);
  const hasRestoredStateRef = useRef(false);
  const awaitingGalleryResultRef = useRef(false);
  const handledGalleryAssetRef = useRef<string | null>(null);
  const deletedCloudReceiptIdsRef = useRef<Set<number>>(new Set());
  const [appState, setAppState] = useState<AppState>(seedState);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'reset'>('login');
  const [authFullName, setAuthFullName] = useState('');
  const [authOrganisationName, setAuthOrganisationName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<MainTab>('costs');
  const [captureType, setCaptureType] = useState<DocumentKind>('receipt');
  const [captureModalVisible, setCaptureModalVisible] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [captureReviewDocumentId, setCaptureReviewDocumentId] = useState<string | null>(null);
  const [sheetTarget, setSheetTarget] = useState<MoreSheetTarget | null>(null);
  const [search, setSearch] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorLogs, setErrorLogs] = useState<AppErrorLog[]>([]);
  const [diagnosticLogs, setDiagnosticLogs] = useState<AppErrorLog[]>([]);
  const [errorLogVisible, setErrorLogVisible] = useState(false);
  const [pendingGalleryOpen, setPendingGalleryOpen] = useState(false);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [headerMenuVisible, setHeaderMenuVisible] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [settingsPanelTarget, setSettingsPanelTarget] = useState<SettingsPanelTarget | null>(null);
  const [claimComposerVisible, setClaimComposerVisible] = useState(false);
  const [claimTitleInput, setClaimTitleInput] = useState('');
  const [claimStartDateInput, setClaimStartDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [claimEndDateInput, setClaimEndDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [mileageVisible, setMileageVisible] = useState(false);
  const [mileageStartInput, setMileageStartInput] = useState('');
  const [mileageEndInput, setMileageEndInput] = useState('');
  const [mileageMilesInput, setMileageMilesInput] = useState('');
  const [themeVisible, setThemeVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [bulkSelectionEnabled, setBulkSelectionEnabled] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [vehicleNameInput, setVehicleNameInput] = useState('');
  const [vehicleRegistrationInput, setVehicleRegistrationInput] = useState('');
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const isAdmin = authSession?.user.role === 'Business_Admin';
  const vatTrackingEnabled = isVatTrackingEnabled(appState.organisationSettings);
  const effectiveTheme: ThemeOption =
    appState.settings.theme === 'system' ? (systemTheme === 'dark' ? 'dark' : 'light') : appState.settings.theme;
  const shellBackgroundStyle = effectiveTheme === 'dark' ? styles.shellDark : null;
  const shellTextStyle = effectiveTheme === 'dark' ? styles.shellTextDark : null;

  useEffect(() => {
    let mounted = true;

    const restoreState = async () => {
      const [savedAuthSession, savedErrorLogs, savedDiagnosticLogs] = await Promise.all([
        loadAuthSession(),
        loadStoredErrorLogs(),
        loadStoredDiagnosticLogs(),
      ]);
      if (mounted) {
        if (savedAuthSession) {
          setSessionToken(savedAuthSession.token);
          setAuthSession(savedAuthSession);
          const savedState = await loadScopedStoredState(String(savedAuthSession.user.id));
          if (savedState && mounted) {
            setAppState(savedState);
          }
        }
        setErrorLogs(savedErrorLogs);
        setDiagnosticLogs(savedDiagnosticLogs);
        hasRestoredStateRef.current = true;
        setIsReady(true);
      }
    };

    restoreState().catch(() => setIsReady(true));

    return () => {
      mounted = false;
    };
  }, []);

  const recordError = useEffectEvent(async (source: string, error: unknown, isFatal = false) => {
    const entry = formatErrorLog(source, error, isFatal);

    try {
      const next = await appendStoredErrorLog(entry);
      setErrorLogs(next);
    } catch {
      setErrorLogs((current) => [entry, ...current].slice(0, 30));
    }
  });

  const recordDiagnostic = useEffectEvent(async (source: string, message: string) => {
    const entry: AppErrorLog = {
      id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      source,
      message,
      isFatal: false,
    };

    try {
      const next = await appendStoredDiagnosticLog(entry);
      setDiagnosticLogs(next);
    } catch {
      setDiagnosticLogs((current) => [entry, ...current].slice(0, 60));
    }
  });

  const syncCloudWorkspace = useEffectEvent(async (session: AuthSession) => {
    try {
      let costDocuments: ExpenseDocument[] = [];
      let salesDocuments: ExpenseDocument[] = [];
      let remoteClaims: Claim[] = [];

      try {
        [costDocuments, salesDocuments, remoteClaims] = await Promise.all([
          fetchCloudReceipts('cost'),
          fetchCloudReceipts('sales'),
          fetchExpenseClaims(),
        ]);
      } catch (error) {
        if (!isTransientNetworkError(error)) {
          throw error;
        }

        await delay(1200);
        [costDocuments, salesDocuments, remoteClaims] = await Promise.all([
          fetchCloudReceipts('cost'),
          fetchCloudReceipts('sales'),
          fetchExpenseClaims(),
        ]);
      }

      const currentDocuments = appState.documents;
      const mergedDocuments = [...costDocuments, ...salesDocuments].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
      const hydratedDocuments = await Promise.all(
        mergedDocuments.map(async (document) => {
          if (!canHydrateDocumentPreview(document) || !document.cloudReceiptId) {
            return document;
          }

          const existingDocument = currentDocuments.find(
            (current) =>
              current.cloudReceiptId === document.cloudReceiptId &&
              current.fileUri &&
              canPreviewDocumentInline(current),
          );
          if (existingDocument?.fileUri) {
            return {
              ...document,
              fileUri: existingDocument.fileUri,
            };
          }

          try {
            const fileUri = await fetchCloudReceiptAssetUrl(document.cloudReceiptId);
            return {
              ...document,
              fileUri,
            };
          } catch {
            return document;
          }
        }),
      );

      setAppState((current) => ({
        ...current,
        documents: mergeWorkspaceDocuments(current.documents, hydratedDocuments, deletedCloudReceiptIdsRef.current),
        claims: remoteClaims,
      }));
    } catch (error) {
      if (isTransientNetworkError(error)) {
        await recordDiagnostic('cloud sync', 'Cloud sync skipped because the device could not reach the server.');
        return;
      }
      void recordError('cloud sync', error);
    }
  });

  const activateSession = useEffectEvent(async (session: AuthSession) => {
    setSessionToken(session.token);
    await saveAuthSession(session);
    const savedState = await loadScopedStoredState(String(session.user.id));
    setAuthSession(session);
    setAppState(savedState ?? seedState);
    try {
      const organisationSettings = await fetchOrganisationSettings();
      setAppState((current) => ({
        ...current,
        organisationSettings,
      }));
    } catch (error) {
      void recordError('organisation settings', error);
    }
    await syncCloudWorkspace(session);
  });

  const handleSignOut = useEffectEvent(async () => {
    setSessionToken(null);
    setAuthSession(null);
    setAppState(seedState);
    setSelectedDocumentId(null);
    setActiveTab('costs');
    await clearAuthSession();
  });

  const syncDocumentToCloud = useEffectEvent(
    async (
      documentId: string,
      updates: Partial<
        Pick<
          ExpenseDocument,
          'supplier' | 'date' | 'dueDate' | 'invoiceNumber' | 'category' | 'description' | 'customer' | 'netAmount' | 'vatAmount' | 'amount' | 'taxRateApplied' | 'status'
        >
      >,
    ) => {
      const document = appState.documents.find((entry) => entry.id === documentId);
      if (!document?.cloudReceiptId) {
        return;
      }

      await updateCloudReceipt(document.cloudReceiptId, {
        supplier: updates.supplier ?? document.supplier,
        date: updates.date ?? document.date,
        dueDate: updates.dueDate ?? document.dueDate,
        invoiceNumber: updates.invoiceNumber ?? document.invoiceNumber,
        category: updates.category ?? document.category,
        description: updates.description ?? document.description,
        customer: updates.customer ?? document.customer,
        netAmount: updates.netAmount ?? document.netAmount,
        vatAmount: updates.vatAmount ?? document.vatAmount,
        amount: updates.amount ?? document.amount,
        taxRateApplied: updates.taxRateApplied ?? document.taxRateApplied,
        status: updates.status ?? document.status,
      });

      if (authSession) {
        await syncCloudWorkspace(authSession);
      }
    },
  );

  const submitAuth = useEffectEvent(async () => {
    if (authMode === 'reset') {
      Alert.alert(
        'Password reset',
        authEmail
          ? 'Reset email delivery is not connected yet. Ask your Exdox administrator to reset your access for now.'
          : 'Enter your email address first so we know which account needs access help.',
      );
      return;
    }

    setAuthBusy(true);
    try {
      const session =
        authMode === 'register'
          ? await registerWithEmail({
              email: authEmail,
              password: authPassword,
              fullName: authFullName,
              organisationName: authOrganisationName,
            })
          : await loginWithEmail({
              email: authEmail,
              password: authPassword,
            });

      await activateSession(session);
      setAuthPassword('');
      setAuthFullName('');
      setAuthOrganisationName('');
    } catch (error) {
      void recordError('auth', error);
      Alert.alert('Sign-in failed', error instanceof Error ? error.message : 'Could not sign in right now.');
    } finally {
      setAuthBusy(false);
    }
  });

  const prepareManualDocument = useEffectEvent(async ({
    source,
    type,
    uri,
    fileName,
    workspaceContext,
    paymentMethod,
  }: {
    source: ExpenseDocument['source'];
    type: DocumentKind;
    uri: string;
    fileName: string;
    workspaceContext: WorkspaceContext;
    paymentMethod: PaymentMethod;
  }) => {
    await recordDiagnostic(source, `Preparing image ${fileName}`);
    const prepared = await prepareImportedImageForApp({
      id: `prepared-${Date.now()}`,
      uri,
      fileName,
    });
    await recordDiagnostic(
      source,
      `Prepared image ${prepared.fileName} | uri=${prepared.uri} | mime=${prepared.mimeType}`,
    );
    return buildManualDraftDocument({
      fileName: prepared.fileName,
      type,
      uri: prepared.uri,
      source,
      workspaceContext,
      paymentMethod,
    });
  });

  const commitPreparedDocument = useEffectEvent(
    async (document: ExpenseDocument, origin: 'camera' | 'gallery' | 'recovery') => {
      try {
        await recordDiagnostic(
          document.source,
          `Deferred commit starting from ${origin} | fileUri=${document.fileUri ?? 'undefined'}`,
        );
        updateState((current) => ({
          ...current,
          documents: [document, ...current.documents],
        }));
        setActiveTab(document.type === 'invoice' ? 'sales' : 'costs');
        setSelectedDocumentId(null);
        setCaptureReviewDocumentId(document.id);
        setTimeout(() => {
          void processPreparedDocumentUpload({
            documentId: document.id,
            fileName: document.fileName,
            fileUri: document.fileUri,
            type: document.type,
            source: document.source,
            workspaceContext: document.workspaceContext,
            paymentMethod: document.paymentMethod,
          });
        }, 120);
        await recordDiagnostic(document.source, `Deferred commit complete from ${origin}`);
      } catch (error) {
        await recordDiagnostic(document.source, `Deferred commit failed from ${origin}`);
        void recordError('prepared document commit', error);
        Alert.alert(
          'Import failed',
          'The receipt or invoice could not be saved. Please try again with another photo or import method.',
        );
      }
    },
  );

  const schedulePreparedDocumentCommit = useEffectEvent(
    (document: ExpenseDocument, origin: 'camera' | 'gallery' | 'recovery') => {
      void recordDiagnostic(document.source, `Scheduling deferred commit from ${origin}`);
      if (origin === 'camera') {
        InteractionManager.runAfterInteractions(() => {
          void recordDiagnostic(document.source, `Deferred commit running after interactions from ${origin}`);
          void commitPreparedDocument(document, origin);
        });
        return;
      }

      void recordDiagnostic(document.source, `Immediate commit running for ${origin}`);
      void commitPreparedDocument(document, origin);
    },
  );

  const processPreparedDocumentUpload = useEffectEvent(async ({
    documentId,
    fileName,
    fileUri,
    type,
    source,
    workspaceContext,
    paymentMethod,
  }: {
    documentId: string;
    fileName: string;
    fileUri?: string;
    type: DocumentKind;
    source: ExpenseDocument['source'];
    workspaceContext: WorkspaceContext;
    paymentMethod: PaymentMethod;
  }) => {
    if (!fileUri) {
      return;
    }

    try {
      await recordDiagnostic(source, `Starting background upload for ${fileName}`);
      const extracted = await documentExtractionService.extractFromAsset({
        type,
        fileName,
        uri: fileUri,
        lowResolution: appState.settings.lowResolution,
        source,
        workspaceContext,
        paymentMethod,
        skipProcessing: workspaceContext === 'vault',
      });
      let currentDocument = appState.documents.find((document) => document.id === documentId);
      const extractedWithDuplicateHint = markDuplicateUploadDraft(currentDocument, extracted, appState.documents);
      const nextDocument = currentDocument ? applyExtractedDocumentDraft(currentDocument, extractedWithDuplicateHint) : null;
      await recordDiagnostic(source, `Background upload complete for ${fileName}`);
      updateState((current) => ({
        ...current,
        documents: current.documents.map((document) =>
          document.id === documentId ? applyExtractedDocumentDraft(document, extractedWithDuplicateHint) : document,
        ),
      }));
      if (resolveExtractedDraftStatus(extractedWithDuplicateHint) === 'pending') {
        await recordDiagnostic(source, `Waiting for cloud extraction handshake for ${fileName}`);
        if (authSession) {
          let cloudMatchFound = false;
          for (let attempt = 1; attempt <= 8; attempt += 1) {
            await delay(3000);
            const latestLocalDocument =
              appState.documents.find((document) => document.id === documentId) ?? currentDocument ?? nextDocument;
            if (!latestLocalDocument) {
              break;
            }

            try {
              const cloudDocuments = await fetchCloudReceipts(workspaceContext);
              const matchingCloudDocument = cloudDocuments.find(
                (candidate) =>
                  (latestLocalDocument.cloudReceiptId && candidate.cloudReceiptId === latestLocalDocument.cloudReceiptId) ||
                  isLikelyTimedOutUploadDuplicate(latestLocalDocument, candidate),
              );
              if (!matchingCloudDocument) {
                continue;
              }

              cloudMatchFound = true;
              await recordDiagnostic(source, `Cloud extraction handshake received for ${fileName} on attempt ${attempt}`);
              setAppState((current) => ({
                ...current,
                documents: mergeWorkspaceDocuments(current.documents, cloudDocuments, deletedCloudReceiptIdsRef.current),
              }));
              break;
            } catch (error) {
              if (!isTransientNetworkError(error)) {
                throw error;
              }
            }
          }

          if (!cloudMatchFound) {
            await recordDiagnostic(source, `Cloud extraction handshake still pending for ${fileName}`);
            await syncCloudWorkspace(authSession);
          }
        }

        return;
      }
      if (authSession && extracted.cloudReceiptId && nextDocument) {
        await updateCloudReceipt(extracted.cloudReceiptId, {
          category: nextDocument.category,
          description: nextDocument.description,
          customer: nextDocument.customer,
          amount: nextDocument.amount,
          netAmount: nextDocument.netAmount,
          vatAmount: nextDocument.vatAmount,
          taxRateApplied: nextDocument.taxRateApplied,
        });
        await syncCloudWorkspace(authSession);
      }
      if (authSession && !extracted.cloudReceiptId) {
        await delay(1200);
        await syncCloudWorkspace(authSession);
      }
    } catch (error) {
      await recordDiagnostic(source, `Background upload failed for ${fileName}`);
      void recordError('background upload', error);
    }
  });

  useEffect(() => {
    if (!authSession) {
      return;
    }

    if (!appState.organisationSettings) {
      fetchOrganisationSettings()
        .then((organisationSettings) => {
          setAppState((current) => ({
            ...current,
            organisationSettings,
          }));
        })
        .catch((error) => {
          void recordError('organisation settings', error);
        });
    }

    void syncCloudWorkspace(authSession);
  }, [appState.organisationSettings, authSession, recordError, syncCloudWorkspace]);

  useEffect(() => {
    if (!pendingGalleryOpen || cameraVisible) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setPendingGalleryOpen(false);
      void recordDiagnostic('gallery', 'Camera closed, opening gallery picker');
      void openGalleryPicker();
    }, 180);

    return () => clearTimeout(timeoutId);
  }, [cameraVisible, pendingGalleryOpen, recordDiagnostic]);

  useEffect(() => {
    setBulkSelectionEnabled(false);
    setSelectedDocumentIds([]);
  }, [activeTab]);

  useEffect(() => {
    const errorUtils = (
      globalThis as typeof globalThis & {
        ErrorUtils?: {
          getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
          setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
        };
      }
    ).ErrorUtils;

    const previousHandler = errorUtils?.getGlobalHandler?.();
    errorUtils?.setGlobalHandler?.((error, isFatal) => {
      void recordError('Global JS error', error, Boolean(isFatal));
      previousHandler?.(error, isFatal);
    });

    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      originalConsoleError(...args);
      const firstArg = args[0];
      if (firstArg instanceof Error) {
        void recordError('console.error', firstArg, false);
        return;
      }
      if (typeof firstArg === 'string' && firstArg.trim()) {
        void recordError('console.error', firstArg, false);
      }
    };

    return () => {
      console.error = originalConsoleError;
      if (previousHandler && errorUtils?.setGlobalHandler) {
        errorUtils.setGlobalHandler(previousHandler);
      }
    };
  }, [recordError]);

  useEffect(() => {
    if (hasLoggedLaunchRef.current) {
      return;
    }

    hasLoggedLaunchRef.current = true;
    void recordDiagnostic('app', 'Application launched');
  }, [recordDiagnostic]);

  useEffect(() => {
    if (!isReady || !hasRestoredStateRef.current) {
      return;
    }

    let cancelled = false;

    const persistCurrentState = async () => {
      try {
        if (authSession) {
          await saveStoredState(appState, String(authSession.user.id));
        }
      } catch {
        if (!cancelled) {
          Alert.alert('Storage warning', 'The change is visible, but it could not be saved on this device.');
        }
      }
    };

    void persistCurrentState();

    return () => {
      cancelled = true;
    };
  }, [appState, authSession, isReady]);

  const updateState = (updater: (current: AppState) => AppState) => {
    setAppState((current) => {
      return updater(current);
    });
  };

  const filteredDocuments = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    return appState.documents
      .filter((document) => {
        if (activeTab === 'costs' && document.workspaceContext !== 'cost') {
          return false;
        }
        if (activeTab === 'sales' && document.workspaceContext !== 'sales') {
          return false;
        }
        if (activeTab === 'claims' && document.claimId) {
          return false;
        }

        if (!term) {
          return statusFilter === 'all' ? true : document.status === statusFilter;
        }

        const matchesSearch = [document.title, document.supplier, document.notes, document.category, document.description, document.customer]
          .join(' ')
          .toLowerCase()
          .includes(term);
        const matchesStatus = statusFilter === 'all' ? true : document.status === statusFilter;
        return matchesSearch && matchesStatus;
      })
      .sort((left, right) => {
        if (sortMode === 'oldest') {
          return left.createdAt.localeCompare(right.createdAt);
        }
        if (sortMode === 'amount_high') {
          return right.amount - left.amount;
        }
        if (sortMode === 'amount_low') {
          return left.amount - right.amount;
        }
        return right.createdAt.localeCompare(left.createdAt);
      });
  }, [activeTab, appState.documents, deferredSearch, sortMode, statusFilter]);

  const selectedDocument = useMemo(
    () => appState.documents.find((document) => document.id === selectedDocumentId) ?? null,
    [appState.documents, selectedDocumentId],
  );
  const captureReviewDocument = useMemo(
    () => appState.documents.find((document) => document.id === captureReviewDocumentId) ?? null,
    [appState.documents, captureReviewDocumentId],
  );

  const claims = useMemo(
    () => [...appState.claims].sort((left, right) => right.name.localeCompare(left.name)),
    [appState.claims],
  );

  const processingAlerts = useMemo(
    () =>
      appState.documents
        .filter((document) => document.extractionStatus !== 'complete' || document.needsReview)
        .slice(0, 20)
        .map((document) => ({
          id: document.id,
          title: document.title,
          message:
            document.extractionStatus === 'pending'
              ? 'Still processing'
              : document.extractionStatus === 'failed'
                ? 'Needs another look'
                : 'Ready for review',
          createdAt: document.updatedAt ?? document.createdAt,
        })),
    [appState.documents],
  );

  const analyticsSummary = useMemo(() => {
    const total = filteredDocuments.reduce((sum, document) => sum + document.amount, 0);
    const vatTotal = vatTrackingEnabled
      ? filteredDocuments.reduce((sum, document) => sum + document.vatAmount, 0)
      : 0;
    return {
      total,
      vatTotal,
      reviewCount: appState.documents.filter((document) => document.status === 'awaiting_review').length,
      submittedCount: appState.documents.filter((document) => document.status === 'submitted').length,
    };
  }, [appState.documents, filteredDocuments, vatTrackingEnabled]);

  const inboundEmailAddress = useMemo(() => {
    if (!authSession) {
      return '';
    }
    return buildInboundEmailAddress(authSession.user.fullName || workspaceName, authSession.user.organisationId);
  }, [authSession]);

  const claimableDocuments = useMemo(
    () =>
      appState.documents
        .filter((document) => document.workspaceContext === 'cost')
        .filter((document) => document.paymentMethod === 'cash_personal')
        .filter((document) => !document.claimId)
        .filter((document) => document.extractionStatus !== 'pending')
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [appState.documents],
  );

  const tabTitle =
    activeTab === 'costs'
      ? 'Costs'
      : activeTab === 'sales'
        ? 'Sales'
        : activeTab === 'claims'
          ? 'Expense claims'
          : 'Settings';

  const syncCaptureType = () => {
    setCaptureType(activeTab === 'sales' ? 'invoice' : 'receipt');
  };

  const openCapture = () => {
    syncCaptureType();
    if (appState.settings.openOnCamera) {
      void handleUseCamera();
      return;
    }
    setCaptureModalVisible(true);
  };

  const openCaptureActions = () => {
    syncCaptureType();
    setSheetTarget('capture_actions');
  };

  const updateSettings = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    updateState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [key]: value,
      },
    }));
  };

  const getCurrentCaptureContext = () => {
    const workspaceContext = getWorkspaceContextForTab(activeTab);
    return {
      workspaceContext,
      paymentMethod: getDefaultPaymentMethod(workspaceContext, Boolean(isAdmin)),
    };
  };

  const commitGalleryAsset = useEffectEvent(
    async (
      asset: {
        uri?: string | null;
        fileName?: string | null;
        assetId?: string | null;
      },
      origin: 'gallery' | 'recovery',
    ) => {
      const assetKey = galleryResultAssetName(asset);
      if (handledGalleryAssetRef.current === assetKey) {
        await recordDiagnostic('gallery', `Skipping duplicate ${origin} asset handoff`);
        return;
      }

      if (!asset.uri) {
        await recordDiagnostic('gallery', `${origin} asset did not provide a usable URI`);
        Alert.alert('Import failed', 'The selected image did not provide a usable file path.');
        return;
      }

      handledGalleryAssetRef.current = assetKey;
      awaitingGalleryResultRef.current = false;
      await recordDiagnostic('gallery', `${origin} image selected: ${asset.fileName ?? 'unnamed'} | uri=${asset.uri}`);
      const nextDocument = await prepareManualDocument({
        source: 'gallery',
        type: captureType,
        uri: asset.uri,
        fileName: asset.fileName ?? `${captureType}-${Date.now()}.jpg`,
        ...getCurrentCaptureContext(),
      });
      await recordDiagnostic('gallery', `Manual draft document built from ${origin}`);
      schedulePreparedDocumentCommit(nextDocument, origin);
      await recordDiagnostic('gallery', 'Document scheduled for deferred state commit');
    },
  );

  useEffect(() => {
    if (hasRecoveredPickerResultRef.current) {
      return;
    }

    hasRecoveredPickerResultRef.current = true;
    void (async () => {
      try {
        const pendingResult = await ImagePicker.getPendingResultAsync();
        if (!pendingResult || 'code' in pendingResult || pendingResult.canceled || !pendingResult.assets?.length) {
          return;
        }

        const asset = pendingResult.assets[0];
        await recordDiagnostic('gallery', `Recovered pending picker result: ${asset.fileName ?? 'unnamed'}`);
        await commitGalleryAsset(asset, 'recovery');
      } catch (error) {
        void recordError('picker pending result', error);
      }
    })();
  }, [commitGalleryAsset, recordDiagnostic, recordError]);

  useEffect(() => {
    const subscription = RNAppState.addEventListener('change', (nextState: string) => {
      if (nextState !== 'active' || !awaitingGalleryResultRef.current) {
        return;
      }

      void (async () => {
        try {
          const pendingResult = await ImagePicker.getPendingResultAsync();
          if (!pendingResult || 'code' in pendingResult || pendingResult.canceled || !pendingResult.assets?.length) {
            await recordDiagnostic('gallery', 'No recoverable pending gallery result was available');
            return;
          }

          await recordDiagnostic('gallery', 'Recovered gallery result after returning to the app');
          await commitGalleryAsset(pendingResult.assets[0], 'recovery');
        } catch (error) {
          void recordError('picker app state recovery', error);
        }
      })();
    });

    return () => {
      subscription.remove();
    };
  }, [commitGalleryAsset, recordDiagnostic, recordError]);

  const addDocument = async ({
    fileName,
    source,
    type,
    uri,
    lowResolution,
    openDetails = true,
    workspaceContext = type === 'invoice' ? 'sales' : 'cost',
    paymentMethod = getDefaultPaymentMethod(type === 'invoice' ? 'sales' : 'cost', Boolean(isAdmin)),
  }: {
    fileName: string;
    source: ExpenseDocument['source'];
    type: DocumentKind;
    uri?: string;
    lowResolution?: boolean;
    openDetails?: boolean;
    workspaceContext?: WorkspaceContext;
    paymentMethod?: PaymentMethod;
  }) => {
    setIsSaving(true);
    try {
      const nextDocument = await buildDraftDocument({
        fileName,
        source,
        type,
        uri,
        lowResolution,
        workspaceContext,
        paymentMethod,
      });
      updateState((current) => ({
        ...current,
        documents: [nextDocument, ...current.documents],
      }));
      if (openDetails) {
        setSelectedDocumentId(nextDocument.id);
      } else {
        setSelectedDocumentId(null);
      }
      setActiveTab(workspaceContext === 'sales' ? 'sales' : 'costs');
      return nextDocument;
    } catch (error) {
      void recordError('addDocument', error);
      console.error('addDocument failed', error);
      Alert.alert(
        'Import failed',
        'The receipt or invoice could not be saved. Please try again with another photo or import method.',
      );
      return null;
    } finally {
      setIsSaving(false);
      setCaptureModalVisible(false);
    }
  };

  const openGalleryPicker = async () => {
    if (String(Platform.OS) === 'android' && NativeGalleryPicker) {
      try {
        await recordDiagnostic('gallery', 'Launching native Android gallery picker');
        const asset = await NativeGalleryPicker.open();
        if (!asset) {
          await recordDiagnostic('gallery', 'Native Android gallery selection canceled');
          return;
        }

        await recordDiagnostic('gallery', `Native Android gallery returned ${asset.fileName}`);
        await commitGalleryAsset(
          {
            uri: asset.uri,
            fileName: asset.fileName,
            assetId: asset.uri,
          },
          'gallery',
        );
      } catch (error) {
        void recordError('native gallery picker', error);
        Alert.alert('Import failed', error instanceof Error ? error.message : 'The selected image could not be imported.');
      }
      return;
    }

    await recordDiagnostic('gallery', 'Requesting photo library permission');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    await recordDiagnostic(
      'gallery',
      `Photo library permission result | granted=${permission.granted ? 'yes' : 'no'} | canAskAgain=${permission.canAskAgain ? 'yes' : 'no'}`,
    );
    if (!permission.granted) {
      await recordDiagnostic('gallery', 'Photo library permission denied');
      Alert.alert(
        'Photos permission needed',
        permission.canAskAgain
          ? 'Allow photo access to import a receipt or invoice image.'
          : 'Photo access is blocked for this app. Open settings and allow access to continue.',
        permission.canAskAgain
          ? [{ text: 'OK' }]
          : [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Open settings',
                onPress: () => {
                  void Linking.openSettings();
                },
              },
            ],
      );
      return;
    }

    await recordDiagnostic('gallery', 'Launching image library');
    awaitingGalleryResultRef.current = true;
    handledGalleryAssetRef.current = null;
    const pickerOptions: any = {
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: false,
      quality: 0.8,
      exif: false,
    };

    try {
      const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
      await recordDiagnostic(
        'gallery',
        `Image library returned | canceled=${result.canceled ? 'yes' : 'no'} | assets=${result.assets?.length ?? 0}`,
      );

      if (!result.canceled && result.assets?.length) {
        await commitGalleryAsset(result.assets[0], 'gallery');
      } else if (!result.canceled) {
        await recordDiagnostic('gallery', 'Image picker returned without assets');
        Alert.alert('Import failed', 'No image was returned from the gallery picker.');
      } else {
        awaitingGalleryResultRef.current = false;
        await recordDiagnostic('gallery', 'Image selection canceled');
      }
    } catch (error) {
      awaitingGalleryResultRef.current = false;
      await recordDiagnostic('gallery', 'Image handling threw an error');
      void recordError('openGalleryPicker', error);
      Alert.alert('Import failed', 'The selected image could not be imported.');
    }
  };

  const handlePickImage = async () => {
    await recordDiagnostic('gallery', `handlePickImage start | cameraVisible=${cameraVisible ? 'yes' : 'no'}`);
    setCaptureModalVisible(false);
    if (cameraVisible) {
      setPendingGalleryOpen(true);
      await recordDiagnostic('gallery', 'Closing camera before opening gallery');
      setCameraVisible(false);
      return;
    }

    await openGalleryPicker();
  };

  const handlePickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });

    try {
      if (!result.canceled) {
        const asset = result.assets[0];
        const captureContext = getCurrentCaptureContext();
        await addDocument({
          fileName: asset.name,
          source: 'files',
          type: captureType,
          uri: asset.uri,
          lowResolution: appState.settings.lowResolution,
          workspaceContext: captureContext.workspaceContext,
          paymentMethod: captureContext.paymentMethod,
        });
      }
    } catch (error) {
      void recordError('handlePickFile', error);
      console.error('handlePickFile failed', error);
      Alert.alert('Import failed', 'The selected file could not be imported.');
    }
  };

  const handleUseCamera = async () => {
    const permission = await Camera.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera permission needed', 'Allow camera access so you can snap a new receipt or invoice.');
      return;
    }

    setCaptureModalVisible(false);
    setCameraVisible(true);
  };

  const handleAddToVault = useEffectEvent(async () => {
    setSheetTarget(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      await addDocument({
        fileName: asset.name,
        source: 'files',
        type: 'receipt',
        uri: asset.uri,
        lowResolution: appState.settings.lowResolution,
        openDetails: false,
        workspaceContext: 'vault',
        paymentMethod: 'not_applicable',
      });
      Alert.alert('Saved to Vault', 'The file was stored in your secure vault without OCR processing.');
    } catch (error) {
      void recordError('handleAddToVault', error);
      Alert.alert('Vault upload failed', error instanceof Error ? error.message : 'Could not save this file to the vault.');
    }
  });

  const deleteDocument = useEffectEvent(async (document: ExpenseDocument) => {
    if (document.claimId) {
      Alert.alert(
        'Document linked to claim',
        'This item is already attached to an expense claim. Remove it from the claim flow first, then delete it.',
      );
      return;
    }

    try {
      if (document.cloudReceiptId) {
        await deleteCloudReceipt(document.cloudReceiptId);
        deletedCloudReceiptIdsRef.current.add(document.cloudReceiptId);
      }

      updateState((current) => ({
        ...current,
        documents: current.documents.filter((item) => item.id !== document.id),
      }));
      setSelectedDocumentId((current) => (current === document.id ? null : current));
      if (authSession) {
        await syncCloudWorkspace(authSession);
      }
    } catch (error) {
      void recordError('deleteDocument', error);
      Alert.alert('Delete failed', error instanceof Error ? error.message : 'Could not delete this document.');
    }
  });

  const confirmDeleteDocument = useEffectEvent((document: ExpenseDocument) => {
    Alert.alert(
      'Delete document',
      `Delete ${document.title}? This cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteDocument(document);
          },
        },
      ],
    );
  });

  const updateDocumentStatus = useEffectEvent(async (
    documentId: string,
    status: ExpenseDocument['status'],
    successConfirmation?: {
      title: string;
      message: string;
    },
  ) => {
    const updatedAt = new Date().toISOString();
    updateState((current) => ({
      ...current,
      documents: current.documents.map((document) =>
        document.id === documentId ? { ...document, status, updatedAt } : document,
      ),
    }));
    try {
      await syncDocumentToCloud(documentId, { status });
      if (successConfirmation) {
        Alert.alert(successConfirmation.title, successConfirmation.message);
      }
    } catch (error) {
      void recordError('update document status', error);
      Alert.alert('Sync failed', error instanceof Error ? error.message : 'Could not sync this receipt update.');
    }
  });

  const updateDocumentReviewFields = useEffectEvent(async (
    documentId: string,
    reviewFields: Pick<
      ExpenseDocument,
      'amount' | 'netAmount' | 'vatAmount' | 'taxAmount' | 'taxRateApplied' | 'category' | 'description' | 'customer'
    >,
    successConfirmation?: {
      title: string;
      message: string;
    },
    syncStrategy: 'wait' | 'background' = 'wait',
  ) => {
    const updatedAt = new Date().toISOString();
    updateState((current) => ({
      ...current,
      documents: current.documents.map((document) =>
        document.id === documentId ? { ...document, ...reviewFields, needsReview: true, updatedAt } : document,
      ),
    }));
    if (syncStrategy === 'background') {
      if (successConfirmation) {
        Alert.alert(successConfirmation.title, successConfirmation.message);
      }
      void syncDocumentToCloud(documentId, reviewFields).catch((error) => {
        void recordError('update review fields', error);
        Alert.alert('Sync failed', error instanceof Error ? error.message : 'Could not sync this receipt update.');
      });
      return;
    }
    try {
      await syncDocumentToCloud(documentId, reviewFields);
      if (successConfirmation) {
        Alert.alert(successConfirmation.title, successConfirmation.message);
      }
    } catch (error) {
      void recordError('update review fields', error);
      Alert.alert('Sync failed', error instanceof Error ? error.message : 'Could not sync this receipt update.');
    }
  });

  const createClaimFromReceipt = useEffectEvent(async (document: ExpenseDocument) => {
    if (!authSession) {
      return;
    }
    if (!document.cloudReceiptId) {
      Alert.alert('Receipt not synced yet', 'Wait for the upload to finish before adding this item to a claim.');
      return;
    }

    try {
      const created = await createCloudClaim({
        name: `${document.supplier || 'Expense'} Claim`,
        description: `Claim created from ${document.title}`,
        currency: document.currency,
      });
      await attachCloudReceiptToClaim({
        receiptId: document.cloudReceiptId,
        claimId: created.id,
      });
      await syncCloudWorkspace(authSession);
      setActiveTab('claims');
      setSelectedDocumentId(null);
    } catch (error) {
      void recordError('createClaimFromReceipt', error);
      Alert.alert('Claim failed', error instanceof Error ? error.message : 'Could not create this expense claim.');
    }
  });

  const handleAttachToClaim = useEffectEvent(async (claim: Claim, document: ExpenseDocument) => {
    if (!authSession) {
      return;
    }
    if (!claim.cloudClaimId || !document.cloudReceiptId) {
      Alert.alert('Not ready yet', 'This claim or document has not synced to the server yet.');
      return;
    }

    try {
      await attachCloudReceiptToClaim({
        claimId: claim.cloudClaimId,
        receiptId: document.cloudReceiptId,
      });
      await syncCloudWorkspace(authSession);
    } catch (error) {
      void recordError('handleAttachToClaim', error);
      Alert.alert('Attach failed', error instanceof Error ? error.message : 'Could not add this document to the claim.');
    }
  });

  const handleRefreshFeed = useEffectEvent(async () => {
    setHeaderMenuVisible(false);
    if (!authSession) {
      return;
    }
    try {
      await syncCloudWorkspace(authSession);
    } catch (error) {
      void recordError('refresh feed', error);
    }
  });

  const handleOpenBulkSelection = () => {
    setHeaderMenuVisible(false);
    setBulkSelectionEnabled(true);
    setSelectedDocumentIds([]);
  };

  const toggleBulkDocumentSelection = (documentId: string) => {
    setSelectedDocumentIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId],
    );
  };

  const clearBulkSelection = () => {
    setBulkSelectionEnabled(false);
    setSelectedDocumentIds([]);
  };

  const handleBulkMarkReviewed = useEffectEvent(async () => {
    const targets = appState.documents.filter((document) => selectedDocumentIds.includes(document.id));
    for (const document of targets) {
      await updateDocumentStatus(document.id, 'ready_to_submit');
    }
    clearBulkSelection();
  });

  const handleBulkDelete = () => {
    const targets = appState.documents.filter((document) => selectedDocumentIds.includes(document.id));
    if (!targets.length) {
      return;
    }

    Alert.alert('Delete selected items', `Delete ${targets.length} selected item${targets.length === 1 ? '' : 's'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          targets.forEach((document) => {
            void deleteDocument(document);
          });
          clearBulkSelection();
        },
      },
    ]);
  };

  const handleOpenClaimComposer = () => {
    setClaimTitleInput(`Expense Claim ${new Date().toLocaleDateString('en-GB')}`);
    setClaimStartDateInput(new Date().toISOString().slice(0, 10));
    setClaimEndDateInput(new Date().toISOString().slice(0, 10));
    setClaimComposerVisible(true);
  };

  const submitClaimComposer = useEffectEvent(async () => {
    try {
      await createCloudClaim({
        name: claimTitleInput.trim() || `Expense Claim ${new Date().toLocaleDateString('en-GB')}`,
        description: `Date range: ${claimStartDateInput} to ${claimEndDateInput}`,
        currency: 'GBP',
      });
      setClaimComposerVisible(false);
      if (authSession) {
        await syncCloudWorkspace(authSession);
      }
    } catch (error) {
      void recordError('submit claim composer', error);
      Alert.alert('Claim failed', error instanceof Error ? error.message : 'Could not create a new claim.');
    }
  });

  const submitMileageClaim = useEffectEvent(async () => {
    const miles = Number.parseFloat(mileageMilesInput);
    if (!mileageStartInput.trim() || !mileageEndInput.trim() || !Number.isFinite(miles) || miles <= 0) {
      Alert.alert('Mileage details needed', 'Add the start postcode, end postcode, and total miles.');
      return;
    }

    const mileageAmount = Number((miles * 0.45).toFixed(2));
    try {
      await createCloudClaim({
        name: `Mileage claim ${new Date().toLocaleDateString('en-GB')}`,
        description: `${mileageStartInput.trim()} to ${mileageEndInput.trim()} | ${miles.toFixed(1)} miles | Estimated value ${formatCurrency(mileageAmount)}`,
        currency: 'GBP',
      });
      setMileageVisible(false);
      setMileageStartInput('');
      setMileageEndInput('');
      setMileageMilesInput('');
      if (authSession) {
        await syncCloudWorkspace(authSession);
      }
    } catch (error) {
      void recordError('submit mileage claim', error);
      Alert.alert('Mileage claim failed', error instanceof Error ? error.message : 'Could not create the mileage claim.');
    }
  });

  const saveVehicle = () => {
    const name = vehicleNameInput.trim();
    const registration = vehicleRegistrationInput.trim().toUpperCase();
    if (!name || !registration) {
      Alert.alert('Vehicle details needed', 'Add a vehicle name and registration.');
      return;
    }

    updateState((current) => ({
      ...current,
      vehicles: editingVehicleId
        ? current.vehicles.map((vehicle) =>
            vehicle.id === editingVehicleId ? { ...vehicle, name, registration } : vehicle,
          )
        : [...current.vehicles, { id: `vehicle-${Date.now()}`, name, registration }],
    }));
    setVehicleNameInput('');
    setVehicleRegistrationInput('');
    setEditingVehicleId(null);
  };

  const editVehicle = (vehicle: Vehicle) => {
    setEditingVehicleId(vehicle.id);
    setVehicleNameInput(vehicle.name);
    setVehicleRegistrationInput(vehicle.registration);
  };

  const removeVehicle = (vehicleId: string) => {
    updateState((current) => ({
      ...current,
      vehicles: current.vehicles.filter((vehicle) => vehicle.id !== vehicleId),
    }));
  };

  const handleTeamExport = useEffectEvent(async () => {
    const csvRows = [
      ['Type', 'Supplier', 'Amount', 'Status', 'Date'],
      ...appState.documents.map((document) => [
        document.type,
        document.supplier,
        document.amount.toFixed(2),
        getStatusLabel(document.status),
        document.date,
      ]),
    ];
    const csv = csvRows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');

    try {
      await Share.share({
        title: 'Exdox team export',
        message: csv,
      });
    } catch (error) {
      void recordError('team export', error);
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Could not prepare the team export.');
    }
  });

  if (!isReady) {
    return (
      <SafeAreaView style={[styles.loadingScreen, shellBackgroundStyle]}>
        <StatusBar style={effectiveTheme === 'dark' ? 'light' : 'dark'} />
        <Image source={brandBadge} resizeMode="contain" style={styles.loadingLogo} />
        <Text style={[styles.loadingText, shellTextStyle]}>Preparing your workspace...</Text>
      </SafeAreaView>
    );
  }

  if (!authSession) {
    return (
      <SafeAreaView style={[styles.safeArea, shellBackgroundStyle]}>
        <StatusBar style={effectiveTheme === 'dark' ? 'light' : 'dark'} />
        <AuthScreen
          mode={authMode}
          fullName={authFullName}
          organisationName={authOrganisationName}
          email={authEmail}
          password={authPassword}
          busy={authBusy}
          onChangeMode={setAuthMode}
          onOpenReset={() => setAuthMode('reset')}
          onBackToLogin={() => setAuthMode('login')}
          onChangeFullName={setAuthFullName}
          onChangeOrganisationName={setAuthOrganisationName}
          onChangeEmail={setAuthEmail}
          onChangePassword={setAuthPassword}
          onSubmit={() => void submitAuth()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, shellBackgroundStyle]}>
      <StatusBar style={effectiveTheme === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.screen, shellBackgroundStyle]}>
        <TopHeader
          title={tabTitle}
          subtitle={authSession.user.fullName || authSession.user.email}
          notificationCount={processingAlerts.length}
          onOpenNotifications={() => setNotificationsVisible(true)}
          onOpenMore={() => setHeaderMenuVisible(true)}
        />

        {(activeTab === 'costs' || activeTab === 'sales' || activeTab === 'claims') && (
          <SearchBand value={search} onChangeText={setSearch} onOpenFilter={() => setFilterVisible(true)} />
        )}

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {activeTab === 'costs' && (
            <CostsScreen
              documents={filteredDocuments}
              onOpenDocument={setSelectedDocumentId}
              bulkSelectionEnabled={bulkSelectionEnabled}
              selectedDocumentIds={selectedDocumentIds}
              onToggleSelect={toggleBulkDocumentSelection}
              onDeleteDocument={(document) => confirmDeleteDocument(document)}
              onAddDocument={openCapture}
            />
          )}
          {activeTab === 'sales' && (
            <SalesScreen
              documents={filteredDocuments}
              onOpenDocument={setSelectedDocumentId}
              bulkSelectionEnabled={bulkSelectionEnabled}
              selectedDocumentIds={selectedDocumentIds}
              onToggleSelect={toggleBulkDocumentSelection}
              onDeleteDocument={(document) => confirmDeleteDocument(document)}
              onAddDocument={openCapture}
            />
          )}
          {activeTab === 'claims' && (
            <ClaimsScreen
              claims={claims}
              documents={appState.documents}
              claimableDocuments={claimableDocuments}
              onCreateClaim={handleOpenClaimComposer}
              onAttachDocument={(claim, document) => void handleAttachToClaim(claim, document)}
            />
          )}
          {activeTab === 'more' && (
            <SettingsScreen
              accountName={authSession.user.fullName || workspaceName}
              accountEmail={authSession.user.email}
              role={authSession.user.role}
              settings={appState.settings}
              organisationSettings={appState.organisationSettings}
              errorLogCount={errorLogs.length}
              onUpdateSetting={updateSettings}
              onOpenTheme={() => setThemeVisible(true)}
              onOpenPanel={setSettingsPanelTarget}
              onOpenErrorLog={() => setErrorLogVisible(true)}
              onSignOut={() => void handleSignOut()}
            />
          )}
        </ScrollView>

        <BottomNav
          activeTab={activeTab}
          onSelect={setActiveTab}
          onOpenCamera={openCapture}
          onOpenCaptureActions={openCaptureActions}
        />

        <CaptureModal
          visible={captureModalVisible}
          captureType={captureType}
          activeTab={activeTab}
          isAdmin={Boolean(isAdmin)}
          isSaving={isSaving}
          onClose={() => setCaptureModalVisible(false)}
          onSelectType={setCaptureType}
          onUseCamera={handleUseCamera}
          onUseGallery={handlePickImage}
          onUseFiles={handlePickFile}
        />

        <MoreSheet
          target={sheetTarget}
          isAdmin={Boolean(isAdmin)}
          onClose={() => setSheetTarget(null)}
          onOpenSettings={() => {
            setActiveTab('more');
            setSheetTarget(null);
          }}
          onOpenVault={() => {
            setSettingsPanelTarget('vault');
            setSheetTarget(null);
          }}
          onOpenTeamAdmin={() => {
            setSettingsPanelTarget('team_admin');
            setSheetTarget(null);
          }}
          onOpenCamera={() => {
            setSheetTarget(null);
            void handleUseCamera();
          }}
          onUseGallery={() => {
            setSheetTarget(null);
            void handlePickImage();
          }}
          onCreateMileageClaim={() => {
            setSheetTarget(null);
            setMileageVisible(true);
          }}
          onAddToVault={() => void handleAddToVault()}
        />

        <CaptureReviewScreen
          document={captureReviewDocument}
          ownerName={authSession?.user.fullName ?? authSession?.user.email ?? 'Current user'}
          onClose={() => setCaptureReviewDocumentId(null)}
          onSubmit={async (reviewFields) => {
            if (!captureReviewDocument) {
              return;
            }
            await updateDocumentReviewFields(captureReviewDocument.id, reviewFields);
            setCaptureReviewDocumentId(null);
            setSelectedDocumentId(null);
            setActiveTab(captureReviewDocument.type === 'invoice' ? 'sales' : 'costs');
          }}
        />

        <DocumentSheet
          document={selectedDocument}
          ownerName={authSession?.user.fullName ?? authSession?.user.email ?? 'Current user'}
          vatTrackingEnabled={vatTrackingEnabled}
          onClose={() => setSelectedDocumentId(null)}
          onMarkReviewed={() => {
            if (selectedDocument) {
              void updateDocumentStatus(selectedDocument.id, 'ready_to_submit', {
                title: 'Marked reviewed',
                message: 'This receipt has been marked as reviewed.',
              });
            }
          }}
          onAddToClaim={() => {
            if (selectedDocument) {
              void createClaimFromReceipt(selectedDocument);
            }
          }}
          onUpdateReviewFields={(reviewFields) => {
            if (selectedDocument) {
              void updateDocumentReviewFields(selectedDocument.id, reviewFields, {
                title: 'Values saved',
                message: 'The receipt values have been saved.',
              }, 'background');
            }
          }}
          onMarkSubmitted={() => {
            if (selectedDocument) {
              void updateDocumentStatus(selectedDocument.id, 'submitted', {
                title: 'Marked submitted',
                message: 'This receipt has been marked as submitted.',
              });
            }
          }}
          onDelete={() => {
            if (selectedDocument) {
              confirmDeleteDocument(selectedDocument);
            }
          }}
        />

        <ErrorLogSheet
          visible={errorLogVisible}
          logs={[...errorLogs, ...diagnosticLogs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))}
          onClose={() => setErrorLogVisible(false)}
          onClear={async () => {
            await clearStoredDiagnosticLogs();
            await clearStoredErrorLogs();
            setErrorLogs([]);
            setDiagnosticLogs([]);
            setErrorLogVisible(false);
          }}
        />

        <HeaderMenuSheet
          visible={headerMenuVisible}
          bulkSelectionEnabled={bulkSelectionEnabled}
          selectedCount={selectedDocumentIds.length}
          onClose={() => setHeaderMenuVisible(false)}
          onSelectMultiple={handleOpenBulkSelection}
          onRefresh={() => void handleRefreshFeed()}
          onBulkMarkReviewed={() => void handleBulkMarkReviewed()}
          onBulkDelete={handleBulkDelete}
          onClearSelection={clearBulkSelection}
        />

        <NotificationsSheet
          visible={notificationsVisible}
          notifications={processingAlerts}
          onClose={() => setNotificationsVisible(false)}
          onOpenDocument={(documentId) => {
            setNotificationsVisible(false);
            setSelectedDocumentId(documentId);
          }}
        />

        <FilterSheet
          visible={filterVisible}
          statusFilter={statusFilter}
          sortMode={sortMode}
          onClose={() => setFilterVisible(false)}
          onSelectStatus={setStatusFilter}
          onSelectSort={setSortMode}
        />

        <ClaimComposerSheet
          visible={claimComposerVisible}
          title={claimTitleInput}
          startDate={claimStartDateInput}
          endDate={claimEndDateInput}
          onClose={() => setClaimComposerVisible(false)}
          onChangeTitle={setClaimTitleInput}
          onChangeStartDate={setClaimStartDateInput}
          onChangeEndDate={setClaimEndDateInput}
          onSubmit={() => void submitClaimComposer()}
        />

        <MileageClaimSheet
          visible={mileageVisible}
          startPostcode={mileageStartInput}
          endPostcode={mileageEndInput}
          totalMiles={mileageMilesInput}
          onClose={() => setMileageVisible(false)}
          onChangeStartPostcode={setMileageStartInput}
          onChangeEndPostcode={setMileageEndInput}
          onChangeTotalMiles={setMileageMilesInput}
          onSubmit={() => void submitMileageClaim()}
        />

        <ThemeSheet
          visible={themeVisible}
          value={appState.settings.theme}
          onClose={() => setThemeVisible(false)}
          onSelect={(theme) => {
            updateSettings('theme', theme);
            setThemeVisible(false);
          }}
        />

        <SettingsPanelSheet
          visible={Boolean(settingsPanelTarget)}
          target={settingsPanelTarget}
          role={authSession.user.role}
          organisationSettings={appState.organisationSettings}
          inboundEmailAddress={inboundEmailAddress}
          analyticsSummary={analyticsSummary}
          vatTrackingEnabled={vatTrackingEnabled}
          vehicles={appState.vehicles}
          vehicleNameInput={vehicleNameInput}
          vehicleRegistrationInput={vehicleRegistrationInput}
          editingVehicleId={editingVehicleId}
          onClose={() => setSettingsPanelTarget(null)}
          onSaveOrganisationSettings={async (nextSettings) => {
            setAppState((current) => ({
              ...current,
              organisationSettings: current.organisationSettings
                ? {
                    ...current.organisationSettings,
                    ...nextSettings,
                  }
                : current.organisationSettings,
              documents: current.documents.map((document) =>
                nextSettings.isVatRegistered
                  ? document
                  : {
                      ...document,
                      ...normalizeVatDisabledValues(document),
                    },
              ),
            }));
            void (async () => {
              try {
                const savedSettings = await saveOrganisationSettings(nextSettings);
                setAppState((current) => ({
                  ...current,
                  organisationSettings: savedSettings,
                }));
                if (authSession) {
                  await syncCloudWorkspace(authSession);
                }
              } catch (error) {
                void recordError('organisation settings save', error);
                if (authSession) {
                  try {
                    const restoredSettings = await fetchOrganisationSettings();
                    setAppState((current) => ({
                      ...current,
                      organisationSettings: restoredSettings,
                    }));
                    await syncCloudWorkspace(authSession);
                  } catch (restoreError) {
                    void recordError('organisation settings restore', restoreError);
                  }
                }
              }
            })();
          }}
          onExport={() => void handleTeamExport()}
          onChangeVehicleName={setVehicleNameInput}
          onChangeVehicleRegistration={setVehicleRegistrationInput}
          onSaveVehicle={saveVehicle}
          onEditVehicle={editVehicle}
          onDeleteVehicle={removeVehicle}
        />

        <CameraCapture
          visible={cameraVisible}
          type={captureType}
          lowResolution={appState.settings.lowResolution}
          onClose={() => setCameraVisible(false)}
          onUseGallery={() => {
            void handlePickImage();
          }}
          onCapture={async (uri) => {
            setCameraVisible(false);
            try {
              const nextDocument = await prepareManualDocument({
                source: 'camera',
                type: captureType,
                uri,
                fileName: `${captureType}-${Date.now()}.jpg`,
                ...getCurrentCaptureContext(),
              });
              schedulePreparedDocumentCommit(nextDocument, 'camera');
              void recordDiagnostic('camera', 'Document scheduled for deferred state commit');
            } catch (error) {
              void recordError('camera draft save', error);
              console.error('camera draft save failed', error);
              Alert.alert(
                'Import failed',
                'The receipt photo could not be saved. Please try again or import from gallery.',
              );
              setSelectedDocumentId(null);
            }
          }}
        />
      </View>
    </SafeAreaView>
  );
}

function TopHeader({
  title,
  subtitle,
  notificationCount,
  onOpenNotifications,
  onOpenMore,
}: {
  title: string;
  subtitle: string;
  notificationCount: number;
  onOpenNotifications: () => void;
  onOpenMore: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerBrandBlock}>
        <Image source={brandBadge} resizeMode="contain" style={styles.headerBrandMark} />
        <View>
          <Text style={styles.headerTitle}>{title}</Text>
          <Text style={styles.headerSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.headerActions}>
        <Pressable onPress={onOpenNotifications} hitSlop={8} style={styles.headerIconButton}>
          <Ionicons name="notifications-outline" size={24} color={colors.nearBlack} />
          {notificationCount ? (
            <View style={styles.headerNotificationDot}>
              <Text style={styles.headerNotificationDotText}>{Math.min(notificationCount, 9)}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable onPress={onOpenMore} hitSlop={8}>
          <Ionicons name="ellipsis-vertical" size={22} color={colors.nearBlack} />
        </Pressable>
      </View>
    </View>
  );
}

function SearchBand({
  value,
  onChangeText,
  onOpenFilter,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onOpenFilter: () => void;
}) {
  return (
    <View style={styles.searchBand}>
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={24} color={colors.nearBlack} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Search"
          placeholderTextColor={colors.mutedText}
          style={styles.searchInput}
        />
      </View>
      <Pressable onPress={onOpenFilter} hitSlop={8}>
        <Ionicons name="filter-outline" size={24} color={colors.nearBlack} />
      </Pressable>
    </View>
  );
}

function CostsScreen({
  documents,
  onOpenDocument,
  bulkSelectionEnabled,
  selectedDocumentIds,
  onToggleSelect,
  onDeleteDocument,
  onAddDocument,
}: {
  documents: ExpenseDocument[];
  onOpenDocument: (id: string) => void;
  bulkSelectionEnabled: boolean;
  selectedDocumentIds: string[];
  onToggleSelect: (id: string) => void;
  onDeleteDocument: (document: ExpenseDocument) => void;
  onAddDocument: () => void;
}) {
  if (!documents.length) {
    return (
      <BlankPanel
        icon="receipt-outline"
        title="No costs yet"
        copy="Add your first receipt to start reviewing costs."
        actionLabel="Add document"
        onAction={onAddDocument}
      />
    );
  }

  return (
    <FlatList
      data={documents}
      keyExtractor={(item) => item.id.toString()}
      scrollEnabled={false}
      ListHeaderComponent={
        <View style={styles.dayHeader}>
          <Text style={styles.dayHeaderText}>Today</Text>
        </View>
      }
      renderItem={({ item }) => (
        <DocumentRow
          document={item}
          selected={selectedDocumentIds.includes(item.id)}
          selectionMode={bulkSelectionEnabled}
          onPress={() => (bulkSelectionEnabled ? onToggleSelect(item.id) : onOpenDocument(item.id))}
          onStatusPress={() => onOpenDocument(item.id)}
          onLongPress={() => onDeleteDocument(item)}
        />
      )}
    />
  );
}

function SalesScreen({
  documents,
  onOpenDocument,
  bulkSelectionEnabled,
  selectedDocumentIds,
  onToggleSelect,
  onDeleteDocument,
  onAddDocument,
}: {
  documents: ExpenseDocument[];
  onOpenDocument: (id: string) => void;
  bulkSelectionEnabled: boolean;
  selectedDocumentIds: string[];
  onToggleSelect: (id: string) => void;
  onDeleteDocument: (document: ExpenseDocument) => void;
  onAddDocument: () => void;
}) {
  if (!documents.length) {
    return (
      <BlankPanel
        icon="document-text-outline"
        title="No documents yet"
        copy="Start adding sales documents to process them."
        actionLabel="Add document"
        onAction={onAddDocument}
      />
    );
  }

  return (
    <FlatList
      data={documents}
      keyExtractor={(item) => item.id.toString()}
      scrollEnabled={false}
      renderItem={({ item }) => (
        <DocumentRow
          document={item}
          selected={selectedDocumentIds.includes(item.id)}
          selectionMode={bulkSelectionEnabled}
          onPress={() => (bulkSelectionEnabled ? onToggleSelect(item.id) : onOpenDocument(item.id))}
          onStatusPress={() => onOpenDocument(item.id)}
          onLongPress={() => onDeleteDocument(item)}
        />
      )}
    />
  );
}

function ClaimsScreen({
  claims,
  documents,
  claimableDocuments,
  onCreateClaim,
  onAttachDocument,
}: {
  claims: Claim[];
  documents: ExpenseDocument[];
  claimableDocuments: ExpenseDocument[];
  onCreateClaim: () => void;
  onAttachDocument: (claim: Claim, document: ExpenseDocument) => void;
}) {
  if (!claims.length) {
    return (
      <BlankPanel
        icon="newspaper-outline"
        title="No expense claims yet"
        copy="Create a claim, then attach processed cash or personal cost items to it."
        actionLabel="Create claim"
        onAction={onCreateClaim}
      />
    );
  }

  return (
    <View style={styles.claimsList}>
      <Pressable style={styles.claimCreateButton} onPress={onCreateClaim}>
        <Ionicons name="add-circle-outline" size={20} color={colors.white} />
        <Text style={styles.claimCreateButtonText}>Create claim</Text>
      </Pressable>
      {claims.map((claim) => (
        <View key={claim.id} style={styles.claimCard}>
          <View style={styles.claimRow}>
            <View style={styles.claimRowLeft}>
              <Text style={styles.claimName}>{claim.name}</Text>
              <Text style={styles.claimMeta}>{claim.description || `${claim.documentIds.length} item linked`}</Text>
            </View>
            <Text style={styles.claimAmount}>
              {claim.currency} {claim.total.toFixed(2)}
            </Text>
          </View>
          <View style={styles.claimAttachList}>
            {claimableDocuments.length ? (
              claimableDocuments.slice(0, 3).map((document) => (
                <Pressable key={`${claim.id}-${document.id}`} style={styles.claimAttachButton} onPress={() => onAttachDocument(claim, document)}>
                  <Text style={styles.claimAttachButtonText}>{`Add ${document.title}`}</Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.claimMeta}>No cash or personal cost items are ready to attach.</Text>
            )}
          </View>
        </View>
      ))}
      {documents
        .filter((document) => document.claimId)
        .map((document) => (
          <DocumentRow key={document.id} document={document} onPress={() => undefined} compact />
        ))}
    </View>
  );
}

function AuthScreen({
  mode,
  fullName,
  organisationName,
  email,
  password,
  busy,
  onChangeMode,
  onOpenReset,
  onBackToLogin,
  onChangeFullName,
  onChangeOrganisationName,
  onChangeEmail,
  onChangePassword,
  onSubmit,
}: {
  mode: 'login' | 'register' | 'reset';
  fullName: string;
  organisationName: string;
  email: string;
  password: string;
  busy: boolean;
  onChangeMode: (mode: 'login' | 'register' | 'reset') => void;
  onOpenReset: () => void;
  onBackToLogin: () => void;
  onChangeFullName: (value: string) => void;
  onChangeOrganisationName: (value: string) => void;
  onChangeEmail: (value: string) => void;
  onChangePassword: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.authScreen}>
      <View style={styles.authCard}>
        <Image source={brandLogo} resizeMode="contain" style={styles.authLogo} />
        <Text style={styles.authTitle}>exdox</Text>
        <Text style={styles.authSubtitle}>
          {mode === 'login'
            ? 'Sign in to your receipt workspace.'
            : mode === 'register'
              ? 'Create your secure receipt workspace.'
              : 'Request help getting back into your Exdox workspace.'}
        </Text>

        {mode !== 'reset' ? (
          <View style={styles.authTabs}>
            <Pressable
              style={[styles.authTab, mode === 'login' && styles.authTabActive]}
              onPress={() => onChangeMode('login')}
            >
              <Text style={[styles.authTabText, mode === 'login' && styles.authTabTextActive]}>Login</Text>
            </Pressable>
            <Pressable
              style={[styles.authTab, mode === 'register' && styles.authTabActive]}
              onPress={() => onChangeMode('register')}
            >
              <Text style={[styles.authTabText, mode === 'register' && styles.authTabTextActive]}>Register</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.authSecondaryLink} onPress={onBackToLogin}>
            <Text style={styles.authSecondaryLinkText}>Back to login</Text>
          </Pressable>
        )}

        {mode === 'register' ? (
          <>
            <TextInput
              value={fullName}
              onChangeText={onChangeFullName}
              placeholder="Full name"
              placeholderTextColor={colors.mutedText}
              style={styles.authInput}
            />
            <TextInput
              value={organisationName}
              onChangeText={onChangeOrganisationName}
              placeholder="Business name"
              placeholderTextColor={colors.mutedText}
              style={styles.authInput}
            />
          </>
        ) : null}
        <TextInput
          value={email}
          onChangeText={onChangeEmail}
          placeholder={mode === 'reset' ? 'Work email' : 'Email'}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholderTextColor={colors.mutedText}
          style={styles.authInput}
        />
        {mode !== 'reset' ? (
          <TextInput
            value={password}
            onChangeText={onChangePassword}
            placeholder="Password"
            secureTextEntry
            placeholderTextColor={colors.mutedText}
            style={styles.authInput}
          />
        ) : null}

        <Pressable style={[styles.authButton, busy && styles.authButtonDisabled]} onPress={onSubmit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.authButtonText}>
              {mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Request reset help'}
            </Text>
          )}
        </Pressable>
        {mode === 'login' ? (
          <Pressable style={styles.authSecondaryLink} onPress={onOpenReset}>
            <Text style={styles.authSecondaryLinkText}>Forgot password?</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function SettingsScreen({
  accountName,
  accountEmail,
  role,
  settings,
  organisationSettings,
  errorLogCount,
  onUpdateSetting,
  onOpenTheme,
  onOpenPanel,
  onOpenErrorLog,
  onSignOut,
}: {
  accountName: string;
  accountEmail: string;
  role: 'Business_Admin' | 'Standard_Employee';
  settings: UserSettings;
  organisationSettings: OrganisationSettings | null;
  errorLogCount: number;
  onUpdateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
  onOpenTheme: () => void;
  onOpenPanel: (target: SettingsPanelTarget) => void;
  onOpenErrorLog: () => void;
  onSignOut: () => void;
}) {
  return (
    <View>
      <View style={styles.profileRow}>
        <View style={styles.profileAvatar}>
          <Ionicons name="person-outline" size={28} color={colors.nearBlack} />
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileName}>{accountName}</Text>
          <Text style={styles.profileEmail}>{accountEmail}</Text>
          <Text style={styles.profileRole}>
            {role === 'Business_Admin' ? 'Business admin access' : 'Standard employee access'}
          </Text>
        </View>
      </View>

      {role === 'Business_Admin' ? (
        <SettingsButton icon="business-outline" label="Business admin access" onPress={() => onOpenPanel('business_admin')} />
      ) : null}
      <SettingsButton icon="people-outline" label="Logins" onPress={() => onOpenPanel('logins')} />
      <SettingsButton icon="mail-outline" label="Extract by email" onPress={() => onOpenPanel('extract_email')} />
      <SettingsButton icon="car-outline" label="Vehicles" onPress={() => onOpenPanel('vehicles')} />
      {role === 'Business_Admin' ? (
        <>
          <SettingsButton icon="bar-chart-outline" label="Analytics" onPress={() => onOpenPanel('analytics')} />
          <SettingsButton icon="download-outline" label="Team exports" onPress={() => onOpenPanel('team_exports')} />
        </>
      ) : null}
      <SettingsButton
        icon="alert-circle-outline"
        label={`Error log${errorLogCount ? ` (${errorLogCount})` : ''}`}
        onPress={onOpenErrorLog}
      />
      <SettingsButton icon="log-out-outline" label="Sign out" onPress={onSignOut} />

      <View style={styles.settingsGroup}>
        {role === 'Business_Admin' && organisationSettings ? (
          <View style={styles.settingRow}>
            <View style={styles.settingLabelWrap}>
              <Ionicons name="receipt-outline" size={22} color={colors.nearBlack} />
              <Text style={styles.settingLabel}>Business is VAT Registered</Text>
            </View>
            <Text style={styles.settingValue}>{organisationSettings.isVatRegistered ? 'On' : 'Off'}</Text>
          </View>
        ) : null}
        <SettingToggleRow
          icon="camera-outline"
          label="Open on camera"
          value={settings.openOnCamera}
          onValueChange={(value) => onUpdateSetting('openOnCamera', value)}
        />
        <SettingToggleRow
          icon="scan-outline"
          label="Low resolution"
          value={settings.lowResolution}
          onValueChange={(value) => onUpdateSetting('lowResolution', value)}
        />
        <SettingToggleRow
          icon="image-outline"
          label="Save to gallery"
          value={settings.saveToGallery}
          onValueChange={(value) => onUpdateSetting('saveToGallery', value)}
        />
        <SettingToggleRow
          icon="musical-notes-outline"
          label="In-app sounds"
          value={settings.inAppSounds}
          onValueChange={(value) => onUpdateSetting('inAppSounds', value)}
        />
        <View style={styles.settingRow}>
          <View style={styles.settingLabelWrap}>
            <Ionicons name="sunny-outline" size={22} color={colors.nearBlack} />
            <Text style={styles.settingLabel}>Theme</Text>
          </View>
          <Pressable onPress={onOpenTheme}>
            <Text style={styles.settingValue}>
              {settings.theme === 'system' ? 'System default' : settings.theme === 'light' ? 'Light' : 'Dark'}
            </Text>
          </Pressable>
        </View>
        <SettingToggleRow
          icon="notifications-outline"
          label="Marketing notifications"
          value={settings.marketingNotifications}
          onValueChange={(value) => onUpdateSetting('marketingNotifications', value)}
        />
      </View>
    </View>
  );
}

function SettingToggleRow({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLabelWrap}>
        <Ionicons name={icon} size={22} color={colors.nearBlack} />
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.softBlueGrey, true: colors.softBlueGrey }}
        thumbColor={colors.nearBlack}
      />
    </View>
  );
}

function SettingsButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.settingsLink} onPress={onPress}>
      <Ionicons name={icon} size={24} color={colors.nearBlack} />
      <Text style={styles.settingsLinkText}>{label}</Text>
    </Pressable>
  );
}

function BlankPanel({
  icon,
  title,
  copy,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  copy: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.blankState}>
      <View style={styles.blankIconWrap}>
        <Ionicons name={icon} size={78} color={colors.midBlueGrey} />
      </View>
      <Text style={styles.blankTitle}>{title}</Text>
      {copy ? <Text style={styles.blankCopy}>{copy}</Text> : null}
      {actionLabel ? (
        <Pressable style={styles.blankButton} onPress={onAction}>
          <Text style={styles.blankButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const DocumentRow = memo(function DocumentRow({
  document,
  onPress,
  onStatusPress,
  onLongPress,
  compact = false,
  selectionMode = false,
  selected = false,
}: {
  document: ExpenseDocument;
  onPress: () => void;
  onStatusPress?: () => void;
  onLongPress?: () => void;
  compact?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
}) {
  const hasPreviewImage = canPreviewDocumentInline(document);
  const isProcessing = document.extractionStatus === 'pending';
  const isUnreadableReceipt = document.extractionStatus === 'failed' || extractionLooksUnreadable(document);
  const isDuplicateReceipt = extractionLooksLikeDuplicateUpload(document);
  const extractionStatusText =
    document.extractionStatus === 'pending'
      ? 'Reading receipt...'
      : isDuplicateReceipt
        ? duplicateReceiptStatusMessage
      : isUnreadableReceipt
        ? 'Unable to read receipt, tap to enter manually or retry uploading receipt'
        : document.needsReview
          ? 'Check extracted details'
          : null;

  return (
    <Pressable
      style={[styles.documentRow, compact && styles.documentRowCompact, selected && styles.documentRowSelected]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={240}
    >
      <View style={styles.documentLeft}>
        {selectionMode ? (
          <View style={[styles.selectionDot, selected && styles.selectionDotActive]}>
            {selected ? <Ionicons name="checkmark" size={14} color={colors.white} /> : null}
          </View>
        ) : null}
        <DocumentThumbnail fileUri={document.fileUri} hasPreviewImage={hasPreviewImage} />
        <View style={styles.documentText}>
          <Text style={styles.documentTitle} numberOfLines={2} ellipsizeMode="tail">
            {document.title}
          </Text>
          <Text style={[styles.documentAmount, isProcessing && styles.documentAmountPending]}>{`£${document.amount.toFixed(2)}`}</Text>
          {extractionStatusText ? <Text style={styles.documentStatusText}>{extractionStatusText}</Text> : null}
        </View>
      </View>
      <View style={styles.documentRight}>
        <Text style={styles.documentDate}>{formatDate(document.date)}</Text>
        <StatusPill status={document.status} onPress={onStatusPress ?? onPress} />
      </View>
    </Pressable>
  );
}, (previousProps, nextProps) =>
  previousProps.compact === nextProps.compact &&
  previousProps.document.id === nextProps.document.id &&
  previousProps.document.title === nextProps.document.title &&
  previousProps.document.amount === nextProps.document.amount &&
  previousProps.document.date === nextProps.document.date &&
  previousProps.document.status === nextProps.document.status &&
  previousProps.document.extractionStatus === nextProps.document.extractionStatus &&
  previousProps.document.needsReview === nextProps.document.needsReview &&
  previousProps.document.notes === nextProps.document.notes &&
  previousProps.document.updatedAt === nextProps.document.updatedAt &&
  previousProps.document.fileUri === nextProps.document.fileUri &&
  previousProps.selectionMode === nextProps.selectionMode &&
  previousProps.selected === nextProps.selected,
);

function StatusPill({ status, onPress }: { status: ExpenseDocument['status']; onPress: () => void }) {
  const label = getStatusLabel(status);
  const tone =
    status === 'awaiting_review'
      ? styles.pillReview
      : status === 'ready_to_submit'
        ? styles.pillReady
        : status === 'submitted'
          ? styles.pillSubmitted
          : styles.pillPaid;

  return (
    <Pressable style={[styles.statusPill, tone]} onPress={onPress}>
      <Text style={styles.statusPillText}>{label}</Text>
    </Pressable>
  );
}

function BottomNav({
  activeTab,
  onSelect,
  onOpenCamera,
  onOpenCaptureActions,
}: {
  activeTab: MainTab;
  onSelect: (tab: MainTab) => void;
  onOpenCamera: () => void;
  onOpenCaptureActions: () => void;
}) {
  return (
    <View style={styles.bottomBar}>
      <BottomTabItem
        active={activeTab === 'costs'}
        label="Costs"
        icon="cart-outline"
        activeIcon="cart"
        onPress={() => onSelect('costs')}
      />
      <BottomTabItem
        active={activeTab === 'sales'}
        label="Sales"
        icon="albums-outline"
        activeIcon="albums"
        onPress={() => onSelect('sales')}
      />
      <View style={styles.capturePill}>
        <Pressable style={styles.capturePrimaryButton} onPress={onOpenCamera}>
          <Ionicons name="camera-outline" size={24} color={colors.white} />
        </Pressable>
        <View style={styles.captureDivider} />
        <Pressable style={styles.captureSecondaryButton} onPress={onOpenCaptureActions}>
          <Ionicons name="chevron-down" size={22} color={colors.white} />
        </Pressable>
      </View>
      <BottomTabItem
        active={activeTab === 'claims'}
        label="Exp. Claims"
        icon="document-text-outline"
        activeIcon="document-text"
        onPress={() => onSelect('claims')}
      />
      <BottomTabItem
        active={activeTab === 'more'}
        label="More"
        icon="ellipsis-horizontal"
        activeIcon="ellipsis-horizontal"
        onPress={() => onSelect('more')}
      />
    </View>
  );
}

function BottomTabItem({
  active,
  label,
  icon,
  activeIcon,
  onPress,
}: {
  active: boolean;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.bottomItem} onPress={onPress}>
      <Ionicons name={active ? activeIcon : icon} size={23} color={active ? colors.nearBlack : colors.tabMuted} />
      <Text style={[styles.bottomLabel, active && styles.bottomLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function MoreSheet({
  target,
  isAdmin,
  onClose,
  onOpenSettings,
  onOpenVault,
  onOpenTeamAdmin,
  onOpenCamera,
  onUseGallery,
  onCreateMileageClaim,
  onAddToVault,
}: {
  target: MoreSheetTarget | null;
  isAdmin: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenVault: () => void;
  onOpenTeamAdmin: () => void;
  onOpenCamera: () => void;
  onUseGallery: () => void;
  onCreateMileageClaim: () => void;
  onAddToVault: () => void;
}) {
  if (!target) {
    return null;
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
        <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        {target === 'menu' ? (
          <View style={styles.sheetCard}>
            <Pressable style={styles.sheetRow} onPress={onOpenVault}>
              <Ionicons name="wallet-outline" size={28} color={colors.nearBlack} />
              <Text style={styles.sheetText}>Vault</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={onOpenSettings}>
              <Ionicons name="settings-outline" size={28} color={colors.nearBlack} />
              <Text style={styles.sheetText}>Settings</Text>
            </Pressable>
            {isAdmin ? (
              <Pressable style={styles.sheetRow} onPress={onOpenTeamAdmin}>
                <Ionicons name="people-outline" size={28} color={colors.nearBlack} />
                <Text style={styles.sheetText}>Team admin</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.captureActionSheet}>
            <Pressable style={styles.captureActionRow} onPress={onCreateMileageClaim}>
              <Ionicons name="car-outline" size={28} color={colors.nearBlack} />
              <Text style={styles.captureActionText}>Create mileage claim</Text>
            </Pressable>
            <Pressable style={styles.captureActionRow} onPress={onAddToVault}>
              <Ionicons name="wallet-outline" size={28} color={colors.nearBlack} />
              <Text style={styles.captureActionText}>Add to Vault</Text>
            </Pressable>
            <Pressable style={styles.captureActionButton} onPress={onOpenCamera}>
              <Ionicons name="camera-outline" size={22} color={colors.white} />
              <Text style={styles.captureActionButtonText}>Scan receipt or invoice</Text>
            </Pressable>
            <Pressable style={styles.captureActionGhost} onPress={onUseGallery}>
              <Ionicons name="image-outline" size={20} color={colors.royalBlueDark} />
              <Text style={styles.captureActionGhostText}>Choose from gallery</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

function HeaderMenuSheet({
  visible,
  bulkSelectionEnabled,
  selectedCount,
  onClose,
  onSelectMultiple,
  onRefresh,
  onBulkMarkReviewed,
  onBulkDelete,
  onClearSelection,
}: {
  visible: boolean;
  bulkSelectionEnabled: boolean;
  selectedCount: number;
  onClose: () => void;
  onSelectMultiple: () => void;
  onRefresh: () => void;
  onBulkMarkReviewed: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.headerMenuBackdrop} onPress={onClose}>
        <View style={styles.headerMenuCard}>
          {!bulkSelectionEnabled ? (
            <>
              <Pressable style={styles.headerMenuRow} onPress={onSelectMultiple}>
                <Text style={styles.headerMenuText}>Select multiple items</Text>
              </Pressable>
              <Pressable style={styles.headerMenuRow} onPress={onRefresh}>
                <Text style={styles.headerMenuText}>Refresh feed</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.headerMenuCaption}>{selectedCount} selected</Text>
              <Pressable style={styles.headerMenuRow} onPress={onBulkMarkReviewed}>
                <Text style={styles.headerMenuText}>Mark selected reviewed</Text>
              </Pressable>
              <Pressable style={styles.headerMenuRow} onPress={onBulkDelete}>
                <Text style={styles.headerMenuText}>Delete selected</Text>
              </Pressable>
              <Pressable style={styles.headerMenuRow} onPress={onClearSelection}>
                <Text style={styles.headerMenuText}>Clear selection</Text>
              </Pressable>
            </>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

function NotificationsSheet({
  visible,
  notifications,
  onClose,
  onOpenDocument,
}: {
  visible: boolean;
  notifications: Array<{ id: string; title: string; message: string; createdAt: string }>;
  onClose: () => void;
  onOpenDocument: (documentId: string) => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={styles.panelSheet}>
          <View style={styles.documentSheetHandle} />
          <Text style={styles.panelTitle}>Processing alerts</Text>
          <ScrollView contentContainerStyle={styles.panelContent}>
            {!notifications.length ? (
              <Text style={styles.panelMuted}>No document alerts right now.</Text>
            ) : (
              notifications.map((notification) => (
                <Pressable
                  key={notification.id}
                  style={styles.panelListRow}
                  onPress={() => onOpenDocument(notification.id)}
                >
                  <View style={styles.panelListRowMain}>
                    <Text style={styles.panelListTitle}>{notification.title}</Text>
                    <Text style={styles.panelListMeta}>{notification.message}</Text>
                  </View>
                  <Text style={styles.panelListTime}>{formatDate(notification.createdAt)}</Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function FilterSheet({
  visible,
  statusFilter,
  sortMode,
  onClose,
  onSelectStatus,
  onSelectSort,
}: {
  visible: boolean;
  statusFilter: StatusFilter;
  sortMode: SortMode;
  onClose: () => void;
  onSelectStatus: (value: StatusFilter) => void;
  onSelectSort: (value: SortMode) => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={styles.panelSheet}>
          <View style={styles.documentSheetHandle} />
          <Text style={styles.panelTitle}>Sort and filter</Text>
          <Text style={styles.panelSectionTitle}>Status</Text>
          {statusFilterOptions.map((option) => (
            <Pressable key={option.value} style={styles.panelOptionRow} onPress={() => onSelectStatus(option.value)}>
              <Text style={styles.panelOptionText}>{option.label}</Text>
              {statusFilter === option.value ? <Ionicons name="checkmark" size={20} color={colors.nearBlack} /> : null}
            </Pressable>
          ))}
          <Text style={styles.panelSectionTitle}>Sort</Text>
          {sortOptions.map((option) => (
            <Pressable key={option.value} style={styles.panelOptionRow} onPress={() => onSelectSort(option.value)}>
              <Text style={styles.panelOptionText}>{option.label}</Text>
              {sortMode === option.value ? <Ionicons name="checkmark" size={20} color={colors.nearBlack} /> : null}
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function ClaimComposerSheet({
  visible,
  title,
  startDate,
  endDate,
  onClose,
  onChangeTitle,
  onChangeStartDate,
  onChangeEndDate,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  startDate: string;
  endDate: string;
  onClose: () => void;
  onChangeTitle: (value: string) => void;
  onChangeStartDate: (value: string) => void;
  onChangeEndDate: (value: string) => void;
  onSubmit: () => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={styles.panelSheet}>
          <View style={styles.documentSheetHandle} />
          <Text style={styles.panelTitle}>Create claim</Text>
          <TextInput value={title} onChangeText={onChangeTitle} placeholder="Claim title" style={styles.panelInput} />
          <TextInput value={startDate} onChangeText={onChangeStartDate} placeholder="Start date" style={styles.panelInput} />
          <TextInput value={endDate} onChangeText={onChangeEndDate} placeholder="End date" style={styles.panelInput} />
          <Pressable style={styles.panelPrimaryButton} onPress={onSubmit}>
            <Text style={styles.panelPrimaryButtonText}>Create claim</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function MileageClaimSheet({
  visible,
  startPostcode,
  endPostcode,
  totalMiles,
  onClose,
  onChangeStartPostcode,
  onChangeEndPostcode,
  onChangeTotalMiles,
  onSubmit,
}: {
  visible: boolean;
  startPostcode: string;
  endPostcode: string;
  totalMiles: string;
  onClose: () => void;
  onChangeStartPostcode: (value: string) => void;
  onChangeEndPostcode: (value: string) => void;
  onChangeTotalMiles: (value: string) => void;
  onSubmit: () => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={styles.panelSheet}>
          <View style={styles.documentSheetHandle} />
          <Text style={styles.panelTitle}>Create mileage claim</Text>
          <TextInput value={startPostcode} onChangeText={onChangeStartPostcode} placeholder="Start postcode" style={styles.panelInput} />
          <TextInput value={endPostcode} onChangeText={onChangeEndPostcode} placeholder="End postcode" style={styles.panelInput} />
          <TextInput value={totalMiles} onChangeText={onChangeTotalMiles} placeholder="Total miles" keyboardType="decimal-pad" style={styles.panelInput} />
          <Pressable style={styles.panelPrimaryButton} onPress={onSubmit}>
            <Text style={styles.panelPrimaryButtonText}>Create mileage claim</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ThemeSheet({
  visible,
  value,
  onClose,
  onSelect,
}: {
  visible: boolean;
  value: ThemeOption;
  onClose: () => void;
  onSelect: (theme: ThemeOption) => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={styles.panelSheet}>
          <View style={styles.documentSheetHandle} />
          <Text style={styles.panelTitle}>Theme</Text>
          {themeOptions.map((option) => (
            <Pressable key={option.value} style={styles.panelOptionRow} onPress={() => onSelect(option.value)}>
              <Text style={styles.panelOptionText}>{option.label}</Text>
              {value === option.value ? <Ionicons name="checkmark" size={20} color={colors.nearBlack} /> : null}
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function SettingsPanelSheet({
  visible,
  target,
  role,
  organisationSettings,
  inboundEmailAddress,
  analyticsSummary,
  vatTrackingEnabled,
  vehicles,
  vehicleNameInput,
  vehicleRegistrationInput,
  editingVehicleId,
  onClose,
  onSaveOrganisationSettings,
  onExport,
  onChangeVehicleName,
  onChangeVehicleRegistration,
  onSaveVehicle,
  onEditVehicle,
  onDeleteVehicle,
}: {
  visible: boolean;
  target: SettingsPanelTarget | null;
  role: 'Business_Admin' | 'Standard_Employee';
  organisationSettings: OrganisationSettings | null;
  inboundEmailAddress: string;
  analyticsSummary: { total: number; vatTotal: number; reviewCount: number; submittedCount: number };
  vatTrackingEnabled: boolean;
  vehicles: Vehicle[];
  vehicleNameInput: string;
  vehicleRegistrationInput: string;
  editingVehicleId: string | null;
  onClose: () => void;
  onSaveOrganisationSettings: (
    nextSettings: Pick<OrganisationSettings, 'isVatRegistered' | 'defaultTaxRate'>,
  ) => Promise<void>;
  onExport: () => void;
  onChangeVehicleName: (value: string) => void;
  onChangeVehicleRegistration: (value: string) => void;
  onSaveVehicle: () => void;
  onEditVehicle: (vehicle: Vehicle) => void;
  onDeleteVehicle: (vehicleId: string) => void;
}) {
  if (!visible || !target) {
    return null;
  }

  const vatToggleDisabled = role !== 'Business_Admin' || !organisationSettings;

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={styles.panelSheet}>
          <View style={styles.documentSheetHandle} />
          {target === 'business_admin' ? (
            <>
              <Text style={styles.panelTitle}>Business admin</Text>
              <Text style={styles.panelMuted}>
                {role === 'Business_Admin'
                  ? 'Admin access is active on this workspace.'
                  : 'This workspace is signed in without business admin permissions.'}
              </Text>
              <View style={styles.settingRow}>
                <View style={styles.settingLabelWrap}>
                  <Ionicons name="receipt-outline" size={22} color={colors.nearBlack} />
                  <Text style={styles.settingLabel}>Business is VAT Registered</Text>
                </View>
                <Switch
                  disabled={vatToggleDisabled}
                  value={organisationSettings?.isVatRegistered !== false}
                  onValueChange={(value) => {
                    if (!organisationSettings) {
                      return;
                    }
                    void onSaveOrganisationSettings({
                      isVatRegistered: value,
                      defaultTaxRate: organisationSettings.defaultTaxRate,
                    });
                  }}
                  trackColor={{ false: colors.softBlueGrey, true: colors.softBlueGrey }}
                  thumbColor={colors.nearBlack}
                />
              </View>
              <Text style={styles.panelMuted}>
                {organisationSettings?.isVatRegistered !== false
                  ? `Net, VAT, and Total stay visible. Default tax rate: ${organisationSettings?.defaultTaxRate ?? '20% Standard'}.`
                  : 'VAT tracking is off, so the app now works in gross-total mode and VAT exports as 0.00.'}
              </Text>
            </>
          ) : null}
          {target === 'logins' ? (
            <>
              <Text style={styles.panelTitle}>Logins</Text>
              <Text style={styles.panelMuted}>This device is signed in and using the current secure session.</Text>
            </>
          ) : null}
          {target === 'extract_email' ? (
            <>
              <Text style={styles.panelTitle}>Extract by email</Text>
              <Text style={styles.panelMuted}>{inboundEmailAddress}</Text>
            </>
          ) : null}
          {target === 'analytics' ? (
            <>
              <Text style={styles.panelTitle}>Analytics</Text>
              <View style={styles.analyticsGrid}>
                <View style={styles.analyticsCard}>
                  <Text style={styles.analyticsValue}>{formatCurrency(analyticsSummary.total)}</Text>
                  <Text style={styles.analyticsLabel}>Visible total</Text>
                </View>
                <View style={styles.analyticsCard}>
                  <Text style={styles.analyticsValue}>{formatCurrency(analyticsSummary.vatTotal)}</Text>
                  <Text style={styles.analyticsLabel}>{vatTrackingEnabled ? 'Visible VAT' : 'VAT hidden'}</Text>
                </View>
                <View style={styles.analyticsCard}>
                  <Text style={styles.analyticsValue}>{analyticsSummary.reviewCount}</Text>
                  <Text style={styles.analyticsLabel}>To review</Text>
                </View>
                <View style={styles.analyticsCard}>
                  <Text style={styles.analyticsValue}>{analyticsSummary.submittedCount}</Text>
                  <Text style={styles.analyticsLabel}>Submitted</Text>
                </View>
              </View>
            </>
          ) : null}
          {target === 'team_exports' ? (
            <>
              <Text style={styles.panelTitle}>Team exports</Text>
              <Text style={styles.panelMuted}>Share a CSV-style export of the current workspace data.</Text>
              <Pressable style={styles.panelPrimaryButton} onPress={onExport}>
                <Text style={styles.panelPrimaryButtonText}>Export summary</Text>
              </Pressable>
            </>
          ) : null}
          {target === 'vault' ? (
            <>
              <Text style={styles.panelTitle}>Vault</Text>
              <Text style={styles.panelMuted}>Vault items are stored without OCR when you choose Add to Vault.</Text>
            </>
          ) : null}
          {target === 'team_admin' ? (
            <>
              <Text style={styles.panelTitle}>Team admin</Text>
              <Text style={styles.panelMuted}>Open your team management tools from this workspace area.</Text>
            </>
          ) : null}
          {target === 'vehicles' ? (
            <>
              <Text style={styles.panelTitle}>Vehicles</Text>
              <TextInput value={vehicleNameInput} onChangeText={onChangeVehicleName} placeholder="Vehicle name" style={styles.panelInput} />
              <TextInput value={vehicleRegistrationInput} onChangeText={onChangeVehicleRegistration} placeholder="Registration" autoCapitalize="characters" style={styles.panelInput} />
              <Pressable style={styles.panelPrimaryButton} onPress={onSaveVehicle}>
                <Text style={styles.panelPrimaryButtonText}>{editingVehicleId ? 'Save vehicle' : 'Add vehicle'}</Text>
              </Pressable>
              <ScrollView contentContainerStyle={styles.panelContent}>
                {!vehicles.length ? (
                  <Text style={styles.panelMuted}>No vehicles added yet.</Text>
                ) : (
                  vehicles.map((vehicle) => (
                    <View key={vehicle.id} style={styles.panelListRow}>
                      <View style={styles.panelListRowMain}>
                        <Text style={styles.panelListTitle}>{vehicle.name}</Text>
                        <Text style={styles.panelListMeta}>{vehicle.registration}</Text>
                      </View>
                      <View style={styles.panelInlineActions}>
                        <Pressable onPress={() => onEditVehicle(vehicle)}>
                          <Text style={styles.panelInlineActionText}>Edit</Text>
                        </Pressable>
                        <Pressable onPress={() => onDeleteVehicle(vehicle.id)}>
                          <Text style={styles.panelInlineActionText}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function ErrorLogSheet({
  visible,
  logs,
  onClose,
  onClear,
}: {
  visible: boolean;
  logs: AppErrorLog[];
  onClose: () => void;
  onClear: () => Promise<void>;
}) {
  if (!visible) {
    return null;
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={styles.errorSheet}>
          <View style={styles.documentSheetHandle} />
          <View style={styles.errorSheetHeader}>
            <Text style={styles.errorSheetTitle}>Error log</Text>
            <Pressable style={styles.errorSheetClear} onPress={() => void onClear()}>
              <Text style={styles.errorSheetClearText}>Clear</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.errorSheetScroll} contentContainerStyle={styles.errorSheetContent}>
            {!logs.length ? (
              <Text style={styles.errorEmptyText}>No errors recorded yet.</Text>
            ) : (
              logs.map((entry) => (
                <View key={entry.id} style={styles.errorEntry}>
                  <View style={styles.errorEntryHeader}>
                    <Text style={styles.errorEntrySource}>{entry.source}</Text>
                    <Text style={styles.errorEntryTime}>{formatDateTime(entry.createdAt)}</Text>
                  </View>
                  <Text style={styles.errorEntryMessage}>{entry.message}</Text>
                  <Text style={styles.errorEntryMeta}>{entry.isFatal ? 'Fatal' : 'Non-fatal'}</Text>
                  {entry.stack ? <Text style={styles.errorEntryStack}>{entry.stack}</Text> : null}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CaptureReviewScreen({
  document,
  ownerName,
  onClose,
  onSubmit,
}: {
  document: ExpenseDocument | null;
  ownerName: string;
  onClose: () => void;
  onSubmit: (
    reviewFields: Pick<ExpenseDocument, 'category' | 'description' | 'customer' | 'amount' | 'netAmount' | 'vatAmount' | 'taxAmount' | 'taxRateApplied'>,
  ) => Promise<void>;
}) {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [customerInput, setCustomerInput] = useState('');
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [categorySearchInput, setCategorySearchInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!document) {
      return;
    }

    setSelectedCategory(document.category ?? '');
    setDescriptionInput(document.description ?? '');
    setCustomerInput(document.customer ?? '');
    setCategoryPickerVisible(false);
    setCategorySearchInput('');
    setSubmitting(false);
  }, [document?.id]);

  if (!document) {
    return null;
  }

  const categoryOptions = getCategoryOptions(document.workspaceContext);
  const filteredCategoryOptions = categoryOptions.filter((option) =>
    option.toLowerCase().includes(categorySearchInput.trim().toLowerCase()),
  );

  return (
    <>
      <Modal
        visible
        transparent={false}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={onClose}
      >
        <SafeAreaView style={styles.captureReviewScreen}>
          <View style={styles.captureReviewHeader}>
            <Pressable onPress={onClose} style={styles.captureReviewHeaderButton}>
              <Ionicons name="chevron-back" size={24} color={colors.nearBlack} />
            </Pressable>
            <Text style={styles.captureReviewHeaderTitle}>Review</Text>
            <Pressable onPress={onClose} style={styles.captureReviewHeaderButton}>
              <Ionicons name="ellipsis-vertical" size={20} color={colors.nearBlack} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.captureReviewScroll}
            contentContainerStyle={styles.captureReviewScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Pressable style={styles.captureReviewFieldButton} onPress={() => setCategoryPickerVisible(true)}>
              <Text style={styles.captureReviewFieldValue}>{selectedCategory || 'Select category'}</Text>
            </Pressable>
            <View style={styles.captureReviewFieldRow}>
              <Text style={styles.captureReviewFieldLabel}>Owned by</Text>
              <Text style={styles.captureReviewFieldValueRight}>{ownerName}</Text>
            </View>
            <View style={styles.captureReviewTextField}>
              <TextInput
                value={descriptionInput}
                onChangeText={setDescriptionInput}
                placeholder="Write your description here"
                placeholderTextColor={colors.slate}
                multiline
                style={styles.captureReviewTextInput}
              />
            </View>
            <Text style={styles.captureReviewSectionHeading}>More</Text>
            <View style={styles.captureReviewTextField}>
              <Text style={styles.captureReviewFieldValue}>Customer</Text>
              <TextInput
                value={customerInput}
                onChangeText={setCustomerInput}
                placeholder=""
                placeholderTextColor={colors.slate}
                style={styles.captureReviewSingleLineInput}
              />
            </View>
          </ScrollView>

          <View style={styles.captureReviewFooter}>
            <Pressable
              style={[styles.captureReviewSubmitButton, submitting && styles.captureReviewSubmitButtonDisabled]}
              disabled={submitting}
              onPress={async () => {
                setSubmitting(true);
                try {
                  await onSubmit({
                    category: selectedCategory || document.category,
                    description: descriptionInput.trim(),
                    customer: customerInput.trim(),
                    amount: document.amount,
                    netAmount: document.netAmount,
                    vatAmount: document.vatAmount,
                    taxAmount: document.taxAmount,
                    taxRateApplied: document.taxRateApplied,
                  });
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <Text style={styles.captureReviewSubmitButtonText}>{submitting ? 'Saving...' : 'Submit'}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal transparent animationType="slide" visible={categoryPickerVisible} onRequestClose={() => setCategoryPickerVisible(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetOverlay} onPress={() => setCategoryPickerVisible(false)} />
          <View style={styles.categoryPickerSheet}>
            <View style={styles.documentSheetHandle} />
            <View style={styles.categoryPickerHeader}>
              <TextInput
                value={categorySearchInput}
                onChangeText={setCategorySearchInput}
                placeholder="Search"
                placeholderTextColor={colors.slate}
                style={styles.categoryPickerSearchInput}
              />
              <Pressable onPress={() => setCategoryPickerVisible(false)} style={styles.categoryPickerCloseButton}>
                <Ionicons name="close" size={28} color={colors.nearBlack} />
              </Pressable>
            </View>
            <ScrollView style={styles.categoryPickerList} keyboardShouldPersistTaps="handled">
              {filteredCategoryOptions.map((option) => (
                <Pressable
                  key={option}
                  style={styles.categoryPickerOption}
                  onPress={() => {
                    setSelectedCategory(option);
                    setCategoryPickerVisible(false);
                  }}
                >
                  <Text style={styles.categoryPickerOptionText}>{option}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function DocumentSheet({
  document,
  ownerName,
  vatTrackingEnabled,
  onClose,
  onMarkReviewed,
  onAddToClaim,
  onUpdateReviewFields,
  onMarkSubmitted,
  onDelete,
}: {
  document: ExpenseDocument | null;
  ownerName: string;
  vatTrackingEnabled: boolean;
  onClose: () => void;
  onMarkReviewed: () => void;
  onAddToClaim: () => void;
  onUpdateReviewFields: (
    reviewFields: Pick<
      ExpenseDocument,
      'amount' | 'netAmount' | 'vatAmount' | 'taxAmount' | 'taxRateApplied' | 'category' | 'description' | 'customer'
    >,
  ) => void;
  onMarkSubmitted: () => void;
  onDelete: () => void;
}) {
  const [totalInput, setTotalInput] = useState('0.00');
  const [netInput, setNetInput] = useState('0.00');
  const [vatInput, setVatInput] = useState('0.00');
  const [selectedTaxRate, setSelectedTaxRate] = useState<UkTaxRate>('No VAT');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [customerInput, setCustomerInput] = useState('');
  const [taxDropdownOpen, setTaxDropdownOpen] = useState(false);
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [categorySearchInput, setCategorySearchInput] = useState('');
  const [previewVisible, setPreviewVisible] = useState(false);

  useEffect(() => {
    if (!document) {
      return;
    }
    setTotalInput(formatMoneyInput(document.amount));
    setNetInput(formatMoneyInput(document.netAmount ?? document.amount));
    setVatInput(formatMoneyInput(document.vatAmount ?? document.taxAmount));
    setSelectedTaxRate(document.taxRateApplied ?? 'No VAT');
    setSelectedCategory(document.category ?? '');
    setDescriptionInput(document.description ?? '');
    setCustomerInput(document.customer ?? '');
    setTaxDropdownOpen(false);
    setCategoryPickerVisible(false);
    setCategorySearchInput('');
    setPreviewVisible(false);
  }, [document?.id]);

  if (!document) {
    return null;
  }

  const hasPreviewImage =
    canPreviewDocumentInline(document);
  const categoryOptions = getCategoryOptions(document.workspaceContext);
  const filteredCategoryOptions = categoryOptions.filter((option) =>
    option.toLowerCase().includes(categorySearchInput.trim().toLowerCase()),
  );
  const effectiveTaxRate = vatTrackingEnabled ? selectedTaxRate : 'No VAT';
  const extractionStatusText =
    document.extractionStatus === 'pending'
      ? 'Reading this receipt now.'
      : document.extractionStatus === 'failed'
        ? 'Unable to read receipt, tap to enter manually or retry uploading receipt'
        : document.needsReview
          ? 'Extraction finished. Review the details before submitting.'
          : 'Extraction finished.';

  return (
    <>
      <Modal transparent animationType="slide" visible onRequestClose={onClose}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetOverlay} onPress={onClose} />
          <View style={styles.documentSheet}>
            <View style={styles.documentSheetHandle} />
            <ScrollView
              style={styles.documentSheetScroll}
              contentContainerStyle={styles.documentSheetScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {hasPreviewImage ? (
                <Pressable
                  style={styles.documentSheetPreviewButton}
                  onPress={() => {
                    InteractionManager.runAfterInteractions(() => {
                      setPreviewVisible(true);
                    });
                  }}
                >
                  <DocumentSheetPreviewImage fileUri={document.fileUri} />
                  <Text style={styles.documentSheetPreviewHint}>Tap to view full image</Text>
                </Pressable>
              ) : null}
          <Text style={styles.documentSheetTitle}>{document.title}</Text>
          <Text style={styles.documentSheetMeta}>{document.supplier}</Text>
          <Text style={styles.documentSheetAmount}>£{document.amount.toFixed(2)}</Text>
          <Text style={styles.documentSheetStatus}>{extractionStatusText}</Text>
          <View style={styles.reviewEditor}>
            <Pressable style={styles.reviewFieldButton} onPress={() => setCategoryPickerVisible(true)}>
              <Text style={styles.reviewFieldLabel}>Category</Text>
              <View style={styles.reviewFieldValueRow}>
                <Text style={styles.reviewFieldValue}>{selectedCategory || 'Select category'}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.royalBlueDark} />
              </View>
            </Pressable>
            <View style={styles.reviewFieldRow}>
              <Text style={styles.reviewFieldLabel}>Owned by</Text>
              <Text style={styles.reviewFieldValue}>{ownerName}</Text>
            </View>
            <View style={styles.reviewTextField}>
              <Text style={styles.reviewFieldLabel}>Description</Text>
              <TextInput
                value={descriptionInput}
                onChangeText={setDescriptionInput}
                placeholder="Write your description here"
                placeholderTextColor={colors.slate}
                multiline
                style={styles.reviewTextInput}
              />
            </View>
            <Text style={styles.reviewSectionHeading}>More</Text>
            <View style={styles.reviewTextField}>
              <Text style={styles.reviewFieldLabel}>Customer</Text>
              <TextInput
                value={customerInput}
                onChangeText={setCustomerInput}
                placeholder="Add customer"
                placeholderTextColor={colors.slate}
                style={styles.reviewSingleLineInput}
              />
            </View>
          </View>
          <View style={styles.taxEditor}>
            <View style={styles.taxEditorRow}>
              <TaxAmountField label="Total" value={totalInput} onChangeText={setTotalInput} />
              {vatTrackingEnabled ? <TaxAmountField label="Net" value={netInput} onChangeText={setNetInput} /> : null}
              {vatTrackingEnabled ? <TaxAmountField label="VAT" value={vatInput} onChangeText={setVatInput} /> : null}
            </View>
            {vatTrackingEnabled ? (
              <>
                <Pressable style={styles.taxDropdown} onPress={() => setTaxDropdownOpen((current) => !current)}>
                  <Text style={styles.taxDropdownLabel}>Tax rate</Text>
                  <View style={styles.taxDropdownValueWrap}>
                    <Text style={styles.taxDropdownValue}>{selectedTaxRate}</Text>
                    <Ionicons
                      name={taxDropdownOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={colors.royalBlueDark}
                    />
                  </View>
                </Pressable>
                {taxDropdownOpen ? (
                  <View style={styles.taxDropdownMenu}>
                    {TAX_RATE_OPTIONS.map((option) => (
                      <Pressable
                        key={option}
                        style={[styles.taxDropdownOption, option === selectedTaxRate && styles.taxDropdownOptionActive]}
                        onPress={() => {
                          setSelectedTaxRate(option);
                          setTaxDropdownOpen(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.taxDropdownOptionText,
                            option === selectedTaxRate && styles.taxDropdownOptionTextActive,
                          ]}
                        >
                          {option}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.reviewFieldRow}>
                <Text style={styles.reviewFieldLabel}>VAT tracking</Text>
                <Text style={styles.reviewFieldValue}>Gross total only</Text>
              </View>
            )}
            <Pressable
              style={styles.taxSaveButton}
              onPress={() => {
                const amount = parseMoneyInput(totalInput);
                const netAmount = vatTrackingEnabled ? parseMoneyInput(netInput) : amount;
                const vatAmount = vatTrackingEnabled ? parseMoneyInput(vatInput) : 0;
                onUpdateReviewFields({
                  amount,
                  netAmount,
                  vatAmount,
                  taxAmount: vatAmount,
                  category: selectedCategory || document.category,
                  description: descriptionInput.trim(),
                  customer: customerInput.trim(),
                  taxRateApplied: effectiveTaxRate,
                });
              }}
            >
              <Text style={styles.taxSaveButtonText}>Save Values</Text>
            </Pressable>
          </View>
              <View style={styles.documentSheetActions}>
            <Pressable style={[styles.sheetActionButton, styles.sheetActionPrimary]} onPress={onMarkReviewed}>
              <Text style={styles.sheetActionPrimaryText}>Mark reviewed</Text>
            </Pressable>
            {document.workspaceContext === 'cost' && document.paymentMethod === 'cash_personal' ? (
              <Pressable style={styles.sheetActionButton} onPress={onAddToClaim}>
                <Text style={styles.sheetActionText}>Add to claim</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.sheetActionButton, styles.sheetActionPrimary]} onPress={onMarkSubmitted}>
              <Text style={styles.sheetActionPrimaryText}>Mark submitted</Text>
            </Pressable>
            <Pressable style={[styles.sheetActionButton, styles.sheetActionDanger]} onPress={onDelete}>
              <Text style={styles.sheetActionDangerText}>Delete</Text>
            </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal transparent animationType="slide" visible={categoryPickerVisible} onRequestClose={() => setCategoryPickerVisible(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetOverlay} onPress={() => setCategoryPickerVisible(false)} />
          <View style={styles.categoryPickerSheet}>
            <View style={styles.documentSheetHandle} />
            <View style={styles.categoryPickerHeader}>
              <TextInput
                value={categorySearchInput}
                onChangeText={setCategorySearchInput}
                placeholder="Search"
                placeholderTextColor={colors.slate}
                style={styles.categoryPickerSearchInput}
              />
              <Pressable onPress={() => setCategoryPickerVisible(false)} style={styles.categoryPickerCloseButton}>
                <Ionicons name="close" size={28} color={colors.nearBlack} />
              </Pressable>
            </View>
            <ScrollView style={styles.categoryPickerList} keyboardShouldPersistTaps="handled">
              {filteredCategoryOptions.map((option) => (
                <Pressable
                  key={option}
                  style={styles.categoryPickerOption}
                  onPress={() => {
                    setSelectedCategory(option);
                    setCategoryPickerVisible(false);
                  }}
                >
                  <Text style={styles.categoryPickerOptionText}>{option}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        visible={previewVisible}
        transparent={false}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={styles.previewFullscreenBackdrop}>
          <Pressable style={styles.previewFullscreenClose} onPress={() => setPreviewVisible(false)}>
            <Ionicons name="close" size={28} color={colors.white} />
          </Pressable>
          {hasPreviewImage ? (
            <DocumentSheetPreviewImage fileUri={document.fileUri} fullScreen />
          ) : null}
        </View>
      </Modal>
    </>
  );
}

function TaxAmountField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.taxAmountField}>
      <Text style={styles.taxAmountLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        selectTextOnFocus
        style={styles.taxAmountInput}
      />
    </View>
  );
}

function CaptureModal({
  captureType,
  activeTab,
  isAdmin,
  visible,
  isSaving,
  onClose,
  onSelectType,
  onUseCamera,
  onUseGallery,
  onUseFiles,
}: {
  captureType: DocumentKind;
  activeTab: MainTab;
  isAdmin: boolean;
  visible: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSelectType: (type: DocumentKind) => void;
  onUseCamera: () => void;
  onUseGallery: () => void;
  onUseFiles: () => void;
}) {
  const availableTypes =
    activeTab === 'sales'
      ? (['invoice'] as const)
      : isAdmin
        ? (['receipt', 'invoice'] as const)
        : (['receipt'] as const);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={styles.captureSheet}>
          <View style={styles.sectionTabs}>
            {availableTypes.map((type) => (
              <Pressable
                key={type}
                style={[styles.sectionTab, captureType === type && styles.sectionTabActive]}
                onPress={() => onSelectType(type)}
              >
                <Text style={[styles.sectionTabText, captureType === type && styles.sectionTabTextActive]}>
                  {type === 'receipt' ? 'Receipt' : 'Invoice'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.captureRow} onPress={onUseCamera} disabled={isSaving}>
            <Ionicons name="camera-outline" size={24} color={colors.royalBlue} />
            <Text style={styles.captureRowText}>Use camera</Text>
          </Pressable>
          <Pressable style={styles.captureRow} onPress={onUseGallery} disabled={isSaving}>
            <Ionicons name="image-outline" size={24} color={colors.royalBlue} />
            <Text style={styles.captureRowText}>Import from gallery</Text>
          </Pressable>
          <Pressable style={styles.captureRow} onPress={onUseFiles} disabled={isSaving}>
            <Ionicons name="document-outline" size={24} color={colors.royalBlue} />
            <Text style={styles.captureRowText}>Import a file</Text>
          </Pressable>
          {isSaving ? <ActivityIndicator color={colors.royalBlue} style={styles.captureLoader} /> : null}
        </View>
      </View>
    </Modal>
  );
}

function CameraCapture({
  visible,
  type,
  lowResolution,
  onClose,
  onUseGallery,
  onCapture,
}: {
  visible: boolean;
  type: DocumentKind;
  lowResolution: boolean;
  onClose: () => void;
  onUseGallery: () => void;
  onCapture: (uri: string) => Promise<void>;
}) {
  if (!visible) {
    return null;
  }

  return (
    <CameraSheet
      type={type}
      lowResolution={lowResolution}
      onClose={onClose}
      onUseGallery={onUseGallery}
      onCapture={onCapture}
    />
  );
}

function CameraSheet({
  type,
  lowResolution,
  onClose,
  onUseGallery,
  onCapture,
}: {
  type: DocumentKind;
  lowResolution: boolean;
  onClose: () => void;
  onUseGallery: () => void;
  onCapture: (uri: string) => Promise<void>;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);

  return (
    <Modal animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.cameraShell}>
        <CameraView
          style={styles.cameraView}
          facing="back"
          ref={(instance) => {
            cameraRef.current = instance;
          }}
          onCameraReady={() => setIsCameraReady(true)}
        />
        <View style={styles.cameraOverlay}>
          <View style={styles.cameraTopBar}>
            <Pressable style={styles.cameraTopIcon} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.white} />
            </Pressable>
          </View>
          <View style={styles.cameraHintWrap}>
            <Text style={styles.cameraText}>One receipt or bill</Text>
          </View>
          <View style={styles.cameraBottomPanel}>
            <View style={styles.cameraModeRow}>
              <Text style={[styles.cameraModeText, styles.cameraModeTextActive]}>Single</Text>
              <Text style={styles.cameraModeText}>Multiple</Text>
              <Text style={styles.cameraModeText}>Combine</Text>
            </View>
            <View style={styles.cameraActions}>
              <Pressable style={styles.cameraGalleryButton} onPress={onUseGallery}>
                <Ionicons name="image-outline" size={30} color={colors.white} />
              </Pressable>
              <Pressable
                style={[styles.cameraShutter, (!isCameraReady || isProcessing) && styles.cameraShutterDisabled]}
                disabled={!isCameraReady || isProcessing}
                onPress={async () => {
                  const camera = cameraRef.current;
                  if (!camera) {
                    Alert.alert('Camera not ready', 'Please wait a moment and try taking the photo again.');
                    return;
                  }

                  setIsProcessing(true);
                  try {
                    const result = await camera.takePictureAsync({
                      quality: lowResolution ? 0.6 : 0.8,
                      skipProcessing: false,
                    });

                    if (!result?.uri) {
                      throw new Error('Camera capture returned no file URI.');
                    }

                    await onCapture(result.uri);
                  } catch (error) {
                    console.error('camera capture failed', error);
                    Alert.alert(
                      'Camera failed',
                      'The receipt photo could not be captured. Please try again or import from gallery.',
                    );
                  } finally {
                    setIsProcessing(false);
                  }
                }}
              >
                <View style={styles.cameraShutterInner} />
              </Pressable>
              <View style={styles.cameraTypeButton}>
                <Text style={styles.cameraTypeText}>{type === 'invoice' ? 'Sales' : 'Costs'}</Text>
                <Ionicons name="chevron-down" size={18} color={colors.white} />
              </View>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date
    .toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    .replace(/,/g, '');
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMoneyInput(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : '0.00';
}

function parseMoneyInput(value: string) {
  const parsed = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.white,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.white,
  },
  authScreen: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: colors.band,
  },
  authCard: {
    backgroundColor: colors.white,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 28,
  },
  authLogo: {
    width: 180,
    height: 92,
    alignSelf: 'center',
    marginBottom: 12,
  },
  authTitle: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.nearBlack,
    textAlign: 'center',
  },
  authSubtitle: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 24,
    color: colors.mutedText,
    textAlign: 'center',
  },
  authTabs: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
    marginBottom: 18,
  },
  authTab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: colors.band,
    alignItems: 'center',
  },
  authTabActive: {
    backgroundColor: colors.royalBlueDark,
  },
  authTabText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.nearBlack,
  },
  authTabTextActive: {
    color: colors.white,
  },
  authInput: {
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.nearBlack,
    marginBottom: 12,
    backgroundColor: colors.white,
  },
  authButton: {
    marginTop: 8,
    backgroundColor: colors.royalBlueDark,
    borderRadius: 18,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authButtonDisabled: {
    opacity: 0.6,
  },
  authButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.white,
  },
  authSecondaryLink: {
    marginTop: 14,
    alignSelf: 'center',
    paddingVertical: 4,
  },
  authSecondaryLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.royalBlueDark,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  loadingLogo: {
    width: 132,
    height: 132,
    marginBottom: 20,
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.mutedText,
    fontSize: 15,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 26,
    paddingTop: 12,
    paddingBottom: 18,
  },
  headerBrandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 16,
  },
  headerBrandMark: {
    width: 52,
    height: 52,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  headerSubtitle: {
    marginTop: 6,
    fontSize: 16,
    color: colors.nearBlack,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    paddingTop: 4,
  },
  searchBand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 26,
    paddingVertical: 18,
    backgroundColor: colors.band,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 18,
    color: colors.nearBlack,
  },
  content: {
    paddingBottom: 132,
    flexGrow: 1,
  },
  dayHeader: {
    alignItems: 'flex-end',
    paddingHorizontal: 30,
    paddingTop: 24,
    paddingBottom: 10,
  },
  dayHeaderText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  documentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 26,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.white,
  },
  documentRowCompact: {
    paddingVertical: 14,
  },
  documentLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  documentText: {
    flex: 1,
    minWidth: 0,
  },
  documentThumb: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.band,
  },
  documentThumbFallback: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.band,
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.dotMint,
  },
  documentTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.nearBlack,
    flexShrink: 1,
    lineHeight: 24,
  },
  documentAmount: {
    marginTop: 8,
    fontSize: 18,
    color: colors.amountText,
  },
  documentAmountPending: {
    color: colors.mutedText,
  },
  documentStatusText: {
    marginTop: 6,
    fontSize: 13,
    color: colors.mutedText,
  },
  documentRight: {
    width: 92,
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 12,
  },
  documentDate: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.dateText,
  },
  statusPill: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusPillText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.nearBlack,
  },
  pillReview: {
    backgroundColor: colors.pillAmber,
  },
  pillReady: {
    backgroundColor: colors.pillBlue,
  },
  pillSubmitted: {
    backgroundColor: colors.pillGrey,
  },
  pillPaid: {
    backgroundColor: colors.pillGreen,
  },
  blankState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 38,
    paddingTop: 120,
  },
  blankIconWrap: {
    marginBottom: 26,
  },
  blankTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.nearBlack,
    textAlign: 'center',
  },
  blankCopy: {
    marginTop: 22,
    fontSize: 18,
    lineHeight: 28,
    color: colors.nearBlack,
    textAlign: 'center',
  },
  blankButton: {
    marginTop: 34,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: 8,
    paddingHorizontal: 38,
    paddingVertical: 16,
  },
  blankButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.royalBlueDark,
  },
  claimsList: {
    paddingTop: 24,
    paddingHorizontal: 20,
    gap: 14,
  },
  claimCreateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.royalBlueDark,
    borderRadius: 18,
    paddingVertical: 14,
  },
  claimCreateButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  claimCard: {
    borderWidth: 1,
    borderColor: colors.band,
    borderRadius: 18,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  claimRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  claimRowLeft: {
    flex: 1,
    paddingRight: 16,
  },
  claimAttachList: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    gap: 8,
  },
  claimAttachButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  claimAttachButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.royalBlueDark,
  },
  claimName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  claimMeta: {
    marginTop: 6,
    fontSize: 14,
    color: colors.mutedText,
  },
  claimAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.royalBlueDark,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
    paddingHorizontal: 26,
    paddingTop: 18,
    paddingBottom: 20,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.band,
    borderBottomWidth: 1,
    borderBottomColor: colors.band,
  },
  profileCopy: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 2,
  },
  profileAvatar: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: colors.avatarMint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  profileEmail: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 22,
    color: colors.mutedText,
  },
  profileRole: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 18,
    color: colors.royalBlueDark,
    fontWeight: '600',
  },
  settingsLink: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
    paddingHorizontal: 26,
    paddingVertical: 22,
    borderBottomWidth: 1,
    borderBottomColor: colors.band,
  },
  settingsLinkText: {
    flex: 1,
    fontSize: 20,
    lineHeight: 26,
    color: colors.nearBlack,
  },
  errorSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  errorSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  errorSheetTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  errorSheetClear: {
    backgroundColor: colors.band,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorSheetClearText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.royalBlueDark,
  },
  errorSheetScroll: {
    flexGrow: 0,
  },
  errorSheetContent: {
    paddingBottom: spacing.md,
  },
  errorEmptyText: {
    fontSize: 15,
    color: colors.mutedText,
  },
  errorEntry: {
    borderWidth: 1,
    borderColor: colors.band,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorEntryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: 6,
  },
  errorEntrySource: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  errorEntryTime: {
    fontSize: 12,
    color: colors.mutedText,
  },
  errorEntryMessage: {
    fontSize: 14,
    color: colors.nearBlack,
    marginBottom: 6,
  },
  errorEntryMeta: {
    fontSize: 12,
    color: colors.royalBlueDark,
    marginBottom: 6,
  },
  errorEntryStack: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.mutedText,
  },
  settingsGroup: {
    paddingTop: 8,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 26,
    paddingVertical: 18,
  },
  settingLabelWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
    flex: 1,
    paddingRight: 12,
  },
  settingLabel: {
    fontSize: 19,
    lineHeight: 25,
    color: colors.nearBlack,
    flexShrink: 1,
  },
  settingValue: {
    fontSize: 18,
    lineHeight: 24,
    color: colors.nearBlack,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingTop: 16,
    paddingBottom: 26,
    backgroundColor: colors.white,
  },
  bottomItem: {
    alignItems: 'center',
    width: 68,
  },
  bottomLabel: {
    marginTop: 6,
    fontSize: 12,
    color: colors.tabMuted,
    textAlign: 'center',
  },
  bottomLabelActive: {
    color: colors.nearBlack,
    fontWeight: '700',
  },
  capturePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 108,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.royalBlueDark,
    marginTop: -6,
  },
  capturePrimaryButton: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 8,
  },
  captureSecondaryButton: {
    width: 34,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 4,
  },
  captureDivider: {
    width: 1,
    height: 26,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  sheetOverlay: {
    flex: 1,
  },
  sheetCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingHorizontal: 26,
    paddingTop: 28,
    paddingBottom: 42,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
  },
  sheetText: {
    fontSize: 20,
    color: colors.nearBlack,
  },
  captureActionSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    marginHorizontal: 22,
    marginBottom: 90,
    paddingHorizontal: 26,
    paddingTop: 18,
    paddingBottom: 26,
  },
  captureActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingVertical: 20,
  },
  captureActionText: {
    fontSize: 19,
    color: colors.nearBlack,
  },
  captureActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 12,
    backgroundColor: colors.royalBlueDark,
    borderRadius: 22,
    paddingVertical: 18,
  },
  captureActionButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.white,
  },
  captureActionGhost: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  captureActionGhostText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.royalBlueDark,
  },
  captureReviewScreen: {
    flex: 1,
    backgroundColor: colors.white,
  },
  captureReviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 18,
  },
  captureReviewHeaderButton: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureReviewHeaderTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: colors.nearBlack,
    marginLeft: 12,
  },
  captureReviewScroll: {
    flex: 1,
  },
  captureReviewScrollContent: {
    paddingBottom: 24,
  },
  captureReviewFieldButton: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightBorder,
  },
  captureReviewFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightBorder,
  },
  captureReviewFieldLabel: {
    fontSize: 16,
    color: colors.nearBlack,
  },
  captureReviewFieldValue: {
    fontSize: 16,
    color: colors.nearBlack,
  },
  captureReviewFieldValueRight: {
    fontSize: 16,
    color: colors.nearBlack,
    textAlign: 'right',
  },
  captureReviewTextField: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightBorder,
  },
  captureReviewTextInput: {
    minHeight: 72,
    fontSize: 16,
    color: colors.nearBlack,
    textAlignVertical: 'top',
    padding: 0,
  },
  captureReviewSingleLineInput: {
    fontSize: 16,
    color: colors.nearBlack,
    padding: 0,
    marginTop: 10,
  },
  captureReviewSectionHeading: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    fontSize: 14,
    fontWeight: '700',
    color: colors.nearBlack,
    backgroundColor: colors.band,
  },
  captureReviewFooter: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: colors.white,
  },
  captureReviewSubmitButton: {
    borderRadius: 8,
    backgroundColor: colors.royalBlueDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
  },
  captureReviewSubmitButtonDisabled: {
    opacity: 0.7,
  },
  captureReviewSubmitButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.white,
  },
  documentSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 38,
    maxHeight: '92%',
  },
  documentSheetScroll: {
    flexGrow: 0,
  },
  documentSheetScrollContent: {
    paddingBottom: 8,
  },
  documentSheetHandle: {
    alignSelf: 'center',
    width: 52,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.softBlueGrey,
    marginBottom: 18,
  },
  documentSheetTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  documentSheetPreviewButton: {
    marginBottom: 18,
  },
  documentSheetPreview: {
    width: '100%',
    height: 180,
    borderRadius: 18,
    backgroundColor: colors.band,
    overflow: 'hidden',
  },
  documentSheetPreviewHint: {
    marginTop: 8,
    fontSize: 13,
    color: colors.mutedText,
    textAlign: 'center',
  },
  documentSheetMeta: {
    marginTop: 6,
    fontSize: 16,
    color: colors.mutedText,
  },
  documentSheetAmount: {
    marginTop: 18,
    fontSize: 22,
    fontWeight: '700',
    color: colors.royalBlueDark,
  },
  documentSheetStatus: {
    marginTop: 8,
    fontSize: 15,
    color: colors.mutedText,
  },
  reviewEditor: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  reviewFieldButton: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightBorder,
  },
  reviewFieldRow: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  reviewTextField: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightBorder,
  },
  reviewFieldLabel: {
    fontSize: 14,
    color: colors.nearBlack,
    marginBottom: 8,
  },
  reviewFieldValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  reviewFieldValue: {
    flex: 1,
    fontSize: 16,
    color: colors.nearBlack,
    fontWeight: '500',
  },
  reviewTextInput: {
    minHeight: 72,
    fontSize: 16,
    color: colors.nearBlack,
    textAlignVertical: 'top',
    padding: 0,
  },
  reviewSingleLineInput: {
    fontSize: 16,
    color: colors.nearBlack,
    padding: 0,
  },
  reviewSectionHeading: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    fontSize: 14,
    fontWeight: '700',
    color: colors.nearBlack,
    backgroundColor: colors.band,
  },
  taxEditor: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: 16,
    padding: 12,
    backgroundColor: colors.white,
  },
  taxEditorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  taxAmountField: {
    flex: 1,
  },
  taxAmountLabel: {
    marginBottom: 6,
    fontSize: 12,
    fontWeight: '700',
    color: colors.mutedText,
  },
  taxAmountInput: {
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  taxDropdown: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  taxDropdownLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.mutedText,
  },
  taxDropdownValueWrap: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taxDropdownValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  taxDropdownMenu: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: 12,
    overflow: 'hidden',
  },
  taxDropdownOption: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: colors.white,
  },
  taxDropdownOptionActive: {
    backgroundColor: colors.band,
  },
  taxDropdownOptionText: {
    fontSize: 15,
    color: colors.nearBlack,
  },
  taxDropdownOptionTextActive: {
    fontWeight: '700',
    color: colors.royalBlueDark,
  },
  taxSaveButton: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: colors.royalBlueDark,
    paddingVertical: 12,
    alignItems: 'center',
  },
  taxSaveButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
  categoryPickerSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
    maxHeight: '86%',
  },
  categoryPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightBorder,
  },
  categoryPickerSearchInput: {
    flex: 1,
    fontSize: 18,
    color: colors.nearBlack,
    paddingVertical: 10,
  },
  categoryPickerCloseButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryPickerList: {
    marginTop: 8,
  },
  categoryPickerOption: {
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightBorder,
  },
  categoryPickerOptionText: {
    fontSize: 18,
    color: colors.nearBlack,
  },
  documentSheetActions: {
    marginTop: 24,
    gap: 12,
  },
  previewFullscreenBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 32,
  },
  previewFullscreenClose: {
    position: 'absolute',
    top: 48,
    right: 22,
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewFullscreenImage: {
    width: '100%',
    height: '88%',
  },
  sheetActionButton: {
    paddingVertical: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    alignItems: 'center',
  },
  sheetActionPrimary: {
    backgroundColor: colors.royalBlueDark,
    borderColor: colors.royalBlueDark,
  },
  sheetActionDanger: {
    backgroundColor: '#FBE5E2',
    borderColor: '#F3C5BE',
  },
  sheetActionText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.nearBlack,
  },
  sheetActionPrimaryText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  sheetActionDangerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#A43A2D',
  },
  captureSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 36,
  },
  sectionTabs: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 22,
  },
  sectionTab: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
    backgroundColor: colors.band,
  },
  sectionTabActive: {
    backgroundColor: colors.royalBlueDark,
  },
  sectionTabText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.nearBlack,
  },
  sectionTabTextActive: {
    color: colors.white,
  },
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.band,
  },
  captureRowText: {
    fontSize: 18,
    color: colors.nearBlack,
  },
  captureLoader: {
    marginTop: 20,
  },
  cameraShell: {
    flex: 1,
    backgroundColor: colors.nearBlack,
  },
  cameraView: {
    flex: 1,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  cameraTopBar: {
    paddingTop: 56,
    paddingHorizontal: 24,
  },
  cameraTopIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraHintWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 120,
  },
  cameraText: {
    color: colors.white,
    fontSize: 16,
    backgroundColor: 'rgba(0,0,0,0.52)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  cameraBottomPanel: {
    backgroundColor: '#000000',
    paddingTop: 10,
    paddingBottom: 22,
  },
  cameraModeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 28,
    paddingBottom: 18,
  },
  cameraModeText: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.92)',
  },
  cameraModeTextActive: {
    color: '#E7C94F',
  },
  cameraActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  cameraGalleryButton: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraShutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraShutterDisabled: {
    opacity: 0.5,
  },
  cameraShutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.white,
  },
  cameraTypeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 78,
  },
  cameraTypeText: {
    fontSize: 18,
    color: colors.white,
  },
  shellDark: {
    backgroundColor: '#111827',
  },
  shellTextDark: {
    color: colors.white,
  },
  headerIconButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerNotificationDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  headerNotificationDotText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  selectionDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.lightBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  selectionDotActive: {
    backgroundColor: colors.royalBlueDark,
    borderColor: colors.royalBlueDark,
  },
  documentRowSelected: {
    borderColor: colors.royalBlueDark,
    borderWidth: 1,
  },
  headerMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.2)',
    alignItems: 'flex-end',
    paddingTop: 86,
    paddingRight: 18,
  },
  headerMenuCard: {
    width: 220,
    borderRadius: 18,
    backgroundColor: colors.white,
    paddingVertical: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  headerMenuRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerMenuText: {
    fontSize: 15,
    color: colors.nearBlack,
    fontWeight: '600',
  },
  headerMenuCaption: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    fontSize: 12,
    color: colors.mutedText,
    fontWeight: '700',
  },
  panelSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 58,
    maxHeight: '82%',
  },
  panelTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: colors.nearBlack,
    marginBottom: 16,
  },
  panelSectionTitle: {
    marginTop: 10,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '700',
    color: colors.mutedText,
    textTransform: 'uppercase',
  },
  panelOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.band,
  },
  panelOptionText: {
    fontSize: 16,
    color: colors.nearBlack,
  },
  panelContent: {
    gap: 12,
  },
  panelMuted: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.mutedText,
  },
  panelListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.band,
  },
  panelListRowMain: {
    flex: 1,
    paddingRight: 12,
  },
  panelListTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  panelListMeta: {
    marginTop: 4,
    fontSize: 14,
    color: colors.mutedText,
  },
  panelListTime: {
    fontSize: 13,
    color: colors.mutedText,
  },
  panelInput: {
    borderWidth: 1,
    borderColor: colors.lightBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.nearBlack,
    marginBottom: 12,
  },
  panelPrimaryButton: {
    marginTop: 6,
    borderRadius: 14,
    backgroundColor: colors.royalBlueDark,
    alignItems: 'center',
    paddingVertical: 14,
  },
  panelPrimaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  analyticsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  analyticsCard: {
    width: '47%',
    backgroundColor: colors.band,
    borderRadius: 16,
    padding: 16,
  },
  analyticsValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.nearBlack,
  },
  analyticsLabel: {
    marginTop: 6,
    fontSize: 13,
    color: colors.mutedText,
  },
  panelInlineActions: {
    flexDirection: 'row',
    gap: 12,
  },
  panelInlineActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.royalBlueDark,
  },
});
