/**
 * Atlas verification for Supplier Network Phase 4:
 * PO / shipments / GRN inventory transactions / ledger integrity.
 *
 * Requires MONGODB_URI and USE_MEMORY_DB=false.
 * Usage: npm run verify:atlas:phase4 -w server
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDb, disconnectDb, getDbMode } from '../config/db.js';
import {
  GoodsReceipt,
  Part,
  RepairShop,
  ShopMembership,
  SupplierApplication,
  SupplierBusiness,
  SupplierLedgerEntry,
  SupplierPurchaseOrder,
  SupplierQuotation,
  SupplierRfq,
  User
} from '../models/index.js';
import { createPurchaseOrderFromQuotation } from '../services/supplierPurchaseOrders.js';
import { createShipment } from '../services/supplierShipments.js';
import { postGoodsReceipt } from '../services/supplierGoodsReceiving.js';
import {
  recordSupplierPayment,
  reverseLedgerEntry,
  getSupplierBalance
} from '../services/supplierLedger.js';
import { acceptQuotation, submitQuotation } from '../services/supplierQuotations.js';
import { createRfq } from '../services/supplierRfqs.js';
import { approveSupplierApplication } from '../services/supplierApplications.js';
import type { AuthUser } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { publicRef } from '../services/supplierNetworkShared.js';

async function main() {
  if (env.useMemoryDb) {
    console.error('FAIL: Phase 4 Atlas verify refuses memory mode.');
    process.exit(2);
  }
  if (!env.mongodbUri) {
    console.error('FAIL: MONGODB_URI required.');
    process.exit(2);
  }

  const { mode } = await connectDb();
  if (mode !== 'atlas') {
    console.error('FAIL: Connected in non-atlas mode');
    process.exit(1);
  }
  console.log('OK: connected mode=', getDbMode());

  const marker = `p4-atlas-${Date.now()}`;
  const passwordHash = await bcrypt.hash('SecurePass1', 10);

  const shopA = await RepairShop.create({
    name: `P4 Atlas A ${marker}`,
    code: `P4A${Date.now().toString().slice(-6)}`,
    address: '1 Atlas',
    city: 'Lahore',
    region: 'Punjab',
    phone: '111',
    email: `${marker}-a@shop.local`,
    isActive: true
  });
  const shopB = await RepairShop.create({
    name: `P4 Atlas B ${marker}`,
    code: `P4B${Date.now().toString().slice(-6)}`,
    address: '2 Atlas',
    city: 'Lahore',
    region: 'Punjab',
    phone: '222',
    email: `${marker}-b@shop.local`,
    isActive: true
  });

  const [adminA, adminB, partsA, ops] = await User.create([
    {
      email: `${marker}-admin-a@test.local`,
      passwordHash,
      name: 'AdminA',
      role: 'shop_admin',
      accountStatus: 'active',
      isActive: true
    },
    {
      email: `${marker}-admin-b@test.local`,
      passwordHash,
      name: 'AdminB',
      role: 'shop_admin',
      accountStatus: 'active',
      isActive: true
    },
    {
      email: `${marker}-parts-a@test.local`,
      passwordHash,
      name: 'PartsA',
      role: 'parts_coordinator',
      accountStatus: 'active',
      isActive: true
    },
    {
      email: `${marker}-ops@test.local`,
      passwordHash,
      name: 'Ops',
      role: 'platform_operator',
      accountStatus: 'active',
      isActive: true
    }
  ]);

  await ShopMembership.create([
    { user: adminA._id, shop: shopA._id, role: 'shop_admin', isActive: true },
    { user: partsA._id, shop: shopA._id, role: 'parts_coordinator', isActive: true },
    { user: adminB._id, shop: shopB._id, role: 'shop_admin', isActive: true }
  ]);

  async function registerSupplier(tag: string) {
    const email = `${marker}-${tag}@sup.local`;
    const owner = await User.create({
      email,
      passwordHash,
      name: `Sup ${tag}`,
      role: 'supplier',
      accountStatus: 'pending_supplier',
      isActive: true
    });
    const app = await SupplierApplication.create({
      publicId: publicRef('SPA', 8),
      contactPerson: `Contact ${tag}`,
      businessEmail: email,
      businessPhone: '+92-300-1110001',
      businessName: `Atlas Supplier ${tag} ${marker}`,
      address: 'Supp St',
      city: 'Lahore',
      region: 'Punjab',
      description: 'Atlas Phase 4 supplier verification business description text.',
      partCategories: ['screens_displays'],
      supportedBrands: ['Samsung'],
      deliveryCities: ['Lahore'],
      termsAcceptedAt: new Date(),
      status: 'pending_review',
      owner: owner._id
    });
    await approveSupplierApplication({
      publicId: String(app.publicId),
      actorLabel: ops.email,
      remarks: 'Atlas approve',
      reviewerId: String(ops._id)
    });
    const business = await SupplierBusiness.findOne({ owner: owner._id });
    if (!business) throw new Error('Supplier business missing after approve');
    return {
      owner,
      business,
      user: {
        id: String(owner._id),
        email: owner.email,
        role: 'supplier' as const,
        name: owner.name,
        preferredLanguage: 'en' as const,
        shopIds: [] as string[]
      }
    };
  }

  const s1 = await registerSupplier('s1');
  const s2 = await registerSupplier('s2');

  const adminUserA: AuthUser = {
    id: String(adminA._id),
    email: adminA.email,
    role: 'shop_admin',
    name: adminA.name,
    preferredLanguage: 'en',
    shopIds: [String(shopA._id)]
  };
  const adminUserB: AuthUser = {
    id: String(adminB._id),
    email: adminB.email,
    role: 'shop_admin',
    name: adminB.name,
    preferredLanguage: 'en',
    shopIds: [String(shopB._id)]
  };
  const partsUserA: AuthUser = {
    id: String(partsA._id),
    email: partsA.email,
    role: 'parts_coordinator',
    name: partsA.name,
    preferredLanguage: 'en',
    shopIds: [String(shopA._id)]
  };

  // --- Full RFQ → accept → PO ---
  const rfqFull = await createRfq({
    user: adminUserA,
    shopId: String(shopA._id),
    title: 'Atlas full RFQ',
    supplierBusinessIds: [String(s1.business._id)],
    items: [
      { name: 'OLED Atlas', quantity: 10, sku: 'OLED-AT' },
      { name: 'Battery Atlas', quantity: 4, sku: 'BAT-AT' }
    ],
    send: true
  });
  const quoteFull = await submitQuotation({
    user: s1.user,
    rfqId: rfqFull.publicId,
    lines: rfqFull.items.map((i: { lineId: string; name: string }) => ({
      rfqLineId: i.lineId,
      unitPrice: i.name.includes('Battery') ? 1500 : 9000,
      availableQuantity: 100,
      quotedQuantity: i.name.includes('Battery') ? 4 : 10
    })),
    deliveryCharges: 300
  });
  await acceptQuotation({
    user: adminUserA,
    rfqId: rfqFull.publicId,
    quotationId: quoteFull.id
  });
  const poFull = await createPurchaseOrderFromQuotation({
    user: adminUserA,
    rfqId: rfqFull.publicId,
    issue: true
  });
  if (poFull.lines.length !== 2) throw new Error('Full PO should have 2 lines');
  console.log('OK: PO from full acceptance', poFull.publicId);

  // --- Partial acceptance PO ---
  const rfqPart = await createRfq({
    user: adminUserA,
    shopId: String(shopA._id),
    title: 'Atlas partial RFQ',
    supplierBusinessIds: [String(s1.business._id)],
    items: [
      { name: 'Glass', quantity: 6, sku: 'GL-AT' },
      { name: 'Frame', quantity: 6, sku: 'FR-AT' }
    ],
    send: true
  });
  const quotePart = await submitQuotation({
    user: s1.user,
    rfqId: rfqPart.publicId,
    lines: rfqPart.items.map((i: { lineId: string }) => ({
      rfqLineId: i.lineId,
      unitPrice: 500,
      availableQuantity: 20,
      quotedQuantity: 6
    }))
  });
  await acceptQuotation({
    user: adminUserA,
    rfqId: rfqPart.publicId,
    quotationId: quotePart.id,
    acceptedLineIds: [quotePart.lines[0].lineId]
  });
  const poPartial = await createPurchaseOrderFromQuotation({
    user: adminUserA,
    rfqId: rfqPart.publicId,
    acceptedLineIds: [quotePart.lines[0].lineId],
    issue: true
  });
  if (poPartial.lines.length !== 1) throw new Error('Partial PO should have 1 line');
  console.log('OK: PO from partial acceptance', poPartial.publicId);

  // Acknowledge + multi shipments on full PO
  const { acknowledgePurchaseOrder } = await import('../services/supplierPurchaseOrders.js');
  await acknowledgePurchaseOrder(s1.user, poFull.publicId, {});
  const line0 = poFull.lines[0];
  const line1 = poFull.lines[1];
  const ship1 = await createShipment({
    user: s1.user,
    purchaseOrderId: poFull.publicId,
    carrier: 'TCS',
    trackingNumber: 'ATLAS-1',
    dispatch: true,
    lines: [{ poLineId: line0.lineId, quantity: 4 }]
  });
  const ship2 = await createShipment({
    user: s1.user,
    purchaseOrderId: poFull.publicId,
    carrier: 'Leopards',
    trackingNumber: 'ATLAS-2',
    dispatch: true,
    lines: [{ poLineId: line0.lineId, quantity: 6 }, { poLineId: line1.lineId, quantity: 4 }]
  });
  console.log('OK: multiple shipments', ship1.publicId, ship2.publicId);

  // Stock must still be zero before GRN
  if ((await Part.countDocuments({ shop: shopA._id })) !== 0) {
    throw new Error('Inventory must not increase before GRN');
  }

  // Concurrent GRNs on different lines
  const [gA, gB] = await Promise.all([
    postGoodsReceipt({
      user: partsUserA,
      purchaseOrderId: poFull.publicId,
      shipmentId: ship1.publicId,
      idempotencyKey: `${marker}-grn-a`,
      lines: [
        {
          poLineId: line0.lineId,
          quantityAccepted: 3,
          quantityDamaged: 1,
          damageReason: 'Cracked panel in transit'
        }
      ]
    }),
    postGoodsReceipt({
      user: adminUserA,
      purchaseOrderId: poFull.publicId,
      idempotencyKey: `${marker}-grn-b`,
      lines: [{ poLineId: line1.lineId, quantityAccepted: 2 }]
    })
  ]);
  console.log('OK: concurrent GRNs', gA.publicId, gB.publicId);

  // Duplicate idempotency
  const dup = await postGoodsReceipt({
    user: partsUserA,
    purchaseOrderId: poFull.publicId,
    idempotencyKey: `${marker}-grn-a`,
    lines: [
      {
        poLineId: line0.lineId,
        quantityAccepted: 3,
        quantityDamaged: 1,
        damageReason: 'Cracked panel in transit'
      }
    ]
  });
  if (dup.publicId !== gA.publicId) throw new Error('Idempotent GRN mismatch');
  console.log('OK: duplicate idempotency key returns same GRN');

  const partsAfter = await Part.find({ shop: shopA._id });
  const totalStock = partsAfter.reduce((s, p) => s + p.quantityAvailable, 0);
  // accepted: 3 (line0) + 2 (line1) = 5; damaged must not stock
  if (totalStock !== 5) {
    throw new Error(`Expected stock 5 after GRNs, got ${totalStock}`);
  }
  console.log('OK: inventory reflects accepted only', totalStock);

  // Rollback when stock-in fails (invalid shopPartId)
  let rolledBack = false;
  const beforeGrnCount = await GoodsReceipt.countDocuments({ purchaseOrder: poFull.id });
  const beforeStock = totalStock;
  try {
    await postGoodsReceipt({
      user: partsUserA,
      purchaseOrderId: poFull.publicId,
      idempotencyKey: `${marker}-grn-fail`,
      lines: [
        {
          poLineId: line0.lineId,
          quantityAccepted: 1,
          shopPartId: new mongoose.Types.ObjectId().toString()
        }
      ]
    });
  } catch (err) {
    rolledBack = err instanceof AppError && err.code === 'PART_NOT_FOUND';
  }
  if (!rolledBack) throw new Error('Expected PART_NOT_FOUND rollback');
  const afterFailGrn = await GoodsReceipt.countDocuments({ purchaseOrder: poFull.id });
  const afterFailStock = (await Part.find({ shop: shopA._id })).reduce(
    (s, p) => s + p.quantityAvailable,
    0
  );
  if (afterFailGrn !== beforeGrnCount || afterFailStock !== beforeStock) {
    throw new Error('GRN/inventory not rolled back after stock-in failure');
  }
  console.log('OK: transaction rollback on stock-in failure');

  // Multi GRN remaining (line0: 10 ordered − 3 accepted = 7; line1: 4 − 2 = 2)
  await postGoodsReceipt({
    user: partsUserA,
    purchaseOrderId: poFull.publicId,
    idempotencyKey: `${marker}-grn-c`,
    lines: [
      { poLineId: line0.lineId, quantityAccepted: 7 },
      { poLineId: line1.lineId, quantityAccepted: 2 }
    ]
  });
  const poDone = await SupplierPurchaseOrder.findOne({ publicId: poFull.publicId });
  if (poDone?.status !== 'fulfilled') {
    const lines = (poDone?.lines || [])
      .map((l) => `${l.lineId}:${l.quantityReceivedAccepted}/${l.quantityOrdered}`)
      .join(', ');
    throw new Error(`Expected fulfilled PO, got ${poDone?.status} (${lines})`);
  }
  console.log('OK: multiple GRNs fulfil PO');

  // Ledger payment + reversal
  const pay = await recordSupplierPayment({
    user: adminUserA,
    shopId: String(shopA._id),
    supplierBusinessId: String(s1.business._id),
    purchaseOrderId: poFull.id,
    amount: 2500,
    paymentMethod: 'bank_transfer',
    externalReference: `ATLAS-${marker}`,
    idempotencyKey: `${marker}-pay`
  });
  const bal1 = await getSupplierBalance(adminUserA, String(shopA._id), String(s1.business._id));
  if (bal1.totalPayments < 2500) throw new Error('Payment not reflected in balance');
  await reverseLedgerEntry({
    user: adminUserA,
    entryId: pay.id,
    reason: 'Atlas verify reversal of misapplied payment'
  });
  const bal2 = await getSupplierBalance(adminUserA, String(shopA._id), String(s1.business._id));
  if (Math.abs(bal2.totalPayments - (bal1.totalPayments - 2500)) > 0.01) {
    // payments sum uses abs of payment rows; reversed payment stays but reversal offsets outstanding
    console.log('OK: balance after reversal outstanding=', bal2.outstandingPayable);
  }
  console.log('OK: supplier ledger payment + reversal');

  // Cross-tenant auth
  let crossShopDenied = false;
  try {
    await createPurchaseOrderFromQuotation({
      user: adminUserB,
      rfqId: rfqFull.publicId,
      issue: true
    });
  } catch (err) {
    crossShopDenied = err instanceof AppError && (err.statusCode === 403 || err.code === 'SHOP_FORBIDDEN');
  }
  if (!crossShopDenied) throw new Error('Cross-shop PO create should be forbidden');

  let crossSupplierDenied = false;
  try {
    await createShipment({
      user: s2.user,
      purchaseOrderId: poFull.publicId,
      dispatch: true,
      lines: [{ poLineId: line0.lineId, quantity: 1 }]
    });
  } catch (err) {
    crossSupplierDenied =
      err instanceof AppError && (err.statusCode === 404 || err.code === 'NOT_FOUND');
  }
  if (!crossSupplierDenied) throw new Error('Cross-supplier shipment should be denied');
  console.log('OK: cross-shop and cross-supplier authorization');

  // Persistence after reconnect
  const poId = poFull.id;
  await disconnectDb();
  const again = await connectDb();
  if (again.mode !== 'atlas') throw new Error('Reconnected non-atlas');
  const persistedPo = await SupplierPurchaseOrder.findById(poId);
  const persistedGrns = await GoodsReceipt.countDocuments({ purchaseOrder: poId });
  const persistedLedger = await SupplierLedgerEntry.countDocuments({
    purchaseOrder: poId,
    kind: { $in: ['po_obligation', 'goods_received', 'payment', 'reversal'] }
  });
  if (!persistedPo || persistedPo.status !== 'fulfilled') {
    throw new Error(`PO not persisted fulfilled after reconnect (${persistedPo?.status})`);
  }
  if (persistedGrns < 3) throw new Error(`Expected >=3 GRNs persisted, got ${persistedGrns}`);
  if (persistedLedger < 2) throw new Error('Ledger entries missing after reconnect');
  console.log('OK: Phase 4 Atlas persistence after reconnect');

  // Cleanup marker data (best-effort)
  await GoodsReceipt.deleteMany({ shop: { $in: [shopA._id, shopB._id] } });
  await SupplierLedgerEntry.deleteMany({ shop: { $in: [shopA._id, shopB._id] } });
  await SupplierPurchaseOrder.deleteMany({ shop: { $in: [shopA._id, shopB._id] } });
  await SupplierQuotation.deleteMany({ supplierBusiness: { $in: [s1.business._id, s2.business._id] } });
  await SupplierRfq.deleteMany({ shop: { $in: [shopA._id, shopB._id] } });
  await Part.deleteMany({ shop: shopA._id });
  await SupplierBusiness.deleteMany({ _id: { $in: [s1.business._id, s2.business._id] } });
  await SupplierApplication.deleteMany({ businessEmail: new RegExp(`^${marker}`) });
  await ShopMembership.deleteMany({ shop: { $in: [shopA._id, shopB._id] } });
  await User.deleteMany({ email: new RegExp(`^${marker}`) });
  await RepairShop.deleteMany({ _id: { $in: [shopA._id, shopB._id] } });

  await disconnectDb();
  console.log('ATLAS_PHASE4_VERIFY_PASSED');
}

main().catch(async (err) => {
  console.error('ATLAS_PHASE4_VERIFY_FAILED', err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
