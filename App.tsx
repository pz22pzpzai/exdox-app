import { useEffect, useEffectEvent, useMemo, useRef, useState, useDeferredValue } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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
  fetchCloudReceipts,
  fetchExpenseClaims,
} from './src/services/receiptsApi';
import { setSessionToken } from './src/services/session';
import { colors, radius, spacing } from './src/theme';
import {
  AppErrorLog,
  AppState,
  AuthSession,
  Claim,
  DocumentKind,
  ExpenseDocument,
  PaymentMethod,
  UkTaxRate,
  UserSettings,
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

const brandLogo = require('./assets/exdox-logo.png');
const brandMark = require('./assets/exdox-mark.png');
const brandBadge = require('./assets/brand-badge.png');
const workspaceName = 'exdox Workspace';
const TAX_RATE_OPTIONS: UkTaxRate[] = ['20% Standard', '5% Reduced', '0% Zero', 'Exempt', 'No VAT'];

const getWorkspaceContextForTab = (tab: MainTab): WorkspaceContext => (tab === 'sales' ? 'sales' : 'cost');
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
    category: isInvoice ? 'Accounts Payable' : 'General',
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
  };
};

const applyExtractedDocumentDraft = (
  document: ExpenseDocument,
  extracted: ExtractedDocumentDraft,
): ExpenseDocument => ({
  ...document,
  title: extracted.supplier || document.title,
  supplier: extracted.supplier,
  amount: extracted.amount ?? document.amount,
  netAmount: extracted.netAmount ?? document.netAmount ?? extracted.amount ?? document.amount,
  vatAmount: extracted.vatAmount ?? document.vatAmount ?? extracted.taxAmount ?? document.taxAmount,
  taxRateApplied: extracted.taxRateApplied ?? document.taxRateApplied ?? 'No VAT',
  taxAmount: extracted.taxAmount ?? document.taxAmount,
  currency: extracted.currency ?? document.currency,
  category: extracted.category ?? document.category,
  dueDate: extracted.dueDate,
  invoiceNumber: extracted.invoiceNumber,
  notes: extracted.notes || document.notes,
  extractionStatus:
    extracted.extractionSource === 'backend_proxy' && !extractionLooksUnreadable(extracted)
      ? 'complete'
      : 'failed',
  extractionSource: extracted.extractionSource,
  confidenceScore: extracted.confidenceScore ?? null,
  needsReview: extracted.needsReview ?? true,
  lineItems: extracted.lineItems ?? [],
  taxBreakdown: extracted.taxBreakdown ?? [],
  cloudReceiptId: extracted.cloudReceiptId ?? document.cloudReceiptId,
  storageKey: extracted.storageKey ?? document.storageKey,
  storageBucket: extracted.storageBucket ?? document.storageBucket,
  workspaceContext: extracted.workspaceContext ?? document.workspaceContext,
  paymentMethod: extracted.paymentMethod ?? document.paymentMethod,
});

export default function App() {
  const hasLoggedLaunchRef = useRef(false);
  const hasRecoveredPickerResultRef = useRef(false);
  const hasRestoredStateRef = useRef(false);
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
  const [sheetTarget, setSheetTarget] = useState<MoreSheetTarget | null>(null);
  const [search, setSearch] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorLogs, setErrorLogs] = useState<AppErrorLog[]>([]);
  const [diagnosticLogs, setDiagnosticLogs] = useState<AppErrorLog[]>([]);
  const [errorLogVisible, setErrorLogVisible] = useState(false);
  const [pendingGalleryOpen, setPendingGalleryOpen] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const isAdmin = authSession?.user.role === 'Business_Admin';

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
      const [costDocuments, salesDocuments, remoteClaims] = await Promise.all([
        fetchCloudReceipts('cost'),
        session.user.role === 'Business_Admin' ? fetchCloudReceipts('sales') : Promise.resolve([]),
        fetchExpenseClaims(),
      ]);
      setAppState((current) => ({
        ...current,
        documents: [...costDocuments, ...salesDocuments].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
        claims: remoteClaims,
      }));
    } catch (error) {
      void recordError('cloud sync', error);
    }
  });

  const activateSession = useEffectEvent(async (session: AuthSession) => {
    setSessionToken(session.token);
    await saveAuthSession(session);
    const savedState = await loadScopedStoredState(String(session.user.id));
    setAuthSession(session);
    setAppState(savedState ?? seedState);
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
      InteractionManager.runAfterInteractions(() => {
        void recordDiagnostic(document.source, `Deferred commit running after interactions from ${origin}`);
        void commitPreparedDocument(document, origin);
      });
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
      await recordDiagnostic(source, `Background upload complete for ${fileName}`);
      updateState((current) => ({
        ...current,
        documents: current.documents.map((document) =>
          document.id === documentId ? applyExtractedDocumentDraft(document, extracted) : document,
        ),
      }));
    } catch (error) {
      await recordDiagnostic(source, `Background upload failed for ${fileName}`);
      void recordError('background upload', error);
    }
  });

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
        const nextDocument = await prepareManualDocument({
          source: 'gallery',
          type: captureType,
          uri: asset.uri,
          fileName: asset.fileName ?? `${captureType}-${Date.now()}.jpg`,
          workspaceContext: getWorkspaceContextForTab(activeTab),
          paymentMethod: getDefaultPaymentMethod(getWorkspaceContextForTab(activeTab), Boolean(isAdmin)),
        });
        schedulePreparedDocumentCommit(nextDocument, 'recovery');
        await recordDiagnostic('gallery', 'Recovered result scheduled for deferred commit');
      } catch (error) {
        void recordError('picker pending result', error);
      }
    })();
  }, [activeTab, captureType, isAdmin, prepareManualDocument, recordDiagnostic, recordError, schedulePreparedDocumentCommit]);

  useEffect(() => {
    if (!authSession) {
      return;
    }

    void syncCloudWorkspace(authSession);
  }, [authSession, syncCloudWorkspace]);

  useEffect(() => {
    if (!isAdmin && activeTab === 'sales') {
      setActiveTab('costs');
    }
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (!isAdmin && captureType === 'invoice') {
      setCaptureType('receipt');
    }
  }, [captureType, isAdmin]);

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
          return true;
        }

        return [document.title, document.supplier, document.notes, document.category]
          .join(' ')
          .toLowerCase()
          .includes(term);
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [activeTab, appState.documents, deferredSearch]);

  const selectedDocument = useMemo(
    () => appState.documents.find((document) => document.id === selectedDocumentId) ?? null,
    [appState.documents, selectedDocumentId],
  );

  const claims = useMemo(
    () => [...appState.claims].sort((left, right) => right.name.localeCompare(left.name)),
    [appState.claims],
  );

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
    await recordDiagnostic('gallery', 'Requesting photo library permission');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      await recordDiagnostic('gallery', 'Photo library permission denied');
      Alert.alert('Photos permission needed', 'Allow photo access to import a receipt or invoice image.');
      return;
    }

    await recordDiagnostic('gallery', 'Launching image library');
    const pickerOptions: any = {
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
      exif: false,
      selectionLimit: Platform.OS === 'android' ? 2 : 1,
    };
    const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);

    try {
      if (!result.canceled) {
        const asset = result.assets[0];
        await recordDiagnostic(
          'gallery',
          `Image selected: ${asset.fileName ?? 'unnamed'} | uri=${asset.uri ?? 'missing-uri'}`,
        );
        const nextDocument = await prepareManualDocument({
          source: 'gallery',
          type: captureType,
          uri: asset.uri,
          fileName: asset.fileName ?? `${captureType}-${Date.now()}.jpg`,
          ...getCurrentCaptureContext(),
        });
        await recordDiagnostic('gallery', 'Manual draft document built');
        schedulePreparedDocumentCommit(nextDocument, 'gallery');
        await recordDiagnostic('gallery', 'Document scheduled for deferred state commit');
      } else {
        await recordDiagnostic('gallery', 'Image selection canceled');
      }
    } catch (error) {
      await recordDiagnostic('gallery', 'Image handling threw an error');
      void recordError('openGalleryPicker', error);
      console.error('handlePickImage failed', error);
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

  const handleMileageClaim = () => {
    setSheetTarget(null);
    Alert.alert('Mileage tracking coming soon', 'The mileage claim flow is reserved for the next rollout.');
  };

  const updateDocumentStatus = (documentId: string, status: ExpenseDocument['status']) => {
    updateState((current) => ({
      ...current,
      documents: current.documents.map((document) =>
        document.id === documentId ? { ...document, status } : document,
      ),
    }));
  };

  const updateDocumentTaxFields = (
    documentId: string,
    taxFields: Pick<ExpenseDocument, 'amount' | 'netAmount' | 'vatAmount' | 'taxAmount' | 'taxRateApplied'>,
  ) => {
    updateState((current) => ({
      ...current,
      documents: current.documents.map((document) =>
        document.id === documentId ? { ...document, ...taxFields, needsReview: true } : document,
      ),
    }));
  };

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

  const handleCreateClaim = useEffectEvent(async () => {
    try {
      await createCloudClaim({
        name: `Expense Claim ${new Date().toLocaleDateString('en-GB')}`,
        description: 'Created from the expense claims tab.',
        currency: 'GBP',
      });
      if (authSession) {
        await syncCloudWorkspace(authSession);
      }
    } catch (error) {
      void recordError('handleCreateClaim', error);
      Alert.alert('Claim failed', error instanceof Error ? error.message : 'Could not create a new claim.');
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

  if (!isReady) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <Image source={brandBadge} resizeMode="contain" style={styles.loadingLogo} />
        <Text style={styles.loadingText}>Preparing your workspace...</Text>
      </SafeAreaView>
    );
  }

  if (!authSession) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
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
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.screen}>
        <TopHeader
          title={tabTitle}
          subtitle={authSession.user.fullName || authSession.user.email}
          onOpenMore={() => setSheetTarget('menu')}
        />

        {(activeTab === 'costs' || activeTab === 'sales' || activeTab === 'claims') && (
          <SearchBand value={search} onChangeText={setSearch} />
        )}

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {activeTab === 'costs' && (
            <CostsScreen
              documents={filteredDocuments}
              onOpenDocument={setSelectedDocumentId}
              onAddDocument={openCapture}
            />
          )}
          {activeTab === 'sales' && (
            <SalesScreen
              documents={filteredDocuments}
              onOpenDocument={setSelectedDocumentId}
              onAddDocument={openCapture}
            />
          )}
          {activeTab === 'claims' && (
            <ClaimsScreen
              claims={claims}
              documents={appState.documents}
              claimableDocuments={claimableDocuments}
              onCreateClaim={() => void handleCreateClaim()}
              onAttachDocument={(claim, document) => void handleAttachToClaim(claim, document)}
            />
          )}
          {activeTab === 'more' && (
            <SettingsScreen
              accountName={authSession.user.fullName || workspaceName}
              accountEmail={authSession.user.email}
              role={authSession.user.role}
              settings={appState.settings}
              errorLogCount={errorLogs.length}
              onUpdateSetting={updateSettings}
              onOpenErrorLog={() => setErrorLogVisible(true)}
              onSignOut={() => void handleSignOut()}
            />
          )}
        </ScrollView>

        <BottomNav
          activeTab={activeTab}
          isAdmin={Boolean(isAdmin)}
          onSelect={setActiveTab}
          onOpenCamera={openCapture}
          onOpenCaptureActions={openCaptureActions}
        />

        <CaptureModal
          visible={captureModalVisible}
          captureType={captureType}
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
          onOpenCamera={() => {
            setSheetTarget(null);
            void handleUseCamera();
          }}
          onUseGallery={() => {
            setSheetTarget(null);
            void handlePickImage();
          }}
          onCreateMileageClaim={handleMileageClaim}
          onAddToVault={() => void handleAddToVault()}
        />

        <DocumentSheet
          document={selectedDocument}
          onClose={() => setSelectedDocumentId(null)}
          onMarkReviewed={() => {
            if (selectedDocument) {
              updateDocumentStatus(selectedDocument.id, 'ready_to_submit');
            }
          }}
          onAddToClaim={() => {
            if (selectedDocument) {
              void createClaimFromReceipt(selectedDocument);
            }
          }}
          onUpdateTaxFields={(taxFields) => {
            if (selectedDocument) {
              updateDocumentTaxFields(selectedDocument.id, taxFields);
            }
          }}
          onMarkSubmitted={() => {
            if (selectedDocument) {
              updateDocumentStatus(selectedDocument.id, 'submitted');
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
  onOpenMore,
}: {
  title: string;
  subtitle: string;
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
        <Ionicons name="notifications-outline" size={24} color={colors.nearBlack} />
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
}: {
  value: string;
  onChangeText: (value: string) => void;
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
      <Ionicons name="filter-outline" size={24} color={colors.nearBlack} />
    </View>
  );
}

function CostsScreen({
  documents,
  onOpenDocument,
  onAddDocument,
}: {
  documents: ExpenseDocument[];
  onOpenDocument: (id: string) => void;
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
    <View>
      <View style={styles.dayHeader}>
        <Text style={styles.dayHeaderText}>Today</Text>
      </View>
      {documents.map((document) => (
        <DocumentRow key={document.id} document={document} onPress={() => onOpenDocument(document.id)} />
      ))}
    </View>
  );
}

function SalesScreen({
  documents,
  onOpenDocument,
  onAddDocument,
}: {
  documents: ExpenseDocument[];
  onOpenDocument: (id: string) => void;
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
    <View>
      {documents.map((document) => (
        <DocumentRow key={document.id} document={document} onPress={() => onOpenDocument(document.id)} />
      ))}
    </View>
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
  errorLogCount,
  onUpdateSetting,
  onOpenErrorLog,
  onSignOut,
}: {
  accountName: string;
  accountEmail: string;
  role: 'Business_Admin' | 'Standard_Employee';
  settings: UserSettings;
  errorLogCount: number;
  onUpdateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
  onOpenErrorLog: () => void;
  onSignOut: () => void;
}) {
  return (
    <View>
      <View style={styles.profileRow}>
        <View style={styles.profileAvatar}>
          <Ionicons name="person-outline" size={28} color={colors.nearBlack} />
        </View>
        <View>
          <Text style={styles.profileName}>{accountName}</Text>
          <Text style={styles.profileEmail}>{accountEmail}</Text>
          <Text style={styles.profileRole}>
            {role === 'Business_Admin' ? 'Business admin access' : 'Standard employee access'}
          </Text>
        </View>
      </View>

      <SettingsLink icon="people-outline" label="Logins" />
      <SettingsLink icon="mail-outline" label="Extract by email" />
      <SettingsLink icon="car-outline" label="Vehicles" />
      {role === 'Business_Admin' ? (
        <>
          <SettingsLink icon="bar-chart-outline" label="Analytics" />
          <SettingsLink icon="download-outline" label="Team exports" />
          <SettingsLink icon="card-outline" label="Billing" />
        </>
      ) : null}
      <SettingsButton
        icon="alert-circle-outline"
        label={`Error log${errorLogCount ? ` (${errorLogCount})` : ''}`}
        onPress={onOpenErrorLog}
      />
      <SettingsButton icon="log-out-outline" label="Sign out" onPress={onSignOut} />

      <View style={styles.settingsGroup}>
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
          <Text style={styles.settingValue}>System default</Text>
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

function SettingsLink({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.settingsLink}>
      <Ionicons name={icon} size={24} color={colors.nearBlack} />
      <Text style={styles.settingsLinkText}>{label}</Text>
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

function DocumentRow({
  document,
  onPress,
  compact = false,
}: {
  document: ExpenseDocument;
  onPress: () => void;
  compact?: boolean;
}) {
  const hasPreviewImage =
    Boolean(document.fileUri) && /\.(jpg|jpeg|png|webp|heic)$/i.test(document.fileName);
  const isProcessing = document.extractionStatus === 'pending';
  const extractionStatusText =
    document.extractionStatus === 'pending'
      ? 'Reading receipt...'
      : document.extractionStatus === 'failed'
        ? 'Could not read receipt or invoice'
        : document.needsReview
          ? 'Check extracted details'
          : null;

  return (
    <Pressable style={[styles.documentRow, compact && styles.documentRowCompact]} onPress={onPress}>
      <View style={styles.documentLeft}>
        {hasPreviewImage ? (
          <Image
            source={{ uri: document.fileUri }}
            resizeMethod="resize"
            resizeMode="cover"
            style={styles.documentThumb}
          />
        ) : (
          <View style={styles.documentThumbFallback}>
            <View style={styles.documentDot} />
          </View>
        )}
        <View>
          <Text style={styles.documentTitle}>{document.title}</Text>
          <Text style={[styles.documentAmount, isProcessing && styles.documentAmountPending]}>{`£${document.amount.toFixed(2)}`}</Text>
          {extractionStatusText ? <Text style={styles.documentStatusText}>{extractionStatusText}</Text> : null}
        </View>
      </View>
      <View style={styles.documentRight}>
        <Text style={styles.documentDate}>{formatDate(document.date)}</Text>
        <StatusPill status={document.status} />
      </View>
    </Pressable>
  );
}

function StatusPill({ status }: { status: ExpenseDocument['status'] }) {
  const label =
    status === 'awaiting_review'
      ? 'To review'
      : status === 'ready_to_submit'
        ? 'Reviewed'
        : status === 'submitted'
          ? 'Submitted'
          : 'Paid';

  const tone =
    status === 'awaiting_review'
      ? styles.pillReview
      : status === 'ready_to_submit'
        ? styles.pillReady
        : status === 'submitted'
          ? styles.pillSubmitted
          : styles.pillPaid;

  return (
    <View style={[styles.statusPill, tone]}>
      <Text style={styles.statusPillText}>{label}</Text>
    </View>
  );
}

function BottomNav({
  activeTab,
  isAdmin,
  onSelect,
  onOpenCamera,
  onOpenCaptureActions,
}: {
  activeTab: MainTab;
  isAdmin: boolean;
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
      {isAdmin ? (
        <BottomTabItem
          active={activeTab === 'sales'}
          label="Sales"
          icon="albums-outline"
          activeIcon="albums"
          onPress={() => onSelect('sales')}
        />
      ) : null}
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
  onOpenCamera,
  onUseGallery,
  onCreateMileageClaim,
  onAddToVault,
}: {
  target: MoreSheetTarget | null;
  isAdmin: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
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
            <Pressable style={styles.sheetRow} onPress={onClose}>
              <Ionicons name="wallet-outline" size={28} color={colors.nearBlack} />
              <Text style={styles.sheetText}>Vault</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={onOpenSettings}>
              <Ionicons name="settings-outline" size={28} color={colors.nearBlack} />
              <Text style={styles.sheetText}>Settings</Text>
            </Pressable>
            {isAdmin ? (
              <Pressable style={styles.sheetRow} onPress={onClose}>
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

function DocumentSheet({
  document,
  onClose,
  onMarkReviewed,
  onAddToClaim,
  onUpdateTaxFields,
  onMarkSubmitted,
}: {
  document: ExpenseDocument | null;
  onClose: () => void;
  onMarkReviewed: () => void;
  onAddToClaim: () => void;
  onUpdateTaxFields: (
    taxFields: Pick<ExpenseDocument, 'amount' | 'netAmount' | 'vatAmount' | 'taxAmount' | 'taxRateApplied'>,
  ) => void;
  onMarkSubmitted: () => void;
}) {
  const [totalInput, setTotalInput] = useState('0.00');
  const [netInput, setNetInput] = useState('0.00');
  const [vatInput, setVatInput] = useState('0.00');
  const [selectedTaxRate, setSelectedTaxRate] = useState<UkTaxRate>('No VAT');
  const [taxDropdownOpen, setTaxDropdownOpen] = useState(false);

  useEffect(() => {
    if (!document) {
      return;
    }
    setTotalInput(formatMoneyInput(document.amount));
    setNetInput(formatMoneyInput(document.netAmount ?? document.amount));
    setVatInput(formatMoneyInput(document.vatAmount ?? document.taxAmount));
    setSelectedTaxRate(document.taxRateApplied ?? 'No VAT');
    setTaxDropdownOpen(false);
  }, [document]);

  if (!document) {
    return null;
  }

  const hasPreviewImage =
    Boolean(document.fileUri) && /\.(jpg|jpeg|png|webp|heic)$/i.test(document.fileName);
  const extractionStatusText =
    document.extractionStatus === 'pending'
      ? 'Reading this receipt now.'
      : document.extractionStatus === 'failed'
        ? 'Could not read receipt or invoice.'
        : document.needsReview
          ? 'Extraction finished. Review the details before submitting.'
          : 'Extraction finished.';

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetOverlay} onPress={onClose} />
        <View style={styles.documentSheet}>
          <View style={styles.documentSheetHandle} />
          {hasPreviewImage ? (
            <Image
              source={{ uri: document.fileUri }}
              resizeMethod="resize"
              resizeMode="contain"
              style={styles.documentSheetPreview}
            />
          ) : null}
          <Text style={styles.documentSheetTitle}>{document.title}</Text>
          <Text style={styles.documentSheetMeta}>{document.supplier}</Text>
          <Text style={styles.documentSheetAmount}>£{document.amount.toFixed(2)}</Text>
          <Text style={styles.documentSheetStatus}>{extractionStatusText}</Text>
          <View style={styles.taxEditor}>
            <View style={styles.taxEditorRow}>
              <TaxAmountField label="Total" value={totalInput} onChangeText={setTotalInput} />
              <TaxAmountField label="Net" value={netInput} onChangeText={setNetInput} />
              <TaxAmountField label="VAT" value={vatInput} onChangeText={setVatInput} />
            </View>
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
            <Pressable
              style={styles.taxSaveButton}
              onPress={() => {
                const amount = parseMoneyInput(totalInput);
                const netAmount = parseMoneyInput(netInput);
                const vatAmount = parseMoneyInput(vatInput);
                onUpdateTaxFields({
                  amount,
                  netAmount,
                  vatAmount,
                  taxAmount: vatAmount,
                  taxRateApplied: selectedTaxRate,
                });
              }}
            >
              <Text style={styles.taxSaveButtonText}>Save tax values</Text>
            </Pressable>
          </View>
          <View style={styles.documentSheetActions}>
            <Pressable style={styles.sheetActionButton} onPress={onMarkReviewed}>
              <Text style={styles.sheetActionText}>Mark reviewed</Text>
            </Pressable>
            {document.workspaceContext === 'cost' && document.paymentMethod === 'cash_personal' ? (
              <Pressable style={styles.sheetActionButton} onPress={onAddToClaim}>
                <Text style={styles.sheetActionText}>Add to claim</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.sheetActionButton, styles.sheetActionPrimary]} onPress={onMarkSubmitted}>
              <Text style={styles.sheetActionPrimaryText}>Mark submitted</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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
  isAdmin: boolean;
  visible: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSelectType: (type: DocumentKind) => void;
  onUseCamera: () => void;
  onUseGallery: () => void;
  onUseFiles: () => void;
}) {
  const availableTypes = isAdmin ? (['receipt', 'invoice'] as const) : (['receipt'] as const);

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
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 26,
    paddingVertical: 18,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.band,
    borderBottomWidth: 1,
    borderBottomColor: colors.band,
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
    fontWeight: '700',
    color: colors.nearBlack,
  },
  profileEmail: {
    marginTop: 6,
    fontSize: 16,
    color: colors.mutedText,
  },
  profileRole: {
    marginTop: 8,
    fontSize: 14,
    color: colors.royalBlueDark,
    fontWeight: '600',
  },
  settingsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 26,
    paddingVertical: 22,
    borderBottomWidth: 1,
    borderBottomColor: colors.band,
  },
  settingsLinkText: {
    fontSize: 20,
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
    alignItems: 'center',
    paddingHorizontal: 26,
    paddingVertical: 16,
  },
  settingLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    flex: 1,
    paddingRight: 12,
  },
  settingLabel: {
    fontSize: 19,
    color: colors.nearBlack,
  },
  settingValue: {
    fontSize: 18,
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
  documentSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 38,
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
  documentSheetPreview: {
    width: '100%',
    height: 220,
    borderRadius: 18,
    backgroundColor: colors.band,
    marginBottom: 18,
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
  documentSheetActions: {
    marginTop: 24,
    gap: 12,
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
});
