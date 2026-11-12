import mongoose from 'mongoose';
import { SupplierBusiness, SupplierCatalogItem, SupplierStockMovement } from '../models/index.js';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  deriveStockStatus,
  SUPPLIER_PRODUCT_CONDITIONS,
  type SupplierProductCondition,
  type SupplierStockStatus
} from '../models/SupplierCatalogItem.js';
import type { SupplierStockAction } from '../models/SupplierStockMovement.js';
import { AppError } from '../utils/errors.js';
import { isPartCategoryId, type PartCategoryId } from '../constants/partCategories.js';
import { writeAudit } from './audit.js';

async function requireMyBusiness(ownerId: string, opts?: { allowSuspended?: boolean }) {
  const business = await SupplierBusiness.findOne({ owner: ownerId });
  if (!business) {
    throw new AppError('Supplier business not found. Application may still be pending.', 404, 'NOT_FOUND');
  }
  if (!opts?.allowSuspended && (business.status === 'suspended' || !business.isActive)) {
    throw new AppError('Supplier business is suspended', 403, 'SUSPENDED');
  }
  return business;
}

function serializeBusiness(business: InstanceType<typeof SupplierBusiness>) {
  return {
    id: String(business._id),
    publicId: business.publicId,
    businessName: business.businessName,
    businessEmail: business.businessEmail,
    businessPhone: business.businessPhone,
    contactPerson: business.contactPerson,
    address: business.address,
    city: business.city,
    region: business.region,
    description: business.description || '',
    partCategories: business.partCategories || [],
    supportedBrands: business.supportedBrands || [],
    deliveryCities: business.deliveryCities || [],
    logoUrl: business.logoUrl || '',
    status: business.status,
    isActive: business.isActive,
    verified: business.verified,
    availability: business.availability
  };
}

function normalizeList(input: unknown, max = 40): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((s) => String(s).trim()).filter(Boolean))].slice(0, max);
}

function normalizeImages(
  input?: Array<{ name?: string; dataUrl: string }>
): Array<{ name: string; dataUrl: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .map((img) => ({
      name: String(img.name || '').trim().slice(0, 160),
      dataUrl: String(img.dataUrl || '').trim().slice(0, 400_000)
    }))
    .filter((img) => img.dataUrl)
    .slice(0, 6);
}

function applyStockDerived(
  quantity: number,
  opts: { discontinued?: boolean; lowStockThreshold?: number }
) {
  const stockStatus = deriveStockStatus(quantity, opts);
  return {
    quantityAvailable: quantity,
    stockStatus,
    inStock: stockStatus === 'in_stock' || stockStatus === 'low_stock'
  };
}

export function serializeCatalogItem(item: InstanceType<typeof SupplierCatalogItem>) {
  return {
    id: String(item._id),
    name: item.name,
    sku: item.sku || '',
    manufacturerPartNumber: item.manufacturerPartNumber || '',
    category: item.category,
    brand: item.brand || '',
    compatibleModels: item.compatibleModels || [],
    description: item.description || '',
    condition: item.condition || 'new',
    warranty: item.warranty || '',
    images: (item.images || []).map((img) => ({
      name: img.name || '',
      dataUrl: img.dataUrl
    })),
    unitPrice: item.unitPrice,
    currency: item.currency || 'PKR',
    quantityAvailable: item.quantityAvailable ?? 0,
    minOrderQuantity: item.minOrderQuantity ?? 1,
    leadTimeDays: item.leadTimeDays ?? 0,
    lowStockThreshold: item.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
    stockStatus: item.stockStatus || 'out_of_stock',
    inStock: Boolean(item.inStock),
    isActive: Boolean(item.isActive),
    isArchived: Boolean(item.isArchived),
    archivedAt: item.archivedAt || null,
    stockVersion: item.stockVersion ?? 0,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  };
}

async function assertUniqueSku(
  supplierBusinessId: mongoose.Types.ObjectId,
  sku: string,
  excludeId?: string
) {
  const normalized = sku.trim();
  if (!normalized) return;
  const filter: Record<string, unknown> = {
    supplierBusiness: supplierBusinessId,
    sku: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const existing = await SupplierCatalogItem.findOne(filter).select('_id');
  if (existing) {
    throw new AppError('SKU already exists in your catalog', 409, 'DUPLICATE_SKU');
  }
}

export async function getMySupplierBusiness(ownerId: string) {
  const business = await requireMyBusiness(ownerId, { allowSuspended: true });
  return serializeBusiness(business);
}

export async function updateMySupplierBusiness(
  ownerId: string,
  input: {
    description?: string;
    businessPhone?: string;
    contactPerson?: string;
    address?: string;
    logoUrl?: string;
    supportedBrands?: string[];
    deliveryCities?: string[];
    partCategories?: string[];
    availability?: 'available' | 'limited' | 'unavailable';
  }
) {
  const business = await requireMyBusiness(ownerId);

  if (input.description !== undefined) business.description = String(input.description).trim().slice(0, 2000);
  if (input.businessPhone !== undefined) business.businessPhone = String(input.businessPhone).trim().slice(0, 40);
  if (input.contactPerson !== undefined) business.contactPerson = String(input.contactPerson).trim().slice(0, 120);
  if (input.address !== undefined) business.address = String(input.address).trim().slice(0, 300);
  if (input.logoUrl !== undefined) business.logoUrl = String(input.logoUrl).trim().slice(0, 400_000);
  if (input.availability) business.availability = input.availability;
  if (Array.isArray(input.supportedBrands)) {
    business.supportedBrands = normalizeList(input.supportedBrands);
  }
  if (Array.isArray(input.deliveryCities)) {
    const cities = normalizeList(input.deliveryCities);
    if (!cities.length) throw new AppError('At least one delivery city is required', 400, 'DELIVERY_REQUIRED');
    business.deliveryCities = cities;
  }
  if (Array.isArray(input.partCategories)) {
    const cats = [
      ...new Set(input.partCategories.filter((c): c is PartCategoryId => isPartCategoryId(c)))
    ].slice(0, 12);
    if (!cats.length) throw new AppError('Select at least one category', 400, 'CATEGORIES_REQUIRED');
    business.partCategories = cats;
  }

  await business.save();
  await writeAudit({
    actor: ownerId,
    action: 'supplier_business.update',
    entityType: 'SupplierBusiness',
    entityId: business._id,
    details: { publicId: business.publicId }
  });
  return serializeBusiness(business);
}

export async function listMyCatalog(
  ownerId: string,
  query: {
    q?: string;
    category?: string;
    stockStatus?: string;
    includeArchived?: boolean;
    sort?: string;
    limit?: number;
    skip?: number;
  } = {}
) {
  const business = await requireMyBusiness(ownerId, { allowSuspended: true });
  const filter: Record<string, unknown> = { supplierBusiness: business._id };
  if (!query.includeArchived) filter.isArchived = { $ne: true };
  if (query.category && isPartCategoryId(query.category)) filter.category = query.category;
  if (
    query.stockStatus &&
    ['in_stock', 'low_stock', 'out_of_stock', 'discontinued'].includes(query.stockStatus)
  ) {
    filter.stockStatus = query.stockStatus;
  }
  if (query.q) {
    const q = String(query.q).trim();
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { sku: { $regex: q, $options: 'i' } },
      { manufacturerPartNumber: { $regex: q, $options: 'i' } },
      { brand: { $regex: q, $options: 'i' } }
    ];
  }

  const sortKey = String(query.sort || 'name');
  const sort: Record<string, 1 | -1> =
    sortKey === 'price_asc'
      ? { unitPrice: 1 }
      : sortKey === 'price_desc'
        ? { unitPrice: -1 }
        : sortKey === 'qty'
          ? { quantityAvailable: -1 }
          : sortKey === 'updated'
            ? { updatedAt: -1 }
            : { name: 1 };

  const limit = Math.min(Math.max(query.limit || 50, 1), 100);
  const skip = Math.max(query.skip || 0, 0);

  const [items, total] = await Promise.all([
    SupplierCatalogItem.find(filter).sort(sort).skip(skip).limit(limit),
    SupplierCatalogItem.countDocuments(filter)
  ]);

  return {
    total,
    limit,
    skip,
    items: items.map(serializeCatalogItem)
  };
}

export async function getMyCatalogItem(ownerId: string, itemId: string) {
  const business = await requireMyBusiness(ownerId, { allowSuspended: true });
  const item = await SupplierCatalogItem.findOne({ _id: itemId, supplierBusiness: business._id });
  if (!item) throw new AppError('Catalog item not found', 404, 'NOT_FOUND');
  return serializeCatalogItem(item);
}

type CatalogWriteInput = {
  name: string;
  sku?: string;
  manufacturerPartNumber?: string;
  category: string;
  brand?: string;
  compatibleModels?: string[];
  description?: string;
  condition?: string;
  warranty?: string;
  images?: Array<{ name?: string; dataUrl: string }>;
  unitPrice?: number;
  currency?: string;
  quantityAvailable?: number;
  minOrderQuantity?: number;
  leadTimeDays?: number;
  lowStockThreshold?: number;
  discontinued?: boolean;
  isActive?: boolean;
};

export async function createCatalogItem(ownerId: string, input: CatalogWriteInput) {
  const business = await requireMyBusiness(ownerId);
  if (!isPartCategoryId(input.category)) {
    throw new AppError('Invalid category', 400, 'INVALID_CATEGORY');
  }
  const name = String(input.name).trim();
  if (name.length < 2) throw new AppError('Product name is required', 400, 'NAME_REQUIRED');
  const unitPrice = Number(input.unitPrice ?? 0);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new AppError('Price must be zero or greater', 400, 'INVALID_PRICE');
  }
  const quantity = Math.max(0, Math.floor(Number(input.quantityAvailable ?? 0)));
  const minOrderQuantity = Math.max(1, Math.floor(Number(input.minOrderQuantity ?? 1)));
  const lowStockThreshold = Math.max(
    0,
    Math.floor(Number(input.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD))
  );
  const sku = String(input.sku || '').trim().slice(0, 80);
  await assertUniqueSku(business._id, sku);

  const condition = (SUPPLIER_PRODUCT_CONDITIONS as readonly string[]).includes(String(input.condition || ''))
    ? (input.condition as SupplierProductCondition)
    : 'new';
  const derived = applyStockDerived(quantity, {
    discontinued: Boolean(input.discontinued),
    lowStockThreshold
  });

  const item = await SupplierCatalogItem.create({
    supplierBusiness: business._id,
    name: name.slice(0, 160),
    sku,
    manufacturerPartNumber: String(input.manufacturerPartNumber || '').trim().slice(0, 80),
    category: input.category,
    brand: String(input.brand || '').trim().slice(0, 80),
    compatibleModels: normalizeList(input.compatibleModels, 60),
    description: String(input.description || '').trim().slice(0, 4000),
    condition,
    warranty: String(input.warranty || '').trim().slice(0, 200),
    images: normalizeImages(input.images),
    unitPrice,
    currency: String(input.currency || 'PKR').trim().slice(0, 8) || 'PKR',
    ...derived,
    minOrderQuantity,
    leadTimeDays: Math.max(0, Math.min(365, Math.floor(Number(input.leadTimeDays ?? 0)))),
    lowStockThreshold,
    isActive: input.isActive !== false,
    isArchived: false,
    stockVersion: 0
  });

  if (quantity > 0) {
    await SupplierStockMovement.create({
      catalogItem: item._id,
      supplierBusiness: business._id,
      action: 'set',
      quantityDelta: quantity,
      quantityBefore: 0,
      quantityAfter: quantity,
      performedBy: ownerId,
      notes: 'Initial stock on create'
    });
  }

  await writeAudit({
    actor: ownerId,
    action: 'supplier_catalog.create',
    entityType: 'SupplierCatalogItem',
    entityId: item._id,
    details: { sku, name: item.name }
  });

  return serializeCatalogItem(item);
}

export async function updateCatalogItem(
  ownerId: string,
  itemId: string,
  input: Partial<CatalogWriteInput>
) {
  const business = await requireMyBusiness(ownerId);
  const item = await SupplierCatalogItem.findOne({ _id: itemId, supplierBusiness: business._id });
  if (!item) throw new AppError('Catalog item not found', 404, 'NOT_FOUND');
  if (item.isArchived) throw new AppError('Archived items cannot be edited', 409, 'ARCHIVED');

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (name.length < 2) throw new AppError('Product name is required', 400, 'NAME_REQUIRED');
    item.name = name.slice(0, 160);
  }
  if (input.sku !== undefined) {
    const sku = String(input.sku).trim().slice(0, 80);
    await assertUniqueSku(business._id, sku, String(item._id));
    item.sku = sku;
  }
  if (input.manufacturerPartNumber !== undefined) {
    item.manufacturerPartNumber = String(input.manufacturerPartNumber).trim().slice(0, 80);
  }
  if (input.category !== undefined) {
    if (!isPartCategoryId(input.category)) throw new AppError('Invalid category', 400, 'INVALID_CATEGORY');
    item.category = input.category;
  }
  if (input.brand !== undefined) item.brand = String(input.brand).trim().slice(0, 80);
  if (input.compatibleModels !== undefined) item.compatibleModels = normalizeList(input.compatibleModels, 60);
  if (input.description !== undefined) item.description = String(input.description).trim().slice(0, 4000);
  if (input.condition !== undefined) {
    if (!(SUPPLIER_PRODUCT_CONDITIONS as readonly string[]).includes(input.condition)) {
      throw new AppError('Invalid condition', 400, 'INVALID_CONDITION');
    }
    item.condition = input.condition as SupplierProductCondition;
  }
  if (input.warranty !== undefined) item.warranty = String(input.warranty).trim().slice(0, 200);
  if (input.images !== undefined) {
    item.set('images', normalizeImages(input.images));
  }
  if (input.unitPrice !== undefined) {
    const unitPrice = Number(input.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new AppError('Price must be zero or greater', 400, 'INVALID_PRICE');
    }
    item.unitPrice = unitPrice;
  }
  if (input.currency !== undefined) item.currency = String(input.currency).trim().slice(0, 8) || 'PKR';
  if (input.minOrderQuantity !== undefined) {
    item.minOrderQuantity = Math.max(1, Math.floor(Number(input.minOrderQuantity) || 1));
  }
  if (input.leadTimeDays !== undefined) {
    item.leadTimeDays = Math.max(0, Math.min(365, Math.floor(Number(input.leadTimeDays) || 0)));
  }
  if (input.lowStockThreshold !== undefined) {
    item.lowStockThreshold = Math.max(0, Math.floor(Number(input.lowStockThreshold) || 0));
  }
  if (input.isActive !== undefined) item.isActive = Boolean(input.isActive);

  const discontinued =
    input.discontinued === true ||
    (input.discontinued === false ? false : item.stockStatus === 'discontinued');
  const derived = applyStockDerived(item.quantityAvailable ?? 0, {
    discontinued,
    lowStockThreshold: item.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD
  });
  item.stockStatus = derived.stockStatus;
  item.inStock = derived.inStock;

  await item.save();
  await writeAudit({
    actor: ownerId,
    action: 'supplier_catalog.update',
    entityType: 'SupplierCatalogItem',
    entityId: item._id,
    details: { sku: item.sku, name: item.name }
  });
  return serializeCatalogItem(item);
}

export async function setCatalogItemActive(ownerId: string, itemId: string, isActive: boolean) {
  return updateCatalogItem(ownerId, itemId, { isActive });
}

export async function archiveCatalogItem(ownerId: string, itemId: string) {
  const business = await requireMyBusiness(ownerId);
  const item = await SupplierCatalogItem.findOne({ _id: itemId, supplierBusiness: business._id });
  if (!item) throw new AppError('Catalog item not found', 404, 'NOT_FOUND');
  if (item.isArchived) throw new AppError('Item already archived', 409, 'ALREADY_ARCHIVED');

  item.isArchived = true;
  item.isActive = false;
  item.archivedAt = new Date();
  await item.save();

  await writeAudit({
    actor: ownerId,
    action: 'supplier_catalog.archive',
    entityType: 'SupplierCatalogItem',
    entityId: item._id,
    details: { sku: item.sku, name: item.name }
  });
  return serializeCatalogItem(item);
}

/** Destructive hard delete — only for archived items. */
export async function deleteCatalogItem(ownerId: string, itemId: string) {
  const business = await requireMyBusiness(ownerId);
  const item = await SupplierCatalogItem.findOne({ _id: itemId, supplierBusiness: business._id });
  if (!item) throw new AppError('Catalog item not found', 404, 'NOT_FOUND');
  if (!item.isArchived) {
    throw new AppError('Archive the item before permanent deletion', 409, 'ARCHIVE_REQUIRED');
  }

  await SupplierStockMovement.deleteMany({ catalogItem: item._id });
  await item.deleteOne();

  await writeAudit({
    actor: ownerId,
    action: 'supplier_catalog.delete',
    entityType: 'SupplierCatalogItem',
    entityId: itemId,
    details: { sku: item.sku, name: item.name }
  });
  return { deleted: true, id: itemId };
}

export async function adjustCatalogStock(
  ownerId: string,
  itemId: string,
  input: {
    action: SupplierStockAction;
    quantity: number;
    expectedQuantity?: number;
    expectedVersion?: number;
    notes?: string;
    discontinued?: boolean;
  }
) {
  const business = await requireMyBusiness(ownerId);
  const item = await SupplierCatalogItem.findOne({ _id: itemId, supplierBusiness: business._id });
  if (!item) throw new AppError('Catalog item not found', 404, 'NOT_FOUND');
  if (item.isArchived) throw new AppError('Archived items cannot change stock', 409, 'ARCHIVED');

  const qty = Math.floor(Number(input.quantity));
  if (!Number.isFinite(qty) || qty < 0) {
    throw new AppError('Quantity must be a non-negative integer', 400, 'INVALID_QUANTITY');
  }

  const before = item.quantityAvailable ?? 0;
  if (input.expectedQuantity !== undefined && Number(input.expectedQuantity) !== before) {
    throw new AppError('Stock changed concurrently. Refresh and retry.', 409, 'STOCK_CONFLICT');
  }
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== (item.stockVersion ?? 0)) {
    throw new AppError('Stock changed concurrently. Refresh and retry.', 409, 'STOCK_CONFLICT');
  }

  let after = before;
  let delta = 0;
  switch (input.action) {
    case 'set':
      after = qty;
      delta = after - before;
      break;
    case 'receive':
    case 'release':
      if (qty <= 0) throw new AppError('Quantity must be greater than zero', 400, 'INVALID_QUANTITY');
      after = before + qty;
      delta = qty;
      break;
    case 'adjust':
      // signed adjust via quantity as absolute delta when notes say; here quantity is absolute target for adjust
      after = qty;
      delta = after - before;
      break;
    case 'reserve':
    case 'write_off':
      if (qty <= 0) throw new AppError('Quantity must be greater than zero', 400, 'INVALID_QUANTITY');
      if (before - qty < 0) {
        throw new AppError('Insufficient stock for this operation', 409, 'INSUFFICIENT_STOCK');
      }
      after = before - qty;
      delta = -qty;
      break;
    default:
      throw new AppError('Invalid stock action', 400, 'INVALID_ACTION');
  }

  if (after < 0) {
    throw new AppError('Stock cannot be negative', 409, 'NEGATIVE_STOCK');
  }

  const discontinued =
    input.discontinued === true ||
    (input.discontinued === false ? false : item.stockStatus === 'discontinued');
  const derived = applyStockDerived(after, {
    discontinued,
    lowStockThreshold: item.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD
  });

  const updated = await SupplierCatalogItem.findOneAndUpdate(
    {
      _id: item._id,
      supplierBusiness: business._id,
      quantityAvailable: before,
      stockVersion: item.stockVersion ?? 0
    },
    {
      $set: {
        quantityAvailable: derived.quantityAvailable,
        stockStatus: derived.stockStatus,
        inStock: derived.inStock
      },
      $inc: { stockVersion: 1 }
    },
    { new: true }
  );

  if (!updated) {
    throw new AppError('Stock changed concurrently. Refresh and retry.', 409, 'STOCK_CONFLICT');
  }

  const movement = await SupplierStockMovement.create({
    catalogItem: updated._id,
    supplierBusiness: business._id,
    action: input.action,
    quantityDelta: delta,
    quantityBefore: before,
    quantityAfter: after,
    performedBy: ownerId,
    notes: String(input.notes || '').trim().slice(0, 500)
  });

  await writeAudit({
    actor: ownerId,
    action: 'supplier_catalog.stock_adjust',
    entityType: 'SupplierCatalogItem',
    entityId: updated._id,
    details: {
      action: input.action,
      before,
      after,
      delta,
      movementId: movement._id
    }
  });

  return {
    item: serializeCatalogItem(updated),
    movement: {
      id: String(movement._id),
      action: movement.action,
      quantityDelta: movement.quantityDelta,
      quantityBefore: movement.quantityBefore,
      quantityAfter: movement.quantityAfter,
      notes: movement.notes || '',
      createdAt: movement.createdAt || null
    }
  };
}

export async function listStockMovements(ownerId: string, itemId: string, opts?: { limit?: number }) {
  const business = await requireMyBusiness(ownerId, { allowSuspended: true });
  const item = await SupplierCatalogItem.findOne({ _id: itemId, supplierBusiness: business._id }).select(
    '_id'
  );
  if (!item) throw new AppError('Catalog item not found', 404, 'NOT_FOUND');

  const limit = Math.min(Math.max(opts?.limit || 50, 1), 100);
  const rows = await SupplierStockMovement.find({
    catalogItem: item._id,
    supplierBusiness: business._id
  })
    .sort({ createdAt: -1 })
    .limit(limit);

  return rows.map((m) => ({
    id: String(m._id),
    action: m.action,
    quantityDelta: m.quantityDelta,
    quantityBefore: m.quantityBefore,
    quantityAfter: m.quantityAfter,
    performedBy: String(m.performedBy),
    notes: m.notes || '',
    createdAt: m.createdAt || null
  }));
}

export type { SupplierStockStatus };
