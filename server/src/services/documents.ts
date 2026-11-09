import crypto from 'crypto';
import type { ClientSession } from 'mongoose';
import {
  DocumentSequence,
  FinancialDocument,
  PartsReservation,
  PaymentRecord,
  RepairEstimate,
  RepairRequest,
  ShopSettings
} from '../models/index.js';
import type { AuthUser } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { withMongoTransaction } from '../utils/mongoTransaction.js';
import { assertCanViewRepair, assertShopAccess } from './access.js';
import { writeAudit } from './audit.js';
import { notify } from './notifications.js';
import { enqueueOutboxEvent, kickOutboxProcessor } from './outbox.js';
import type { PaymentMethod } from '../models/PaymentRecord.js';

export type DocType =
  | 'intake_receipt'
  | 'job_card'
  | 'estimate'
  | 'invoice'
  | 'payment_receipt'
  | 'warranty'
  | 'handover';

async function nextDocumentNumber(shopId: string, docType: DocType) {
  // Atomic $inc is the source of truth; issued number == value after increment.
  const updated = await DocumentSequence.findOneAndUpdate(
    { shop: shopId, docType },
    { $inc: { nextNumber: 1 }, $setOnInsert: { shop: shopId, docType } },
    { upsert: true, new: true }
  );
  const n = updated?.nextNumber;
  if (!n || n < 1) throw new AppError('Document sequence failure', 500, 'SEQUENCE_ERROR');
  const prefix = {
    intake_receipt: 'IN',
    job_card: 'JC',
    estimate: 'QT',
    invoice: 'INV',
    payment_receipt: 'PR',
    warranty: 'WR',
    handover: 'HO'
  }[docType];
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

export async function getOrCreateShopSettings(shopId: string) {
  // Atomic upsert avoids E11000 races when many documents issue concurrently.
  const settings = await ShopSettings.findOneAndUpdate(
    { shop: shopId },
    { $setOnInsert: { shop: shopId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (!settings) throw new AppError('Unable to load shop settings', 500, 'SETTINGS_ERROR');
  return settings;
}

export async function updateShopSettings(user: AuthUser, shopId: string, patch: Record<string, unknown>) {
  assertShopAccess(user, shopId);
  if (user.role !== 'shop_admin') throw new AppError('Forbidden', 403, 'FORBIDDEN');
  const settings = await getOrCreateShopSettings(shopId);
  const allowed = [
    'logoUrl',
    'receiptHeader',
    'receiptFooter',
    'currency',
    'taxLabel',
    'taxRatePercent',
    'warrantyTerms',
    'defaultPrintFormat',
    'printLanguage',
    'businessLegalName',
    'contactExtra'
  ] as const;
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      (settings as unknown as Record<string, unknown>)[key] = patch[key];
    }
  }
  await settings.save();
  return settings;
}

async function loadRepairForDocs(repairId: string) {
  const repair = await RepairRequest.findById(repairId)
    .populate('shop')
    .populate('customer', 'name email phone')
    .populate('assignedMechanic', 'name');
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  return repair;
}

function paymentStatus(total: number, paid: number): 'unpaid' | 'partial' | 'paid' | 'not_applicable' {
  if (total <= 0) return 'not_applicable';
  if (paid <= 0) return 'unpaid';
  if (paid + 0.0001 >= total) return 'paid';
  return 'partial';
}

export async function issueDocument(input: {
  user: AuthUser;
  repairId: string;
  docType: DocType;
  paymentId?: string;
}) {
  const repair = await loadRepairForDocs(input.repairId);
  const shopId = (repair.shop as { _id: { toString(): string } })._id.toString();

  if (input.user.role === 'customer') {
    assertCanViewRepair(input.user, repair);
    if (!['intake_receipt', 'estimate', 'invoice', 'payment_receipt', 'warranty', 'handover'].includes(input.docType)) {
      throw new AppError('Forbidden document type', 403, 'FORBIDDEN');
    }
  } else {
    assertShopAccess(input.user, shopId);
    if (input.user.role === 'mechanic') assertCanViewRepair(input.user, repair);
  }

  if (
    input.docType === 'invoice' &&
    !['ready_for_collection', 'completed'].includes(repair.status)
  ) {
    throw new AppError('Invoice requires a completed repair', 409, 'INVALID_STATE');
  }
  if (input.docType === 'payment_receipt' && !input.paymentId) {
    throw new AppError('paymentId required for payment receipts', 400, 'VALIDATION');
  }
  if (input.docType === 'warranty' && repair.status !== 'completed') {
    throw new AppError('Warranty document requires completion', 409, 'INVALID_STATE');
  }

  const settings = await getOrCreateShopSettings(shopId);
  const shop = repair.shop as unknown as {
    name: string;
    address: string;
    city: string;
    phone: string;
    email?: string;
  };
  const customer = repair.customer as unknown as { name: string; email?: string; phone?: string };
  const estimates = await RepairEstimate.find({ repairRequest: repair._id }).sort({ version: -1 });
  const approved = estimates.find((e) => e.status === 'approved') || estimates[0];
  const payments = await PaymentRecord.find({ repairRequest: repair._id }).sort({ paidAt: 1 });
  const amountPaid = Math.max(0, sumConfirmedPayments(payments));

  let subtotal = 0;
  let discountAmount = 0;
  let lineItems: { description: string; quantity: number; unitAmount: number; amount: number }[] = [];

  if (input.docType === 'estimate' && approved) {
    lineItems = [
      {
        description: 'Labor',
        quantity: 1,
        unitAmount: approved.laborCost,
        amount: approved.laborCost
      },
      {
        description: 'Parts',
        quantity: 1,
        unitAmount: approved.partsCost,
        amount: approved.partsCost
      },
      ...(approved.lineItems || []).map((li) => ({
        description: li.description,
        quantity: 1,
        unitAmount: li.amount,
        amount: li.amount
      }))
    ];
    subtotal = lineItems.reduce((s, l) => s + l.amount, 0);
  } else if (input.docType === 'invoice' || input.docType === 'payment_receipt') {
    const reservations = await PartsReservation.find({
      repairRequest: repair._id,
      status: 'consumed'
    }).populate('part', 'name sku unitCost');

    lineItems = [];
    if (approved) {
      if (approved.laborCost > 0) {
        lineItems.push({
          description: 'Labor charges',
          quantity: 1,
          unitAmount: approved.laborCost,
          amount: approved.laborCost
        });
      }

      const partsBudget = Number(approved.partsCost || 0);
      const totalQty = reservations.reduce((s, r) => s + Number(r.quantity || 0), 0);
      if (reservations.length && partsBudget > 0 && totalQty > 0) {
        let allocated = 0;
        reservations.forEach((resv, idx) => {
          const part = resv.part as unknown as { name?: string; sku?: string } | null;
          const qty = Number(resv.quantity || 0);
          const amount =
            idx === reservations.length - 1
              ? Math.round((partsBudget - allocated) * 100) / 100
              : Math.round((partsBudget * (qty / totalQty)) * 100) / 100;
          allocated = Math.round((allocated + amount) * 100) / 100;
          lineItems.push({
            description: part?.name
              ? `Replacement part: ${part.name}${part.sku ? ` (${part.sku})` : ''}`
              : 'Replacement part',
            quantity: qty,
            unitAmount: qty ? Math.round((amount / qty) * 100) / 100 : amount,
            amount
          });
        });
      } else if (partsBudget > 0) {
        lineItems.push({
          description: 'Additional parts',
          quantity: 1,
          unitAmount: partsBudget,
          amount: partsBudget
        });
      } else {
        for (const resv of reservations) {
          const part = resv.part as unknown as { name?: string; sku?: string; unitCost?: number } | null;
          const unit = Number(part?.unitCost || 0);
          const qty = Number(resv.quantity || 0);
          const amount = Math.round(unit * qty * 100) / 100;
          if (amount <= 0) continue;
          lineItems.push({
            description: part?.name ? `Replacement part: ${part.name}` : 'Replacement part',
            quantity: qty,
            unitAmount: unit,
            amount
          });
        }
      }

      for (const li of approved.lineItems || []) {
        lineItems.push({
          description: li.description || 'Additional service',
          quantity: 1,
          unitAmount: li.amount,
          amount: li.amount
        });
      }
    }

    if (!lineItems.length) {
      const fallback = Number(repair.finalCost || approved?.totalCost || 0);
      lineItems = [
        {
          description: repair.workPerformed || 'Repair services',
          quantity: 1,
          unitAmount: fallback,
          amount: fallback
        }
      ];
    }

    subtotal = lineItems.reduce((s, l) => s + l.amount, 0);
    const recordedFinal = Number(repair.finalCost || 0);
    if (recordedFinal > 0 && Math.abs(recordedFinal - subtotal) > 0.01) {
      const delta = Math.round((recordedFinal - subtotal) * 100) / 100;
      if (delta > 0) {
        lineItems.push({
          description: 'Additional service',
          quantity: 1,
          unitAmount: delta,
          amount: delta
        });
        subtotal = recordedFinal;
      } else {
        // Lower billed finalCost becomes a configured discount; never store negative line amounts.
        discountAmount = Math.abs(delta);
      }
    }
  }

  const taxRate = settings.taxRatePercent || 0;
  const taxable = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
  const taxAmount = Math.round(taxable * (taxRate / 100) * 100) / 100;
  const totalAmount = Math.round((taxable + taxAmount) * 100) / 100;
  const balanceDue = Math.max(0, Math.round((totalAmount - amountPaid) * 100) / 100);
  const payStatus =
    input.docType === 'invoice' || input.docType === 'payment_receipt'
      ? paymentStatus(totalAmount, amountPaid)
      : 'not_applicable';

  if (input.docType === 'payment_receipt' && payStatus === 'unpaid') {
    throw new AppError('Cannot issue payment receipt without recorded payment', 409, 'INVALID_STATE');
  }

  let paymentSnapshot = null;
  if (input.paymentId) {
    const payment = await PaymentRecord.findById(input.paymentId);
    if (!payment || payment.repairRequest.toString() !== repair._id.toString()) {
      throw new AppError('Payment not found', 404, 'NOT_FOUND');
    }
    assertShopAccess(input.user, payment.shop.toString());
    if (payment.entryType === 'reversal') {
      throw new AppError(
        'Payment receipts require a confirmed payment entry',
        409,
        'INVALID_PAYMENT'
      );
    }
    const reversedOf = payments
      .filter(
        (p) =>
          p.entryType === 'reversal' &&
          p.reversesPayment &&
          String(p.reversesPayment) === String(payment._id)
      )
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const remaining = Math.round((Number(payment.amount) - reversedOf) * 100) / 100;
    if (remaining <= 0.009 || payment.status === 'reversed') {
      throw new AppError(
        'Cannot issue a receipt for a fully reversed payment',
        409,
        'INVALID_PAYMENT'
      );
    }
    paymentSnapshot = { ...payment.toObject(), remainingRecognized: remaining };
  }

  const snapshot = {
    shop: {
      name: settings.businessLegalName || shop.name,
      address: shop.address,
      city: shop.city,
      phone: shop.phone,
      email: shop.email,
      logoUrl: settings.logoUrl,
      header: settings.receiptHeader,
      footer: settings.receiptFooter,
      contactExtra: settings.contactExtra
    },
    customer: {
      name: customer.name,
      phone: customer.phone,
      email: input.user.role === 'customer' ? customer.email : customer.email
    },
    repair: {
      referenceNumber: repair.referenceNumber,
      trackingToken: repair.trackingToken,
      deviceType: repair.deviceType,
      brand: repair.brand,
      model: repair.model,
      serialNumber: repair.serialNumber,
      accessories: repair.accessories,
      problemDescription: repair.problemDescription,
      workPerformed: repair.workPerformed,
      warrantyExpiresAt: repair.warrantyExpiresAt,
      status: repair.status,
      createdAt: repair.createdAt,
      completedAt: repair.completedAt
    },
    settings: {
      currency: settings.currency,
      taxLabel: settings.taxLabel,
      taxRatePercent: taxRate,
      warrantyTerms: settings.warrantyTerms,
      printLanguage: settings.printLanguage,
      defaultPrintFormat: settings.defaultPrintFormat
    },
    payment: paymentSnapshot,
    payments: payments.map((p) => ({
      amount: p.amount,
      method: p.method,
      reference: p.reference,
      paidAt: p.paidAt
    }))
  };

  // Retry on rare duplicate-number races (sequence allocated, insert lost race).
  let doc = null;
  let documentNumber = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    documentNumber = await nextDocumentNumber(shopId, input.docType);
    try {
      doc = await FinancialDocument.create({
        shop: shopId,
        repairRequest: repair._id,
        customer: repair.customer,
        docType: input.docType,
        documentNumber,
        issuedBy: input.user.id,
        currency: settings.currency,
        subtotal,
        taxRatePercent: taxRate,
        taxAmount,
        discountAmount,
        totalAmount,
        amountPaid,
        balanceDue,
        paymentStatus: payStatus,
        lineItems,
        snapshot
      });
      break;
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 11000 && attempt < 7) continue;
      throw err;
    }
  }
  if (!doc) throw new AppError('Failed to issue document', 500, 'SEQUENCE_ERROR');

  await writeAudit({
    actor: input.user.id,
    action: 'document.issue',
    entityType: 'FinancialDocument',
    entityId: doc._id,
    shop: shopId,
    details: { docType: input.docType, documentNumber }
  });

  return doc;
}

/**
 * Net recognized payments = sum(payment rows) − sum(reversal rows).
 * Original payment rows stay immutable; reversals never silently edit amounts.
 */
export function sumConfirmedPayments(
  payments: Array<{ amount: number; entryType?: string | null; status?: string | null }>
) {
  return payments.reduce((sum, p) => {
    const amt = Number(p.amount) || 0;
    if (p.entryType === 'reversal') return sum - amt;
    return sum + amt;
  }, 0);
}

async function resolveTotalDue(repair: {
  _id: unknown;
  finalCost?: number | null;
}, session?: ClientSession) {
  if (repair.finalCost != null && repair.finalCost >= 0) return Number(repair.finalCost);
  const estimates = await RepairEstimate.find({ repairRequest: repair._id })
    .sort({ version: -1 })
    .session(session || null);
  const approved = estimates.find((e) => e.status === 'approved');
  return Number(approved?.totalCost || 0);
}

async function bumpFinancialRevision(
  repairId: unknown,
  expectedRevision: number,
  session: ClientSession
) {
  const bumped = await RepairRequest.findOneAndUpdate(
    { _id: repairId, financialRevision: expectedRevision },
    { $inc: { financialRevision: 1 } },
    { session, new: true }
  );
  if (!bumped) {
    throw new AppError(
      'Outstanding balance changed — retry with the updated balance',
      409,
      'BALANCE_CHANGED'
    );
  }
  return bumped;
}

export async function getRepairPaymentSummary(repairId: string, session?: ClientSession) {
  const repair = await RepairRequest.findById(repairId).session(session || null);
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');

  const totalDue = await resolveTotalDue(repair, session);
  const payments = await PaymentRecord.find({ repairRequest: repair._id })
    .sort({ paidAt: 1 })
    .session(session || null);
  const amountPaid = Math.max(0, Math.round(sumConfirmedPayments(payments) * 100) / 100);
  const outstanding = Math.max(0, Math.round((totalDue - amountPaid) * 100) / 100);
  const status = paymentStatus(totalDue, amountPaid);

  const reversalsByOriginal = new Map<string, typeof payments>();
  for (const p of payments) {
    if (p.entryType !== 'reversal' || !p.reversesPayment) continue;
    const key = String(p.reversesPayment);
    const list = reversalsByOriginal.get(key) || [];
    list.push(p);
    reversalsByOriginal.set(key, list);
  }

  return {
    repairId: repair._id,
    totalDue,
    amountPaid,
    outstanding,
    status: status === 'partial' ? 'partially_paid' : status,
    currency: 'PKR',
    financialRevision: Number((repair as { financialRevision?: number }).financialRevision || 0),
    payments: payments.map((p) => {
      const linked = reversalsByOriginal.get(String(p._id)) || [];
      const reversedAmount =
        p.entryType === 'payment'
          ? Math.round(linked.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100
          : 0;
      const remainingReversible =
        p.entryType === 'payment'
          ? Math.max(0, Math.round((Number(p.amount) - reversedAmount) * 100) / 100)
          : 0;
      return {
        id: p._id,
        paymentNumber: p.paymentNumber || String(p._id),
        amount: p.amount,
        method: p.method,
        reference: p.reference || '',
        notes: p.notes || '',
        status: p.status || 'confirmed',
        entryType: p.entryType || 'payment',
        reversesPayment: p.reversesPayment || null,
        reversalReason: (p as { reversalReason?: string }).reversalReason || '',
        reversedAmount,
        remainingReversible,
        recordedBy: p.recordedBy,
        paidAt: p.paidAt,
        createdAt: (p as { createdAt?: Date }).createdAt
      };
    })
  };
}

function paymentNumber() {
  return `PAY-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

export async function recordPayment(input: {
  user: AuthUser;
  repairId: string;
  amount: number;
  method?: string;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
  confirmedReceived?: boolean;
}) {
  if (!['shop_admin', 'parts_coordinator'].includes(input.user.role)) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
  if (input.confirmedReceived === false) {
    throw new AppError(
      'Payment must be confirmed as received before recording',
      400,
      'CONFIRMATION_REQUIRED'
    );
  }
  if (input.amount <= 0) throw new AppError('Amount must be positive', 400, 'VALIDATION');

  const method = (input.method || 'cash') as PaymentMethod;
  const mobileMethods = new Set(['jazzcash', 'easypaisa', 'mobile_other', 'bank_transfer', 'card']);
  if (mobileMethods.has(method) && !String(input.reference || '').trim()) {
    if (method === 'jazzcash' || method === 'easypaisa') {
      throw new AppError(
        'Transaction/reference number is required for mobile wallet payments',
        400,
        'REFERENCE_REQUIRED'
      );
    }
  }

  const amount = Math.round(input.amount * 100) / 100;

  const payment = await withMongoTransaction(async (session) => {
    const repair = await RepairRequest.findById(input.repairId).session(session);
    if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
    const shopId = repair.shop.toString();
    assertShopAccess(input.user, shopId);
    if (repair.status === 'completed') {
      throw new AppError(
        'Cannot record payments on a closed repair — reopen the case first',
        409,
        'REPAIR_CLOSED'
      );
    }
    if (!repair.customer) {
      throw new AppError('Repair has no linked customer for payment records', 409, 'CUSTOMER_REQUIRED');
    }

    if (input.idempotencyKey) {
      const existing = await PaymentRecord.findOne({
        shop: shopId,
        idempotencyKey: input.idempotencyKey
      }).session(session);
      if (existing) return existing;
    }

    const totalDue = await resolveTotalDue(repair, session);
    const ledger = await PaymentRecord.find({ repairRequest: repair._id }).session(session);
    const amountPaid = Math.max(0, Math.round(sumConfirmedPayments(ledger) * 100) / 100);
    const outstanding = Math.max(0, Math.round((totalDue - amountPaid) * 100) / 100);
    if (amount - outstanding > 0.009) {
      throw new AppError(
        'Payment exceeds outstanding balance',
        409,
        'EXCEEDS_BALANCE',
        { outstanding, attempted: amount }
      );
    }

    const expectedRevision = Number(
      (repair as { financialRevision?: number }).financialRevision || 0
    );
    await bumpFinancialRevision(repair._id, expectedRevision, session);

    const created = await PaymentRecord.create(
      [
        {
          paymentNumber: paymentNumber(),
          shop: shopId,
          repairRequest: repair._id,
          customer: repair.customer,
          amount,
          method,
          reference: input.reference,
          notes: input.notes,
          recordedBy: input.user.id,
          paidAt: new Date(),
          status: 'confirmed',
          entryType: 'payment',
          idempotencyKey: input.idempotencyKey
        }
      ],
      { session }
    );
    const row = created[0];

    await writeAudit({
      actor: input.user.id,
      action: 'payment.record',
      entityType: 'PaymentRecord',
      entityId: row._id,
      shop: shopId,
      details: {
        amount: row.amount,
        method,
        paymentNumber: row.paymentNumber,
        outstandingAfter: Math.max(0, outstanding - row.amount),
        financialRevision: expectedRevision + 1
      },
      session
    });

    if (repair.customer) {
      await notify({
        user: repair.customer,
        type: 'payment_received',
        title: 'Payment received',
        message: `Payment of ${row.amount} PKR recorded for ${repair.referenceNumber}.`,
        repairRequest: repair._id,
        meta: { paymentId: row._id, amount: row.amount },
        dedupeKey: `payment_received:${row._id}`,
        session
      });
      await enqueueOutboxEvent({
        channel: 'repair_message',
        dedupeKey: `payment_message:${row._id}`,
        orderingKey: String(repair._id),
        sequence: 1,
        payload: {
          repairId: String(repair._id),
          actorId: input.user.id,
          body: `Payment of ${row.amount} PKR received via ${method}${
            row.reference ? ` (ref ${row.reference})` : ''
          }.`,
          messageType: 'payment',
          visibility: 'customer_visible'
        },
        session
      });
    }

    return row;
  });

  const { processOutboxBatch } = await import('./outbox.js');
  kickOutboxProcessor();
  await processOutboxBatch(10);
  return payment;
}

/**
 * Partial or full auditable reversal. Original payment amount is never mutated.
 * Net balance = payments − reversals; concurrency guarded by financialRevision.
 */
export async function reversePayment(input: {
  user: AuthUser;
  paymentId: string;
  reason: string;
  amount?: number;
  idempotencyKey?: string;
}) {
  if (input.user.role !== 'shop_admin') {
    throw new AppError('Only shop admins can reverse payments', 403, 'FORBIDDEN');
  }
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) {
    throw new AppError('Reversal reason required (min 5 characters)', 400, 'REASON_REQUIRED');
  }

  const reversal = await withMongoTransaction(async (session) => {
    const original = await PaymentRecord.findById(input.paymentId).session(session);
    if (!original) throw new AppError('Payment not found', 404, 'NOT_FOUND');
    assertShopAccess(input.user, original.shop.toString());
    if (original.entryType === 'reversal') {
      throw new AppError('Cannot reverse a reversal entry', 409, 'INVALID_STATE');
    }
    if (original.status === 'reversed') {
      throw new AppError('Payment already fully reversed', 409, 'ALREADY_REVERSED');
    }

    if (input.idempotencyKey) {
      const existing = await PaymentRecord.findOne({
        shop: original.shop,
        idempotencyKey: input.idempotencyKey
      }).session(session);
      if (existing) return existing;
    }

    const repair = await RepairRequest.findById(original.repairRequest).session(session);
    if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
    if (repair.status === 'completed') {
      throw new AppError('Cannot reverse payments on a closed repair', 409, 'REPAIR_CLOSED');
    }

    const priorReversals = await PaymentRecord.find({
      reversesPayment: original._id,
      entryType: 'reversal'
    }).session(session);
    const alreadyReversed = Math.round(
      priorReversals.reduce((s, r) => s + Number(r.amount || 0), 0) * 100
    ) / 100;
    const remaining = Math.max(
      0,
      Math.round((Number(original.amount) - alreadyReversed) * 100) / 100
    );
    if (remaining <= 0.009) {
      throw new AppError('Payment already fully reversed', 409, 'ALREADY_REVERSED');
    }

    const requested =
      input.amount == null
        ? remaining
        : Math.round(Number(input.amount) * 100) / 100;
    if (!(requested > 0)) {
      throw new AppError('Reversal amount must be positive', 400, 'VALIDATION');
    }
    if (requested - remaining > 0.009) {
      throw new AppError(
        'Reversal exceeds remaining reversible amount',
        409,
        'EXCEEDS_REVERSIBLE',
        { remainingReversible: remaining, attempted: requested }
      );
    }

    const expectedRevision = Number(
      (repair as { financialRevision?: number }).financialRevision || 0
    );
    await bumpFinancialRevision(repair._id, expectedRevision, session);

    const created = await PaymentRecord.create(
      [
        {
          paymentNumber: paymentNumber(),
          shop: original.shop,
          repairRequest: original.repairRequest,
          customer: original.customer,
          amount: requested,
          method: original.method,
          reference: original.reference,
          notes: `Reversal: ${reason}`,
          reversalReason: reason,
          recordedBy: input.user.id,
          paidAt: new Date(),
          status: 'confirmed',
          entryType: 'reversal',
          reversesPayment: original._id,
          idempotencyKey: input.idempotencyKey
        }
      ],
      { session }
    );
    const row = created[0];

    const newReversed = Math.round((alreadyReversed + requested) * 100) / 100;
    original.status =
      newReversed + 0.009 >= Number(original.amount) ? 'reversed' : 'partially_reversed';
    await original.save({ session });

    await writeAudit({
      actor: input.user.id,
      action: 'payment.reverse',
      entityType: 'PaymentRecord',
      entityId: row._id,
      shop: original.shop,
      details: {
        originalPaymentId: original._id,
        amount: requested,
        reason,
        remainingReversibleAfter: Math.max(0, Number(original.amount) - newReversed),
        financialRevision: expectedRevision + 1
      },
      session
    });

    await enqueueOutboxEvent({
      channel: 'repair_message',
      dedupeKey: `payment_reversal_message:${row._id}`,
      orderingKey: String(original.repairRequest),
      sequence: 1,
      payload: {
        repairId: String(original.repairRequest),
        actorId: input.user.id,
        body: `Payment reversal of ${requested} PKR recorded (${reason}).`,
        messageType: 'payment',
        visibility: 'customer_visible'
      },
      session
    });

    if (original.customer) {
      await notify({
        user: original.customer,
        type: 'payment_received',
        title: 'Payment reversal recorded',
        message: `A payment reversal of ${requested} PKR was recorded for your repair.`,
        repairRequest: original.repairRequest,
        meta: { reversalId: row._id, amount: requested, reason },
        dedupeKey: `payment_reversal:${row._id}`,
        session
      });
    }

    return row;
  });

  const { processOutboxBatch } = await import('./outbox.js');
  kickOutboxProcessor();
  await processOutboxBatch(10);
  return reversal;
}

export async function getDocumentForUser(user: AuthUser, documentId: string) {
  const doc = await FinancialDocument.findById(documentId);
  if (!doc || doc.status === 'void') throw new AppError('Not found', 404, 'NOT_FOUND');
  if (user.role === 'customer') {
    if (doc.customer.toString() !== user.id) throw new AppError('Forbidden', 403, 'FORBIDDEN');
  } else {
    assertShopAccess(user, doc.shop.toString());
  }
  return doc;
}

export async function listDocumentsForUser(
  user: AuthUser,
  opts: { repairId?: string; docType?: string }
) {
  const filter: Record<string, unknown> = { status: 'issued' };
  if (user.role === 'customer') filter.customer = user.id;
  else filter.shop = { $in: user.shopIds };
  if (opts.repairId) filter.repairRequest = opts.repairId;
  if (opts.docType) filter.docType = opts.docType;
  return FinancialDocument.find(filter).sort({ issuedAt: -1 }).limit(100);
}
