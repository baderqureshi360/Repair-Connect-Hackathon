import {
  FinancialDocument,
  Part,
  RepairRequest,
  User
} from '../models/index.js';
import type { AuthUser } from '../middleware/auth.js';
import { repairScopeFilter, toObjectId } from './access.js';

export async function globalSearch(user: AuthUser, q: string, limit = 8) {
  const query = q.trim();
  if (!query || query.length < 2) {
    return { repairs: [], customers: [], parts: [], documents: [] };
  }

  const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const repairFilter = repairScopeFilter(user);
  const shopIds = user.shopIds.map((id) => toObjectId(id));
  const canSeeInventory = user.role === 'parts_coordinator' || user.role === 'shop_admin';
  const canSeeCustomers = user.role === 'shop_admin';
  const canSeeDocuments = user.role === 'shop_admin' || user.role === 'customer';

  const repairsPromise = RepairRequest.find({
    ...repairFilter,
    $or: [
      { referenceNumber: rx },
      { brand: rx },
      { model: rx },
      { deviceType: rx },
      { problemDescription: rx },
      { serialNumber: rx }
    ]
  })
    .select('referenceNumber brand model status deviceType customer shop')
    .populate('customer', 'name')
    .sort({ updatedAt: -1 })
    .limit(limit);

  const partsPromise = canSeeInventory
    ? Part.find({
        shop: { $in: shopIds },
        isActive: true,
        $or: [{ sku: rx }, { name: rx }, { category: rx }]
      })
        .select('sku name quantityAvailable reorderLevel shop')
        .limit(limit)
    : Promise.resolve([]);

  const customersPromise = canSeeCustomers
    ? RepairRequest.aggregate([
        { $match: { shop: { $in: shopIds } } },
        { $group: { _id: '$customer' } },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        {
          $match: {
            $or: [{ 'user.name': rx }, { 'user.email': rx }, { 'user.phone': rx }]
          }
        },
        { $limit: limit },
        {
          $project: {
            _id: '$user._id',
            name: '$user.name',
            email: '$user.email',
            phone: '$user.phone'
          }
        }
      ])
    : Promise.resolve([]);

  const documentsPromise = canSeeDocuments
    ? FinancialDocument.find({
        ...(user.role === 'customer'
          ? { customer: toObjectId(user.id) }
          : { shop: { $in: shopIds } }),
        $or: [{ documentNumber: rx }, { docType: rx }]
      })
        .select('documentNumber docType status shop repairRequest')
        .sort({ createdAt: -1 })
        .limit(limit)
    : Promise.resolve([]);

  const [repairs, parts, customers, documents] = await Promise.all([
    repairsPromise,
    partsPromise,
    customersPromise,
    documentsPromise
  ]);

  return {
    repairs: repairs.map((r) => ({
      id: String(r._id),
      referenceNumber: r.referenceNumber,
      brand: r.brand,
      model: r.model,
      status: r.status,
      customerName: (r.customer as { name?: string } | null)?.name || null,
      href: `/app/repairs/${r._id}`
    })),
    parts: (parts as Array<{ _id: unknown; sku: string; name: string; quantityAvailable: number }>).map(
      (p) => ({
        id: String(p._id),
        sku: p.sku,
        name: p.name,
        quantityAvailable: p.quantityAvailable,
        href: `/app/parts/inventory?focus=${p._id}`
      })
    ),
    customers: (customers as Array<{ _id: unknown; name: string; email: string }>).map((c) => ({
      id: String(c._id),
      name: c.name,
      email: c.email,
      href: `/app/admin/customers?focus=${c._id}`
    })),
    documents: (
      documents as Array<{
        _id: unknown;
        documentNumber: string;
        docType: string;
        repairRequest?: unknown;
      }>
    ).map((d) => ({
      id: String(d._id),
      documentNumber: d.documentNumber,
      type: d.docType,
      href: `/app/admin/documents`
    }))
  };
}

/** Resolve a customer display name for staff dashboards without opening PII across shops. */
export async function customerDisplay(ids: string[]) {
  const users = await User.find({ _id: { $in: ids.map(toObjectId) } }).select('name email');
  return users.map((u) => ({ id: String(u._id), name: u.name, email: u.email }));
}
