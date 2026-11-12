import mongoose from 'mongoose';
import { SupplierLedgerEntry, SupplierPurchaseOrder } from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import { withMongoTransaction } from '../utils/mongoTransaction.js';
import type { AuthUser } from '../middleware/auth.js';
import {
  assertShopAccess,
  assertShopReceivingAccess,
  notifyUsers,
  publicRef,
  requireApprovedSupplierBusiness,
  shopAdminUserIds,
  supplierOwnerId
} from './supplierNetworkShared.js';

function serializeEntry(e: InstanceType<typeof SupplierLedgerEntry>) {
  return {
    id: String(e._id),
    publicId: e.publicId,
    shopId: String(e.shop),
    supplierBusinessId: String(e.supplierBusiness),
    purchaseOrderId: e.purchaseOrder ? String(e.purchaseOrder) : null,
    goodsReceiptId: e.goodsReceipt ? String(e.goodsReceipt) : null,
    kind: e.kind,
    entryType: e.entryType,
    amount: e.amount,
    currency: e.currency,
    externalReference: e.externalReference || '',
    paymentMethod: e.paymentMethod || '',
    paidAt: e.paidAt || null,
    notes: e.notes || '',
    status: e.status,
    reversesEntryId: e.reversesEntry ? String(e.reversesEntry) : null,
    reversalReason: e.reversalReason || '',
    recordedBy: String(e.recordedBy),
    createdAt: e.createdAt || null
  };
}

export async function postLedgerEntry(input: {
  user: AuthUser;
  shopId: string;
  supplierBusinessId: string;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
  kind: 'po_obligation' | 'goods_received' | 'supplier_invoice' | 'payment' | 'credit_note' | 'adjustment';
  amount: number;
  currency?: string;
  externalReference?: string;
  paymentMethod?: string;
  paidAt?: string | Date;
  notes?: string;
  idempotencyKey?: string;
  session?: mongoose.ClientSession;
}) {
  if (input.kind === 'goods_received') {
    assertShopReceivingAccess(input.user, input.shopId);
  } else {
    assertShopAccess(input.user, input.shopId);
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new AppError('Amount must be a non-zero number', 400, 'INVALID_AMOUNT');
  }

  if (input.idempotencyKey) {
    const existing = await SupplierLedgerEntry.findOne({
      shop: input.shopId,
      idempotencyKey: input.idempotencyKey
    }).session(input.session || null);
    if (existing) return serializeEntry(existing);
  }

  // Sign convention: obligations/invoices increase payable (+); payments/credits decrease (-)
  let signed = amount;
  if (input.kind === 'payment' || input.kind === 'credit_note') {
    signed = -Math.abs(amount);
  } else if (input.kind === 'po_obligation' || input.kind === 'supplier_invoice' || input.kind === 'goods_received') {
    signed = Math.abs(amount);
  }

  const [doc] = await SupplierLedgerEntry.create(
    [
      {
        publicId: publicRef('SLE', 5),
        shop: input.shopId,
        supplierBusiness: input.supplierBusinessId,
        purchaseOrder: input.purchaseOrderId,
        goodsReceipt: input.goodsReceiptId,
        kind: input.kind,
        entryType: 'posting',
        amount: signed,
        currency: input.currency || 'PKR',
        externalReference: String(input.externalReference || '').trim().slice(0, 120),
        paymentMethod: input.paymentMethod || '',
        paidAt: input.paidAt ? new Date(input.paidAt) : input.kind === 'payment' ? new Date() : undefined,
        notes: String(input.notes || '').trim().slice(0, 1000),
        recordedBy: input.user.id,
        status: 'posted',
        idempotencyKey: input.idempotencyKey
      }
    ],
    { session: input.session }
  );

  await writeAudit({
    actor: input.user.id,
    action: `supplier_ledger.${input.kind}`,
    entityType: 'SupplierLedgerEntry',
    entityId: doc._id,
    shop: input.shopId,
    details: { kind: input.kind, amount: signed, publicId: doc.publicId },
    session: input.session
  });

  return serializeEntry(doc);
}

export async function recordSupplierInvoice(input: {
  user: AuthUser;
  shopId: string;
  supplierBusinessId: string;
  purchaseOrderId?: string;
  amount: number;
  externalReference: string;
  notes?: string;
  idempotencyKey?: string;
}) {
  const result = await postLedgerEntry({
    ...input,
    kind: 'supplier_invoice',
    amount: Math.abs(input.amount),
    externalReference: input.externalReference
  });
  const owner = await supplierOwnerId(input.supplierBusinessId);
  await notifyUsers(
    [owner, ...(await shopAdminUserIds(input.shopId))],
    'supplier_finance',
    'Supplier invoice recorded',
    `Invoice ${input.externalReference} for ${Math.abs(input.amount)}`,
    { ledgerEntryId: result.id }
  );
  return result;
}

export async function recordSupplierPayment(input: {
  user: AuthUser;
  shopId: string;
  supplierBusinessId: string;
  purchaseOrderId?: string;
  amount: number;
  paymentMethod: string;
  externalReference?: string;
  paidAt?: string;
  notes?: string;
  idempotencyKey?: string;
}) {
  if (input.amount <= 0) throw new AppError('Payment amount must be positive', 400, 'INVALID_AMOUNT');
  const result = await withMongoTransaction(async (session) =>
    postLedgerEntry({
      ...input,
      kind: 'payment',
      amount: Math.abs(input.amount),
      session
    })
  );
  const owner = await supplierOwnerId(input.supplierBusinessId);
  await notifyUsers(
    [owner],
    'supplier_finance',
    'Payment recorded',
    `Payment of ${input.amount} recorded against your account`,
    { ledgerEntryId: result.id }
  );
  return result;
}

/** Credit note reduces payable but is never a cash payment. */
export async function recordSupplierCreditNote(input: {
  user: AuthUser;
  shopId: string;
  supplierBusinessId: string;
  purchaseOrderId?: string;
  amount: number;
  externalReference?: string;
  notes?: string;
  idempotencyKey?: string;
}) {
  if (input.amount <= 0) throw new AppError('Credit note amount must be positive', 400, 'INVALID_AMOUNT');
  const result = await withMongoTransaction(async (session) =>
    postLedgerEntry({
      user: input.user,
      shopId: input.shopId,
      supplierBusinessId: input.supplierBusinessId,
      purchaseOrderId: input.purchaseOrderId,
      kind: 'credit_note',
      amount: Math.abs(input.amount),
      externalReference: input.externalReference,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      session
    })
  );
  const owner = await supplierOwnerId(input.supplierBusinessId);
  await notifyUsers(
    [owner, ...(await shopAdminUserIds(input.shopId))],
    'supplier_finance',
    'Credit note recorded',
    `Credit note of ${input.amount} recorded (not a cash payment)`,
    { ledgerEntryId: result.id }
  );
  return result;
}

export async function reverseLedgerEntry(input: {
  user: AuthUser;
  entryId: string;
  reason: string;
}) {
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) throw new AppError('Reversal reason required', 400, 'REASON_REQUIRED');

  return withMongoTransaction(async (session) => {
    const original = await SupplierLedgerEntry.findById(input.entryId).session(session);
    if (!original) throw new AppError('Ledger entry not found', 404, 'NOT_FOUND');
    assertShopAccess(input.user, String(original.shop));
    if (original.status === 'reversed' || original.entryType === 'reversal') {
      throw new AppError('Entry already reversed', 409, 'ALREADY_REVERSED');
    }

    original.status = 'reversed';
    await original.save({ session });

    const [reversal] = await SupplierLedgerEntry.create(
      [
        {
          publicId: publicRef('SLR', 5),
          shop: original.shop,
          supplierBusiness: original.supplierBusiness,
          purchaseOrder: original.purchaseOrder,
          goodsReceipt: original.goodsReceipt,
          kind: 'reversal',
          entryType: 'reversal',
          amount: -original.amount,
          currency: original.currency,
          notes: `Reversal of ${original.publicId}`,
          recordedBy: input.user.id,
          reversesEntry: original._id,
          reversalReason: reason.slice(0, 500),
          status: 'posted',
          idempotencyKey: `reversal:${original.publicId}`
        }
      ],
      { session }
    );

    await writeAudit({
      actor: input.user.id,
      action: 'supplier_ledger.reverse',
      entityType: 'SupplierLedgerEntry',
      entityId: reversal._id,
      shop: original.shop,
      details: { originalId: String(original._id), reason },
      session
    });

    return serializeEntry(reversal);
  });
}

/**
 * Entries that form accounts-payable (money owed).
 * `po_obligation` is a purchasing commitment memo — included in totalObligations
 * but excluded from outstandingPayable so GRN goods_received is not double-counted.
 * Reversed originals stay in the sum together with their opposite `reversal` rows
 * so neutralization nets to zero (status=reversed alone must not drop the original
 * while also posting +opposite).
 */
const PAYABLE_KINDS = new Set([
  'goods_received',
  'supplier_invoice',
  'payment',
  'credit_note',
  'adjustment',
  'reversal'
]);

export async function getSupplierBalance(user: AuthUser, shopId: string, supplierBusinessId: string) {
  assertShopAccess(user, shopId);
  const entries = await SupplierLedgerEntry.find({
    shop: shopId,
    supplierBusiness: supplierBusinessId,
    status: { $in: ['posted', 'reversed'] },
    entryType: { $in: ['posting', 'reversal'] }
  });
  const outstanding = entries
    .filter((e) => PAYABLE_KINDS.has(e.kind))
    .reduce((s, e) => s + e.amount, 0);
  const active = entries.filter((e) => e.status === 'posted');
  const payments = active
    .filter((e) => e.kind === 'payment')
    .reduce((s, e) => s + Math.abs(e.amount), 0);
  const creditNotes = active
    .filter((e) => e.kind === 'credit_note')
    .reduce((s, e) => s + Math.abs(e.amount), 0);
  const invoices = active
    .filter((e) => e.kind === 'supplier_invoice' || e.kind === 'po_obligation')
    .reduce((s, e) => s + Math.max(0, e.amount), 0);
  const received = active
    .filter((e) => e.kind === 'goods_received')
    .reduce((s, e) => s + Math.max(0, e.amount), 0);

  return {
    shopId,
    supplierBusinessId,
    outstandingPayable: Math.round(outstanding * 100) / 100,
    totalObligations: Math.round(invoices * 100) / 100,
    totalReceivedValue: Math.round(received * 100) / 100,
    /** Cash/digital payments only — credit notes are excluded. */
    totalPayments: Math.round(payments * 100) / 100,
    totalCreditNotes: Math.round(creditNotes * 100) / 100,
    currency: entries[0]?.currency || 'PKR'
  };
}

export async function listLedgerEntries(
  user: AuthUser,
  opts: { shopId?: string; supplierBusinessId?: string; purchaseOrderId?: string }
) {
  if (user.role === 'supplier') {
    const business = await requireApprovedSupplierBusiness(user.id);
    const filter: Record<string, unknown> = { supplierBusiness: business._id };
    if (opts.purchaseOrderId) filter.purchaseOrder = opts.purchaseOrderId;
    const rows = await SupplierLedgerEntry.find(filter).sort({ createdAt: -1 }).limit(300);
    return rows.map(serializeEntry);
  }

  const shopId = String(opts.shopId || user.shopIds[0] || '');
  assertShopAccess(user, shopId);
  const filter: Record<string, unknown> = { shop: shopId };
  if (opts.supplierBusinessId) filter.supplierBusiness = opts.supplierBusinessId;
  if (opts.purchaseOrderId) filter.purchaseOrder = opts.purchaseOrderId;
  const rows = await SupplierLedgerEntry.find(filter).sort({ createdAt: -1 }).limit(300);
  return rows.map(serializeEntry);
}

/** Outstanding payables report rows for a shop */
export async function outstandingPayablesReport(user: AuthUser, shopId: string) {
  assertShopAccess(user, shopId);
  const rows = await SupplierLedgerEntry.aggregate([
    {
      $match: {
        shop: new mongoose.Types.ObjectId(shopId),
        // Include reversed originals + reversal rows so pairs net to zero.
        status: { $in: ['posted', 'reversed'] },
        entryType: { $in: ['posting', 'reversal'] },
        // Exclude PO commitment memos — AP is goods_received / invoices / payments / credits.
        kind: { $in: [...PAYABLE_KINDS] }
      }
    },
    {
      $group: {
        _id: '$supplierBusiness',
        outstanding: { $sum: '$amount' },
        currency: { $first: '$currency' }
      }
    },
    { $match: { outstanding: { $gt: 0.009 } } },
    { $sort: { outstanding: -1 } }
  ]);
  return rows.map((r) => ({
    supplierBusinessId: String(r._id),
    outstandingPayable: Math.round(r.outstanding * 100) / 100,
    currency: r.currency || 'PKR'
  }));
}

export async function purchasesBySupplierReport(
  user: AuthUser,
  shopId: string,
  from?: string,
  to?: string
) {
  assertShopAccess(user, shopId);
  const match: Record<string, unknown> = {
    shop: new mongoose.Types.ObjectId(shopId),
    status: { $nin: ['cancelled', 'draft'] }
  };
  if (from || to) {
    match.issuedAt = {};
    if (from) (match.issuedAt as Record<string, Date>).$gte = new Date(from);
    if (to) (match.issuedAt as Record<string, Date>).$lte = new Date(to);
  }
  const rows = await SupplierPurchaseOrder.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$supplierBusiness',
        poCount: { $sum: 1 },
        totalOrdered: { $sum: '$grandTotal' }
      }
    },
    { $sort: { totalOrdered: -1 } }
  ]);
  return rows.map((r) => ({
    supplierBusinessId: String(r._id),
    poCount: r.poCount,
    totalOrdered: Math.round(r.totalOrdered * 100) / 100
  }));
}
