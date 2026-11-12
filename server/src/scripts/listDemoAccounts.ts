/**
 * Inventory demo / seed accounts and related shops (read-only).
 *
 * Usage:
 *   npx tsx src/scripts/listDemoAccounts.ts
 *
 * Never deletes. Output is safe to paste into the cleanup plan.
 */
import { connectDb, disconnectDb } from '../config/db.js';
import { DEMO_ACCOUNT_EMAILS } from '../config/env.js';
import {
  Appointment,
  GoodsReceipt,
  Part,
  PaymentRecord,
  RepairRequest,
  RepairShop,
  ShopMembership,
  SupplierBusiness,
  SupplierCatalogItem,
  SupplierLedgerEntry,
  SupplierPurchaseOrder,
  SupplierReview,
  User
} from '../models/index.js';

const DEMO_EMAIL_RE = /@repairconnect\.local$/i;
const DEMO_SHOP_EMAILS = ['lhr@repairconnect.local', 'khi@repairconnect.local'];

async function main() {
  await connectDb();

  const users = await User.find({
    $or: [{ email: { $in: [...DEMO_ACCOUNT_EMAILS] } }, { email: DEMO_EMAIL_RE }]
  })
    .select('email role isActive accountStatus createdAt')
    .lean();

  const shops = await RepairShop.find({
    $or: [
      { email: { $in: DEMO_SHOP_EMAILS } },
      { email: DEMO_EMAIL_RE },
      { code: { $in: ['LHR01', 'KHI01', 'LHR1', 'KHI1'] } }
    ]
  })
    .select('name code email city isActive')
    .lean();

  const shopIds = shops.map((s) => s._id);
  const userIds = users.map((u) => u._id);

  const memberships = await ShopMembership.countDocuments({
    $or: [{ user: { $in: userIds } }, { shop: { $in: shopIds } }]
  });
  const repairs = await RepairRequest.countDocuments({
    $or: [{ customer: { $in: userIds } }, { shop: { $in: shopIds } }]
  });
  const parts = await Part.countDocuments({ shop: { $in: shopIds } });
  const appointments = await Appointment.countDocuments({
    $or: [{ customer: { $in: userIds } }, { shop: { $in: shopIds } }]
  });
  const payments = await PaymentRecord.countDocuments({ shop: { $in: shopIds } });

  const supplierUsers = users.filter((u) => u.role === 'supplier');
  const supplierUserIds = supplierUsers.map((u) => u._id);
  const supplierBusinesses = await SupplierBusiness.find({
    $or: [{ owner: { $in: supplierUserIds } }, { businessEmail: DEMO_EMAIL_RE }]
  })
    .select('businessName publicId businessEmail status owner')
    .lean();
  const supplierBizIds = supplierBusinesses.map((b) => b._id);
  // E2E-created suppliers (non-demo emails) linked via demo shops' purchasing activity
  const e2ePoCount = await SupplierPurchaseOrder.countDocuments({ shop: { $in: shopIds } });
  const e2eSupplierBizIds = await SupplierPurchaseOrder.distinct('supplierBusiness', {
    shop: { $in: shopIds }
  });

  const catalogItems = await SupplierCatalogItem.countDocuments({
    supplierBusiness: { $in: supplierBizIds }
  });
  const purchaseOrders = await SupplierPurchaseOrder.countDocuments({
    $or: [{ shop: { $in: shopIds } }, { supplierBusiness: { $in: supplierBizIds } }]
  });
  const goodsReceipts = await GoodsReceipt.countDocuments({
    $or: [{ shop: { $in: shopIds } }, { supplierBusiness: { $in: supplierBizIds } }]
  });
  const ledgerEntries = await SupplierLedgerEntry.countDocuments({
    $or: [{ shop: { $in: shopIds } }, { supplierBusiness: { $in: supplierBizIds } }]
  });
  const reviews = await SupplierReview.countDocuments({
    $or: [{ shop: { $in: shopIds } }, { supplierBusiness: { $in: supplierBizIds } }]
  });

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read-only-inventory',
    deleted: false,
    demoUsers: users.map((u) => ({
      id: String(u._id),
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      accountStatus: u.accountStatus || 'active'
    })),
    knownSeedEmails: [...DEMO_ACCOUNT_EMAILS],
    demoShops: shops.map((s) => ({
      id: String(s._id),
      name: s.name,
      code: s.code,
      email: s.email,
      city: s.city,
      isActive: s.isActive
    })),
    demoSuppliers: supplierBusinesses.map((b) => ({
      id: String(b._id),
      publicId: b.publicId,
      businessName: b.businessName,
      businessEmail: b.businessEmail,
      status: b.status,
      owner: b.owner ? String(b.owner) : null
    })),
    dependencyCounts: {
      memberships,
      repairs,
      parts,
      appointments,
      payments,
      demoSupplierCatalogItems: catalogItems,
      purchaseOrdersLinkedToDemoShopsOrSuppliers: purchaseOrders,
      goodsReceiptsLinkedToDemoShopsOrSuppliers: goodsReceipts,
      supplierLedgerEntriesLinkedToDemoShopsOrSuppliers: ledgerEntries,
      supplierReviewsLinkedToDemoShopsOrSuppliers: reviews,
      e2ePurchaseOrdersOnDemoShops: e2ePoCount,
      distinctSupplierBusinessesViaDemoShopPos: e2eSupplierBizIds.length
    },
    retentionNotes: [
      'Demo @repairconnect.local users share Password123! in docs/tests — rotate or delete before public URL.',
      'E2E also creates ephemeral *@example.com / *@repairconnect.test actors; review separately from seed cleanup.',
      'Financial records (payments, GRNs, ledger) on demo shops must be archived or wiped with explicit approval.'
    ],
    nextStep:
      'Review docs/DEMO_ACCOUNT_CLEANUP_PLAN.md. Deletion requires explicit approval and --confirm flag on the cleanup script.'
  };

  console.log(JSON.stringify(report, null, 2));
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[list-demo] FAIL', err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
