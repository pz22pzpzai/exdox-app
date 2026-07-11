import { type Claim, type ExpenseDocument, type PaymentMethod, type WorkspaceContext } from '../types';
import { getApiBaseUrl } from './auth';
import { requireSessionToken } from './session';

type ReceiptApiResponse = {
  success: true;
  receipts: Array<{
    id: number;
    organisationId: number;
    uploadedByUserId: number;
    workspaceContext: WorkspaceContext;
    paymentMethod: PaymentMethod;
    claimId: number | null;
    sourceFilename: string;
    s3Bucket: string;
    s3Key: string;
    documentType: 'receipt' | 'invoice' | 'unknown';
    vendorName: string | null;
    invoiceDate: string | null;
    dueDate: string | null;
    invoiceNumber: string | null;
    currency: string | null;
    totalAmount: number | null;
    netAmount: number | null;
    vatAmount: number | null;
    taxRateApplied: ExpenseDocument['taxRateApplied'] | null;
    totalTaxAmount: number | null;
    needsReview: boolean;
    confidenceScore: number | null;
    lineItems: NonNullable<ExpenseDocument['lineItems']>;
    taxBreakdown: NonNullable<ExpenseDocument['taxBreakdown']>;
    notes: string[];
    createdAt: string;
  }>;
};

type ClaimApiResponse = {
  success: true;
  claims: Array<{
    id: number;
    name: string;
    description: string | null;
    status: 'pending' | 'approved' | 'paid' | 'rejected';
    totalAmount: number;
    documentCount: number;
    currency: string;
    createdByUserId: number;
    createdAt: string;
  }>;
};

export async function fetchCloudReceipts(workspaceContext?: WorkspaceContext) {
  const token = requireSessionToken();
  const searchParams = new URLSearchParams();
  if (workspaceContext) {
    searchParams.set('workspace_context', workspaceContext);
  }
  const response = await fetch(`${getApiBaseUrl()}/receipts${searchParams.size ? `?${searchParams.toString()}` : ''}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json()) as ReceiptApiResponse | { success: false; message?: string };
  if (!response.ok || !('success' in data) || data.success !== true) {
    throw new Error('message' in data && typeof data.message === 'string' ? data.message : 'Could not load cloud receipts.');
  }

  return data.receipts.map(mapReceiptToDocument);
}

export async function fetchClaimableReceipts() {
  const token = requireSessionToken();
  const response = await fetch(`${getApiBaseUrl()}/receipts?workspace_context=cost&only_claimable=true`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json()) as ReceiptApiResponse | { success: false; message?: string };
  if (!response.ok || !('success' in data) || data.success !== true) {
    throw new Error('message' in data && typeof data.message === 'string' ? data.message : 'Could not load claimable receipts.');
  }

  return data.receipts.map(mapReceiptToDocument);
}

export async function fetchExpenseClaims() {
  const token = requireSessionToken();
  const response = await fetch(`${getApiBaseUrl()}/claims`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json()) as ClaimApiResponse | { success: false; message?: string };
  if (!response.ok || !('success' in data) || data.success !== true) {
    throw new Error('message' in data && typeof data.message === 'string' ? data.message : 'Could not load expense claims.');
  }

  return data.claims.map(
    (claim): Claim => ({
      id: `claim-${claim.id}`,
      cloudClaimId: claim.id,
      name: claim.name,
      description: claim.description ?? undefined,
      status: claim.status,
      total: claim.totalAmount,
      currency: claim.currency,
      documentIds: [],
      trip: claim.description ?? 'Expense claim',
      owner: `User ${claim.createdByUserId}`,
      submittedOn: claim.createdAt,
    }),
  );
}

export async function createCloudClaim(input: { name: string; description?: string; currency?: string }) {
  const token = requireSessionToken();
  const response = await fetch(`${getApiBaseUrl()}/claims`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const data = (await response.json()) as
    | { success: true; claim: ClaimApiResponse['claims'][number] }
    | { success: false; message?: string };
  if (!response.ok || !('success' in data) || data.success !== true) {
    throw new Error('message' in data && typeof data.message === 'string' ? data.message : 'Could not create expense claim.');
  }

  return data.claim;
}

export async function attachCloudReceiptToClaim(input: { receiptId: number; claimId: number }) {
  const token = requireSessionToken();
  const response = await fetch(`${getApiBaseUrl()}/claims/attach`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const data = (await response.json()) as { success: true } | { success: false; message?: string };
  if (!response.ok || !('success' in data) || data.success !== true) {
    throw new Error('message' in data && typeof data.message === 'string' ? data.message : 'Could not attach receipt to expense claim.');
  }
}

export async function deleteCloudReceipt(receiptId: number) {
  const token = requireSessionToken();
  const response = await fetch(`${getApiBaseUrl()}/receipts/${receiptId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 204) {
    return;
  }

  const data = (await response.json()) as { success?: boolean; message?: string };
  if (!response.ok || data.success === false) {
    throw new Error(typeof data.message === 'string' ? data.message : 'Could not delete this receipt.');
  }
}

export async function updateCloudReceipt(
  receiptId: number,
  updates: Partial<
    Pick<
      ExpenseDocument,
      'supplier' | 'date' | 'dueDate' | 'invoiceNumber' | 'category' | 'netAmount' | 'vatAmount' | 'amount' | 'taxRateApplied' | 'status'
    >
  >,
) {
  const token = requireSessionToken();
  const response = await fetch(`${getApiBaseUrl()}/receipts/${receiptId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      vendorName: updates.supplier,
      invoiceDate: updates.date,
      dueDate: updates.dueDate,
      invoiceNumber: updates.invoiceNumber,
      category: updates.category,
      netAmount: updates.netAmount,
      vatAmount: updates.vatAmount,
      totalAmount: updates.amount,
      taxRateApplied: updates.taxRateApplied,
      status: updates.status,
    }),
  });

  const data = (await response.json()) as { success?: boolean; message?: string };
  if (!response.ok || data.success === false) {
    throw new Error(typeof data.message === 'string' ? data.message : 'Could not update this receipt.');
  }
}

export async function fetchCloudReceiptAssetUrl(receiptId: number) {
  const token = requireSessionToken();
  const response = await fetch(`${getApiBaseUrl()}/receipts/${receiptId}/asset-url`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json()) as
    | {
        success: true;
        asset?: {
          downloadUrl?: string;
        };
      }
    | { success: false; message?: string };

  if (!response.ok || !('success' in data) || data.success !== true || !data.asset?.downloadUrl) {
    throw new Error(
      'message' in data && typeof data.message === 'string'
        ? data.message
        : 'Could not load the receipt image.',
    );
  }

  return data.asset.downloadUrl;
}

function mapReceiptToDocument(receipt: ReceiptApiResponse['receipts'][number]): ExpenseDocument {
  return {
    id: `cloud-${receipt.id}`,
    type: receipt.documentType === 'invoice' ? 'invoice' : 'receipt',
    workspaceContext: receipt.workspaceContext,
    paymentMethod: receipt.paymentMethod,
    title: receipt.vendorName || receipt.sourceFilename.replace(/\.[^/.]+$/, ''),
    supplier: receipt.vendorName || 'Merchant to review',
    amount: receipt.totalAmount ?? 0,
    netAmount: receipt.netAmount ?? receipt.totalAmount ?? 0,
    vatAmount: receipt.vatAmount ?? receipt.totalTaxAmount ?? 0,
    taxRateApplied: receipt.taxRateApplied ?? 'No VAT',
    taxAmount: receipt.totalTaxAmount ?? 0,
    currency: receipt.currency ?? 'GBP',
    status: 'awaiting_review',
    category: receipt.documentType === 'invoice' ? 'Accounts Payable' : 'General',
    date: receipt.invoiceDate ?? receipt.createdAt,
    dueDate: receipt.dueDate ?? undefined,
    invoiceNumber: receipt.invoiceNumber ?? undefined,
    notes: receipt.notes.join(' ') || 'Imported from your cloud receipts.',
    tags: [receipt.documentType, 'cloud'],
    fileName: receipt.sourceFilename,
    source: 'files',
    claimId: receipt.claimId === null ? undefined : `claim-${receipt.claimId}`,
    cloudReceiptId: receipt.id,
    storageKey: receipt.s3Key,
    storageBucket: receipt.s3Bucket,
    extractionStatus: 'complete',
    extractionSource: 'backend_proxy',
    confidenceScore: receipt.confidenceScore,
    needsReview: receipt.needsReview,
    lineItems: receipt.lineItems,
    taxBreakdown: receipt.taxBreakdown,
    createdAt: receipt.createdAt,
    updatedAt: receipt.createdAt,
  };
}
