import mongoose from 'mongoose';
import {
  SupplierBusiness,
  SupplierCatalogItem,
  SupplierReview,
  RepairShop
} from '../models/index.js';
import { SUPPLIER_GENUINE_RATING_MIN_REVIEWS } from '../models/SupplierReview.js';
import { AppError } from '../utils/errors.js';
import { isPartCategoryId } from '../constants/partCategories.js';
import type { AuthUser } from '../middleware/auth.js';
import { serializeCatalogItem } from './supplierPortal.js';
import { performanceMap } from './supplierPerformance.js';
import {
  createVerifiedSupplierReview,
  listPublishedSupplierReviews
} from './supplierReviews.js';

const VISIBLE_REVIEW_STATUSES = ['published', 'reported', 'moderated'];

async function ratingMap(businessIds: mongoose.Types.ObjectId[]) {
  if (!businessIds.length) return new Map<string, { avg: number; count: number }>();
  const rows = await SupplierReview.aggregate<{
    _id: mongoose.Types.ObjectId;
    avg: number;
    count: number;
  }>([
    {
      $match: {
        supplierBusiness: { $in: businessIds },
        isGenuine: true,
        isVerified: true,
        status: { $in: VISIBLE_REVIEW_STATUSES }
      }
    },
    {
      $group: {
        _id: '$supplierBusiness',
        avg: { $avg: '$rating' },
        count: { $sum: 1 }
      }
    }
  ]);
  const map = new Map<string, { avg: number; count: number }>();
  for (const row of rows) {
    map.set(String(row._id), { avg: Math.round(row.avg * 10) / 10, count: row.count });
  }
  return map;
}

function withRating(
  business: InstanceType<typeof SupplierBusiness>,
  ratings: Map<string, { avg: number; count: number }>,
  performance?: Awaited<ReturnType<typeof performanceMap>> extends Map<string, infer V>
    ? V
    : never,
  includeContact = false
) {
  const rating = ratings.get(String(business._id));
  const genuineRating =
    rating && rating.count >= SUPPLIER_GENUINE_RATING_MIN_REVIEWS
      ? { average: rating.avg, count: rating.count }
      : null;
  const reviewSummary = {
    average: rating?.avg ?? null,
    count: rating?.count ?? 0,
    enoughData: Boolean(genuineRating),
    label: genuineRating
      ? `${genuineRating.average}★ (${genuineRating.count})`
      : (rating?.count || 0) === 0
        ? 'No verified reviews'
        : 'Not enough data'
  };

  const perf = performance;
  const fulfilment = perf?.fulfilmentRate;
  const onTime = perf?.onTimeDelivery;

  return {
    id: String(business._id),
    publicId: business.publicId,
    businessName: business.businessName,
    logoUrl: business.logoUrl || '',
    /** Platform verification badge — never imply performance from verification alone. */
    verified: Boolean(business.verified),
    verifiedBadge: Boolean(business.verified),
    city: business.city,
    region: business.region,
    description: business.description || '',
    partCategories: business.partCategories || [],
    supportedBrands: business.supportedBrands || [],
    deliveryCities: business.deliveryCities || [],
    availability: business.availability || 'available',
    genuineRating,
    reviewSummary,
    fulfilmentPerformance: fulfilment
      ? {
          value: fulfilment.value,
          sampleCount: fulfilment.sampleCount,
          enoughData: fulfilment.enoughData,
          label: fulfilment.label
        }
      : { value: null, sampleCount: 0, enoughData: false, label: 'Not enough data' },
    onTimeDeliveryPerformance: onTime
      ? {
          value: onTime.value,
          sampleCount: onTime.sampleCount,
          enoughData: onTime.enoughData,
          label: onTime.label
        }
      : { value: null, sampleCount: 0, enoughData: false, label: 'Not enough data' },
    pendingOverdueShipments: perf?.pendingOverdue
      ? {
          count: perf.pendingOverdue.count,
          sampleCount: perf.pendingOverdue.sampleCount,
          label: perf.pendingOverdue.label
        }
      : { count: 0, sampleCount: 0, label: 'No pending overdue shipments' },
    ...(includeContact
      ? {
          businessEmail: business.businessEmail,
          businessPhone: business.businessPhone,
          contactPerson: business.contactPerson,
          address: business.address
        }
      : {})
  };
}

function serializeMarketplaceProduct(
  item: InstanceType<typeof SupplierCatalogItem>,
  business: {
    publicId: string;
    businessName: string;
    logoUrl?: string;
    verified?: boolean;
    city: string;
    deliveryCities?: string[];
  }
) {
  const base = serializeCatalogItem(item);
  return {
    id: base.id,
    name: base.name,
    sku: base.sku,
    manufacturerPartNumber: base.manufacturerPartNumber,
    category: base.category,
    brand: base.brand,
    compatibleModels: base.compatibleModels,
    description: base.description,
    condition: base.condition,
    warranty: base.warranty,
    images: base.images.map((img) => ({ name: img.name, dataUrl: img.dataUrl })),
    unitPrice: base.unitPrice,
    currency: base.currency,
    quantityAvailable: base.quantityAvailable,
    minOrderQuantity: base.minOrderQuantity,
    leadTimeDays: base.leadTimeDays,
    stockStatus: base.stockStatus,
    unavailable: base.stockStatus === 'out_of_stock' || base.stockStatus === 'discontinued',
    discontinued: base.stockStatus === 'discontinued',
    supplier: {
      publicId: business.publicId,
      businessName: business.businessName,
      logoUrl: business.logoUrl || '',
      verified: Boolean(business.verified),
      city: business.city,
      deliveryCities: business.deliveryCities || []
    }
  };
}

export async function getShopDefaultCity(user: AuthUser): Promise<string> {
  const shopId = user.shopIds[0];
  if (!shopId) return '';
  const shop = await RepairShop.findById(shopId).select('city');
  return shop?.city || '';
}

async function approvedSuppliersForCity(city: string) {
  return SupplierBusiness.find({
    status: 'approved',
    isActive: true,
    deliveryCities: {
      $elemMatch: { $regex: new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    }
  }).select(
    '_id publicId businessName logoUrl verified city deliveryCities partCategories supportedBrands description region availability'
  );
}

export async function searchMarketplaceSuppliers(input: {
  user: AuthUser;
  city?: string;
  q?: string;
  category?: string;
  brand?: string;
  availability?: string;
  minRating?: number;
  minFulfilmentRate?: number;
  minOnTimeRate?: number;
  verifiedReviewsOnly?: boolean;
  sortBy?: 'name' | 'rating' | 'fulfilment' | 'onTime';
  limit?: number;
  skip?: number;
}) {
  const defaultCity = await getShopDefaultCity(input.user);
  const city = String(input.city || defaultCity || '').trim();
  if (!city) {
    throw new AppError('City is required for supplier discovery', 400, 'CITY_REQUIRED');
  }

  const filter: Record<string, unknown> = {
    status: 'approved',
    isActive: true,
    deliveryCities: {
      $elemMatch: { $regex: new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    }
  };

  if (input.category && isPartCategoryId(input.category)) {
    filter.partCategories = input.category;
  }
  if (input.brand) {
    filter.supportedBrands = {
      $elemMatch: {
        $regex: new RegExp(String(input.brand).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      }
    };
  }
  if (input.availability && ['available', 'limited', 'unavailable'].includes(input.availability)) {
    filter.availability = input.availability;
  }
  if (input.q) {
    const q = String(input.q).trim();
    filter.$or = [
      { businessName: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } }
    ];
  }

  // Pull a wider page then filter/sort in memory for performance metrics (server-side only).
  const fetchLimit = Math.min(Math.max((input.limit || 50) * 4, 50), 200);
  const businesses = await SupplierBusiness.find(filter).sort({ businessName: 1 }).limit(fetchLimit);
  const ratings = await ratingMap(businesses.map((b) => b._id));
  const perf = await performanceMap(businesses.map((b) => b._id));

  let items = businesses.map((b) => withRating(b, ratings, perf.get(String(b._id)), false));

  if (input.minRating !== undefined && !Number.isNaN(input.minRating)) {
    const min = Number(input.minRating);
    items = items.filter(
      (i) => i.genuineRating && i.genuineRating.average >= min
    );
  }
  if (input.minFulfilmentRate !== undefined && !Number.isNaN(input.minFulfilmentRate)) {
    const min = Number(input.minFulfilmentRate);
    items = items.filter(
      (i) => i.fulfilmentPerformance.enoughData && Number(i.fulfilmentPerformance.value) >= min
    );
  }
  if (input.minOnTimeRate !== undefined && !Number.isNaN(input.minOnTimeRate)) {
    const min = Number(input.minOnTimeRate);
    items = items.filter(
      (i) =>
        i.onTimeDeliveryPerformance.enoughData &&
        Number(i.onTimeDeliveryPerformance.value) >= min
    );
  }
  if (input.verifiedReviewsOnly) {
    items = items.filter((i) => Boolean(i.genuineRating));
  }

  const sortBy = input.sortBy || 'name';
  items.sort((a, b) => {
    if (sortBy === 'rating') {
      return (b.genuineRating?.average ?? -1) - (a.genuineRating?.average ?? -1);
    }
    if (sortBy === 'fulfilment') {
      return (Number(b.fulfilmentPerformance.value) || -1) - (Number(a.fulfilmentPerformance.value) || -1);
    }
    if (sortBy === 'onTime') {
      return (
        (Number(b.onTimeDeliveryPerformance.value) || -1) -
        (Number(a.onTimeDeliveryPerformance.value) || -1)
      );
    }
    return a.businessName.localeCompare(b.businessName);
  });

  const total = items.length;
  const skip = Math.max(input.skip || 0, 0);
  const limit = Math.min(Math.max(input.limit || 50, 1), 100);
  const page = items.slice(skip, skip + limit);

  return {
    city,
    defaultCity,
    total,
    items: page
  };
}

export async function searchMarketplaceProducts(input: {
  user: AuthUser;
  city?: string;
  q?: string;
  category?: string;
  brand?: string;
  availability?: string;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
  skip?: number;
}) {
  const defaultCity = await getShopDefaultCity(input.user);
  const city = String(input.city || defaultCity || '').trim();
  if (!city) {
    throw new AppError('City is required for product discovery', 400, 'CITY_REQUIRED');
  }

  const suppliers = await approvedSuppliersForCity(city);
  if (!suppliers.length) {
    return { city, defaultCity, total: 0, items: [] };
  }

  const supplierIds = suppliers.map((s) => s._id);
  const byId = new Map(suppliers.map((s) => [String(s._id), s]));

  const filter: Record<string, unknown> = {
    supplierBusiness: { $in: supplierIds },
    isActive: true,
    isArchived: { $ne: true }
  };

  if (input.category && isPartCategoryId(input.category)) filter.category = input.category;
  if (input.brand) {
    filter.brand = {
      $regex: new RegExp(String(input.brand).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    };
  }
  if (input.availability) {
    if (['in_stock', 'low_stock', 'out_of_stock', 'discontinued'].includes(input.availability)) {
      filter.stockStatus = input.availability;
    } else if (input.availability === 'available') {
      filter.stockStatus = { $in: ['in_stock', 'low_stock'] };
    } else if (input.availability === 'unavailable') {
      filter.stockStatus = { $in: ['out_of_stock', 'discontinued'] };
    }
  }
  if (input.minPrice !== undefined || input.maxPrice !== undefined) {
    const price: Record<string, number> = {};
    if (input.minPrice !== undefined && Number.isFinite(input.minPrice)) price.$gte = Number(input.minPrice);
    if (input.maxPrice !== undefined && Number.isFinite(input.maxPrice)) price.$lte = Number(input.maxPrice);
    if (Object.keys(price).length) filter.unitPrice = price;
  }
  if (input.q) {
    const q = String(input.q).trim();
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { sku: { $regex: q, $options: 'i' } },
      { manufacturerPartNumber: { $regex: q, $options: 'i' } },
      { brand: { $regex: q, $options: 'i' } }
    ];
  }

  const limit = Math.min(Math.max(input.limit || 50, 1), 100);
  const skip = Math.max(input.skip || 0, 0);

  const [items, total] = await Promise.all([
    SupplierCatalogItem.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    SupplierCatalogItem.countDocuments(filter)
  ]);

  return {
    city,
    defaultCity,
    total,
    items: items.map((item) => {
      const biz = byId.get(String(item.supplierBusiness));
      return serializeMarketplaceProduct(item, {
        publicId: biz?.publicId || '',
        businessName: biz?.businessName || 'Supplier',
        logoUrl: biz?.logoUrl || '',
        verified: biz?.verified,
        city: biz?.city || '',
        deliveryCities: biz?.deliveryCities || []
      });
    })
  };
}

export async function getMarketplaceSupplierProfile(input: {
  user: AuthUser;
  publicIdOrId: string;
  city?: string;
}) {
  const key = String(input.publicIdOrId || '').trim();
  const filter: Record<string, unknown> = {
    status: 'approved',
    isActive: true,
    $or: [{ publicId: key }]
  };
  if (mongoose.isValidObjectId(key)) {
    (filter.$or as object[]).push({ _id: key });
  }

  const business = await SupplierBusiness.findOne(filter);
  if (!business) throw new AppError('Supplier not found', 404, 'NOT_FOUND');

  if (input.city) {
    const city = input.city.trim();
    const serves = (business.deliveryCities || []).some(
      (c) => c.toLowerCase() === city.toLowerCase()
    );
    if (!serves) throw new AppError('Supplier does not serve this city', 404, 'NOT_FOUND');
  }

  const [ratings, catalog, perf, recentReviews] = await Promise.all([
    ratingMap([business._id]),
    SupplierCatalogItem.find({
      supplierBusiness: business._id,
      isActive: true,
      isArchived: { $ne: true }
    })
      .sort({ name: 1 })
      .limit(200),
    performanceMap([business._id]),
    listPublishedSupplierReviews({ publicIdOrId: String(business._id), limit: 10 })
  ]);

  const performance = perf.get(String(business._id));
  const base = withRating(business, ratings, performance, true);

  return {
    ...base,
    performance: performance
      ? {
          fulfilmentRate: performance.fulfilmentRate,
          onTimeDelivery: performance.onTimeDelivery,
          quotationResponseTime: performance.quotationResponseTime,
          cancellationRate: performance.cancellationRate,
          verifiedReviews: performance.verifiedReviews,
          trends: performance.trends,
          definitions: performance.definitions,
          thresholds: performance.thresholds
        }
      : null,
    recentReviews: recentReviews.items,
    reviewBreakdown: performance?.verifiedReviews?.categoryAverages || null,
    catalog: catalog.map((item) => {
      const serialized = serializeMarketplaceProduct(item, business);
      return {
        ...serialized,
        inStock: item.inStock
      };
    })
  };
}

/** @deprecated Prefer createVerifiedSupplierReview — kept as named export for routes. */
export async function createSupplierReview(input: {
  user: AuthUser;
  publicIdOrId: string;
  shopId: string;
  purchaseOrderId: string;
  categoryRatings: Record<string, unknown>;
  comment?: string;
}) {
  return createVerifiedSupplierReview(input);
}

export async function listMarketplaceFilterOptions(user: AuthUser) {
  const defaultCity = await getShopDefaultCity(user);
  const active = await SupplierBusiness.find({ status: 'approved', isActive: true })
    .select('city deliveryCities partCategories supportedBrands')
    .lean();

  const cities = new Set<string>();
  const brands = new Set<string>();
  const categories = new Set<string>();
  for (const row of active) {
    if (row.city) cities.add(row.city);
    for (const c of row.deliveryCities || []) cities.add(c);
    for (const b of row.supportedBrands || []) brands.add(b);
    for (const cat of row.partCategories || []) categories.add(cat);
  }

  return {
    defaultCity,
    cities: [...cities].sort(),
    brands: [...brands].sort(),
    categories: [...categories].sort()
  };
}
