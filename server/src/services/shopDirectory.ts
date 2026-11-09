import mongoose from 'mongoose';
import { RepairRequest, RepairShop, ShopSettings } from '../models/index.js';
import {
  SERVICE_CATEGORIES,
  isServiceCategoryId,
  type ServiceCategoryId
} from '../constants/serviceCategories.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type HoursLike = { open?: string; close?: string; closed?: boolean } | null | undefined;

function readHours(operatingHours: unknown, dayKey: string): HoursLike {
  if (!operatingHours) return null;
  if (operatingHours instanceof Map) {
    return (operatingHours.get(dayKey) as HoursLike) || null;
  }
  if (typeof operatingHours === 'object') {
    return ((operatingHours as Record<string, HoursLike>)[dayKey] as HoursLike) || null;
  }
  return null;
}

export function isShopOpenNow(operatingHours: unknown, at = new Date()): boolean {
  const dayKey = DAY_KEYS[at.getDay()];
  const hours = readHours(operatingHours, dayKey);
  if (!hours || hours.closed) return false;
  const open = String(hours.open || '00:00');
  const close = String(hours.close || '00:00');
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  if ([oh, om, ch, cm].some((n) => Number.isNaN(n))) return false;
  const mins = at.getHours() * 60 + at.getMinutes();
  const openMins = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  if (closeMins <= openMins) return mins >= openMins || mins < closeMins;
  return mins >= openMins && mins < closeMins;
}

function serializeHours(operatingHours: unknown) {
  const out: Record<string, { open: string; close: string; closed: boolean }> = {};
  for (const key of DAY_KEYS) {
    const h = readHours(operatingHours, key);
    out[key] = {
      open: String(h?.open || '09:00'),
      close: String(h?.close || '18:00'),
      closed: Boolean(h?.closed)
    };
  }
  return out;
}

async function ratingMap(shopIds: string[]) {
  if (!shopIds.length) return new Map<string, { average: number; count: number }>();
  const rows = await RepairRequest.aggregate<{
    _id: { toString(): string };
    average: number;
    count: number;
  }>([
    {
      $match: {
        shop: { $in: shopIds.map((id) => new mongoose.Types.ObjectId(id)) },
        feedbackRating: { $gte: 1, $lte: 5 }
      }
    },
    {
      $group: {
        _id: '$shop',
        average: { $avg: '$feedbackRating' },
        count: { $sum: 1 }
      }
    }
  ]);
  const map = new Map<string, { average: number; count: number }>();
  for (const row of rows) {
    if (row.count > 0) {
      map.set(String(row._id), {
        average: Math.round(row.average * 10) / 10,
        count: row.count
      });
    }
  }
  return map;
}

async function logoMap(shopIds: string[]) {
  if (!shopIds.length) return new Map<string, string>();
  const settings = await ShopSettings.find({ shop: { $in: shopIds } })
    .select('shop logoUrl')
    .lean();
  const map = new Map<string, string>();
  for (const s of settings) {
    if (s.logoUrl) map.set(String(s.shop), s.logoUrl);
  }
  return map;
}

export type PublicShopCard = {
  _id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  region: string;
  description: string;
  phone?: string;
  email?: string;
  serviceCategories: ServiceCategoryId[];
  supportedBrands: string[];
  supportedDevices: string[];
  operatingHours: Record<string, { open: string; close: string; closed: boolean }>;
  isOpenNow: boolean;
  status: 'active' | 'inactive';
  logoUrl?: string;
  rating?: { average: number; count: number };
};

function toPublicCard(
  shop: Record<string, any>,
  logos: Map<string, string>,
  ratings: Map<string, { average: number; count: number }>
): PublicShopCard {
  const id = String(shop._id);
  const rating = ratings.get(id);
  const card: PublicShopCard = {
    _id: id,
    name: shop.name,
    code: shop.code,
    address: shop.address,
    city: shop.city,
    region: shop.region || '',
    description: shop.description || '',
    serviceCategories: (shop.serviceCategories || []).filter((c: string) => isServiceCategoryId(c)),
    supportedBrands: shop.supportedBrands || [],
    supportedDevices: shop.supportedDevices || [],
    operatingHours: serializeHours(shop.operatingHours),
    isOpenNow: isShopOpenNow(shop.operatingHours),
    status: shop.isActive === false ? 'inactive' : 'active'
  };
  if (shop.showPhonePublic !== false && shop.phone) card.phone = shop.phone;
  if (shop.showEmailPublic !== false && shop.email) card.email = shop.email;
  const logo = logos.get(id);
  if (logo) card.logoUrl = logo;
  if (rating && rating.count > 0) card.rating = rating;
  return card;
}

export type DirectoryQuery = {
  page?: number;
  limit?: number;
  q?: string;
  city?: string;
  category?: string;
  brand?: string;
  device?: string;
  openNow?: boolean;
  sort?: 'name' | 'city' | 'rating';
  ids?: string[];
};

export async function listPublicShops(query: DirectoryQuery) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const filter: Record<string, unknown> = { isActive: true };

  if (query.ids?.length) {
    filter._id = { $in: query.ids };
  }
  if (query.city) filter.city = new RegExp(String(query.city).trim(), 'i');
  if (query.category && isServiceCategoryId(query.category)) {
    filter.serviceCategories = query.category;
  }
  if (query.brand) {
    filter.supportedBrands = new RegExp(String(query.brand).trim(), 'i');
  }
  if (query.device) {
    filter.supportedDevices = new RegExp(String(query.device).trim(), 'i');
  }
  if (query.q) {
    const q = String(query.q).trim();
    filter.$or = [
      { name: new RegExp(q, 'i') },
      { city: new RegExp(q, 'i') },
      { description: new RegExp(q, 'i') },
      { supportedBrands: new RegExp(q, 'i') },
      { supportedDevices: new RegExp(q, 'i') }
    ];
  }

  const shops = await RepairShop.find(filter).sort({ name: 1 }).lean();
  let filtered = shops;
  if (query.openNow) {
    filtered = shops.filter((s) => isShopOpenNow(s.operatingHours));
  }

  const ids = filtered.map((s) => String(s._id));
  const [logos, ratings] = await Promise.all([logoMap(ids), ratingMap(ids)]);
  let cards = filtered.map((s) => toPublicCard(s as Record<string, any>, logos, ratings));

  const sort = query.sort || 'name';
  if (sort === 'city') {
    cards = cards.sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  } else if (sort === 'rating') {
    cards = cards.sort((a, b) => {
      const ar = a.rating?.average ?? -1;
      const br = b.rating?.average ?? -1;
      if (br !== ar) return br - ar;
      return (b.rating?.count ?? 0) - (a.rating?.count ?? 0);
    });
  } else {
    cards = cards.sort((a, b) => a.name.localeCompare(b.name));
  }

  const total = cards.length;
  const start = (page - 1) * limit;
  const items = cards.slice(start, start + limit);
  return { items, page, limit, total };
}

export async function getPublicShop(id: string) {
  const shop = await RepairShop.findOne({ _id: id, isActive: true }).lean();
  if (!shop) return null;
  const sid = String(shop._id);
  const [logos, ratings] = await Promise.all([logoMap([sid]), ratingMap([sid])]);
  return toPublicCard(shop as Record<string, any>, logos, ratings);
}

export async function listServiceCategoriesWithCounts() {
  const rows = await RepairShop.aggregate<{ _id: string; count: number }>([
    { $match: { isActive: true } },
    { $unwind: { path: '$serviceCategories', preserveNullAndEmptyArrays: false } },
    { $group: { _id: '$serviceCategories', count: { $sum: 1 } } }
  ]);
  const countById = new Map(rows.map((r) => [r._id, r.count]));
  return SERVICE_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    shopCount: countById.get(c.id) || 0
  }));
}

export async function listShopCities() {
  return RepairShop.distinct('city', { isActive: true }).then((cities) =>
    cities.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))
  );
}
