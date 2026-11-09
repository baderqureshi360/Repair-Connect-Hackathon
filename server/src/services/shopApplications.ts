import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {
  isApprovedApplicationStatus,
  isPendingApplicationStatus,
  ShopApplication
} from '../models/ShopApplication.js';
import { RepairShop, ShopMembership, User } from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import { isServiceCategoryId, type ServiceCategoryId } from '../constants/serviceCategories.js';

function publicApplicationId() {
  return `SA-${crypto.randomBytes(8).toString('hex')}`;
}

function shopCodeFromName(shopName: string) {
  const base = shopName
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 6);
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${base || 'SHOP'}${suffix}`.slice(0, 20);
}

function normalizeCategories(input?: string[]): ServiceCategoryId[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((c): c is ServiceCategoryId => isServiceCategoryId(c)))].slice(
    0,
    6
  );
}

function normalizeList(input?: string[], max = 40) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((s) => String(s).trim()).filter(Boolean))].slice(0, max);
}

function nextStepsFor(status: string) {
  if (isPendingApplicationStatus(status)) {
    return 'Your application is under review. Sign in anytime to check status. Shop Admin access is granted only after authorized approval.';
  }
  if (isApprovedApplicationStatus(status)) {
    return 'Your shop has been approved. Sign in to open the Shop Admin portal and manage your shop.';
  }
  if (status === 'rejected') {
    return 'This application was not approved. Review the remarks below or contact RepairConnect support.';
  }
  if (status === 'cancelled') {
    return 'This application was cancelled.';
  }
  return 'Contact RepairConnect support for assistance with this application.';
}

export async function registerShopOwnerApplication(input: {
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  password: string;
  shopName: string;
  businessPhone: string;
  businessEmail: string;
  address: string;
  city: string;
  region: string;
  servicesDescription: string;
  serviceCategories?: string[];
  supportedDevices?: string[];
  supportedBrands?: string[];
  mechanicCount?: number;
  termsAccepted: boolean;
  ip?: string;
}) {
  if (!input.termsAccepted) {
    throw new AppError('You must accept the Terms and Privacy Policy', 400, 'TERMS_REQUIRED');
  }

  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const businessEmail = input.businessEmail.trim().toLowerCase();
  const serviceCategories = normalizeCategories(input.serviceCategories);
  if (!serviceCategories.length) {
    throw new AppError('Select at least one service category', 400, 'CATEGORIES_REQUIRED');
  }

  const existingUser = await User.findOne({ email: ownerEmail });
  if (existingUser) {
    throw new AppError('Email already registered', 409, 'DUPLICATE_EMAIL');
  }

  const pendingDup = await ShopApplication.findOne({
    $or: [{ businessEmail }, { businessEmail: ownerEmail }],
    status: { $in: ['pending', 'pending_review', 'contacted'] }
  });
  if (pendingDup) {
    throw new AppError(
      'A pending shop application already exists for this email',
      409,
      'DUPLICATE_APPLICATION'
    );
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const publicId = publicApplicationId();
  const session = await mongoose.startSession();

  let ownerId: mongoose.Types.ObjectId | undefined;
  let applicationId: mongoose.Types.ObjectId | undefined;

  try {
    session.startTransaction();

    const [owner] = await User.create(
      [
        {
          email: ownerEmail,
          passwordHash,
          name: input.ownerName.trim(),
          phone: input.ownerPhone.trim(),
          role: 'shop_admin',
          accountStatus: 'pending_shop_owner',
          preferredLanguage: 'en',
          isActive: true
        }
      ],
      { session }
    );

    const [app] = await ShopApplication.create(
      [
        {
          shopName: input.shopName.trim(),
          businessEmail,
          businessPhone: input.businessPhone.trim(),
          contactPerson: input.ownerName.trim(),
          ownerPhone: input.ownerPhone.trim(),
          phone: input.businessPhone.trim() || input.ownerPhone.trim(),
          address: input.address.trim(),
          city: input.city.trim(),
          region: input.region.trim(),
          mechanicCount: input.mechanicCount,
          servicesDescription: input.servicesDescription.trim(),
          serviceCategories,
          supportedDevices: normalizeList(input.supportedDevices),
          supportedBrands: normalizeList(input.supportedBrands),
          status: 'pending_review',
          publicId,
          owner: owner._id,
          termsAcceptedAt: new Date(),
          submittedIp: input.ip || ''
        }
      ],
      { session }
    );

    await session.commitTransaction();
    ownerId = owner._id;
    applicationId = app._id;

    await writeAudit({
      actor: owner._id,
      action: 'shop_application.register',
      entityType: 'ShopApplication',
      entityId: app._id,
      details: { publicId, email: ownerEmail, ip: input.ip }
    });

    return {
      id: publicId,
      status: 'pending_review' as const,
      shopName: app.shopName,
      submittedAt: app.createdAt,
      ownerId,
      applicationId,
      nextSteps: nextStepsFor('pending_review'),
      loginHint: 'Sign in with your email and password to track application status.'
    };
  } catch (err) {
    await session.abortTransaction().catch(() => undefined);
    throw err;
  } finally {
    session.endSession();
  }
}

/** Legacy public create without account — kept for historical compatibility; no credentials. */
export async function createShopApplication(input: {
  shopName: string;
  businessEmail: string;
  contactPerson: string;
  phone: string;
  address: string;
  city: string;
  region: string;
  mechanicCount?: number;
  servicesDescription: string;
  ip?: string;
}) {
  const email = input.businessEmail.trim().toLowerCase();
  const pendingDup = await ShopApplication.findOne({
    businessEmail: email,
    status: { $in: ['pending', 'pending_review', 'contacted'] }
  });
  if (pendingDup) {
    throw new AppError(
      'A pending shop application already exists for this email',
      409,
      'DUPLICATE_APPLICATION'
    );
  }

  const publicId = publicApplicationId();
  const app = await ShopApplication.create({
    shopName: input.shopName.trim(),
    businessEmail: email,
    contactPerson: input.contactPerson.trim(),
    phone: input.phone.trim(),
    businessPhone: input.phone.trim(),
    address: input.address.trim(),
    city: input.city.trim(),
    region: input.region.trim(),
    mechanicCount: input.mechanicCount,
    servicesDescription: input.servicesDescription.trim(),
    status: 'pending_review',
    publicId,
    submittedIp: input.ip || ''
  });

  await writeAudit({
    action: 'shop_application.create_legacy',
    entityType: 'ShopApplication',
    entityId: app._id,
    details: { publicId, email, ip: input.ip, note: 'No owner account created' }
  });

  return {
    id: app.publicId,
    status: app.status,
    shopName: app.shopName,
    submittedAt: app.createdAt,
    nextSteps:
      'Your repair shop application is pending review. Account credentials are not created from this legacy path. Use Register Your Repair Shop with a password, or ask an operator to run the secure claim process after verification.'
  };
}

export async function getShopApplicationStatus(publicId: string, email: string) {
  const app = await ShopApplication.findOne({ publicId: String(publicId || '').trim() });
  if (!app || app.businessEmail !== String(email || '').trim().toLowerCase()) {
    throw new AppError('Application not found', 404, 'NOT_FOUND');
  }
  return serializeApplication(app);
}

export async function getMyShopApplication(ownerId: string) {
  const app = await ShopApplication.findOne({ owner: ownerId }).sort({ createdAt: -1 });
  if (!app) throw new AppError('Application not found', 404, 'NOT_FOUND');
  return serializeApplication(app);
}

function serializeApplication(app: InstanceType<typeof ShopApplication>) {
  return {
    id: app.publicId,
    status: app.status,
    shopName: app.shopName,
    city: app.city,
    region: app.region,
    submittedAt: app.createdAt,
    updatedAt: app.updatedAt,
    reviewRemarks: app.reviewRemarks || '',
    rejectionReason: app.rejectionReason || '',
    reviewedAt: app.reviewedAt || null,
    approvedAt: app.approvedAt || null,
    hasOwnerAccount: Boolean(app.owner),
    nextSteps: nextStepsFor(app.status)
  };
}

/** Operator-facing serialization (includes PII needed for review). */
export function serializeApplicationForOperator(app: InstanceType<typeof ShopApplication>) {
  return {
    id: app.publicId,
    status: app.status,
    ownerName: app.contactPerson,
    ownerPhone: app.ownerPhone || '',
    businessEmail: app.businessEmail,
    businessPhone: app.businessPhone || app.phone,
    shopName: app.shopName,
    address: app.address,
    city: app.city,
    region: app.region,
    location: [app.city, app.region].filter(Boolean).join(', '),
    serviceCategories: app.serviceCategories || [],
    supportedDevices: app.supportedDevices || [],
    supportedBrands: app.supportedBrands || [],
    servicesDescription: app.servicesDescription,
    mechanicCount: app.mechanicCount ?? null,
    submittedAt: app.createdAt,
    updatedAt: app.updatedAt,
    reviewRemarks: app.reviewRemarks || '',
    rejectionReason: app.rejectionReason || '',
    reviewedBy: app.reviewedBy || null,
    reviewedAt: app.reviewedAt || null,
    approvedAt: app.approvedAt || null,
    provisionedShop: app.provisionedShop || null,
    hasOwnerAccount: Boolean(app.owner),
    ownerId: app.owner || null,
    nextSteps: nextStepsFor(app.status)
  };
}

const OPERATOR_STATUS_FILTERS = {
  pending: ['pending', 'pending_review', 'contacted'],
  pending_review: ['pending_review'],
  approved: ['approved', 'provisioned'],
  rejected: ['rejected'],
  cancelled: ['cancelled'],
  all: null as string[] | null
} as const;

export async function listShopApplicationsForOperator(input: {
  status?: string;
  limit?: number;
  skip?: number;
}) {
  const rawStatus = String(input.status || 'pending').trim().toLowerCase();
  const statusKey = (
    rawStatus in OPERATOR_STATUS_FILTERS ? rawStatus : 'pending'
  ) as keyof typeof OPERATOR_STATUS_FILTERS;
  const statuses = OPERATOR_STATUS_FILTERS[statusKey];
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const skip = Math.max(Number(input.skip) || 0, 0);

  const filter = statuses ? { status: { $in: statuses } } : {};
  const [items, total] = await Promise.all([
    ShopApplication.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ShopApplication.countDocuments(filter)
  ]);

  return {
    items: items.map(serializeApplicationForOperator),
    total,
    limit,
    skip,
    status: statusKey
  };
}

export async function getShopApplicationForOperator(publicId: string) {
  const app = await ShopApplication.findOne({ publicId: String(publicId || '').trim() });
  if (!app) throw new AppError('Application not found', 404, 'NOT_FOUND');
  return serializeApplicationForOperator(app);
}

function assertNotSelfReview(app: InstanceType<typeof ShopApplication>, reviewerId?: string) {
  if (!reviewerId || !app.owner) return;
  if (String(app.owner) === String(reviewerId)) {
    throw new AppError(
      'Applicants cannot approve or reject their own applications',
      403,
      'SELF_APPROVAL_FORBIDDEN'
    );
  }
}

export async function approveShopApplication(input: {
  publicId: string;
  actorLabel: string;
  remarks?: string;
  reviewerId?: string;
}) {
  const app = await ShopApplication.findOne({ publicId: input.publicId.trim() });
  if (!app) throw new AppError('Application not found', 404, 'NOT_FOUND');
  assertNotSelfReview(app, input.reviewerId);
  if (isApprovedApplicationStatus(app.status)) {
    throw new AppError('Application already approved', 409, 'ALREADY_APPROVED');
  }
  if (app.status === 'rejected' || app.status === 'cancelled') {
    throw new AppError('Rejected or cancelled applications cannot be approved', 409, 'INVALID_STATE');
  }
  if (!isPendingApplicationStatus(app.status)) {
    throw new AppError('Application is not pending review', 409, 'INVALID_STATE');
  }
  if (!app.owner) {
    throw new AppError(
      'Application has no linked owner account. Use the claim command after manual verification.',
      409,
      'OWNER_REQUIRED'
    );
  }
  if (app.provisionedShop) {
    throw new AppError('Shop already provisioned for this application', 409, 'DUPLICATE_SHOP');
  }

  const owner = await User.findById(app.owner);
  if (!owner || !owner.isActive) {
    throw new AppError('Owner account missing or inactive', 409, 'OWNER_INVALID');
  }
  if (owner.role !== 'shop_admin') {
    throw new AppError('Owner account is not eligible for shop admin membership', 409, 'OWNER_INVALID');
  }

  const existingMembership = await ShopMembership.findOne({
    user: owner._id,
    isActive: true
  });
  if (existingMembership) {
    throw new AppError('Owner already has an active shop membership', 409, 'ALREADY_MEMBER');
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    let code = shopCodeFromName(app.shopName);
    let shop;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        [shop] = await RepairShop.create(
          [
            {
              name: app.shopName,
              code,
              address: app.address,
              city: app.city,
              region: app.region,
              phone: app.businessPhone || app.phone,
              email: app.businessEmail,
              contactPerson: app.contactPerson,
              description: app.servicesDescription,
              serviceCategories: app.serviceCategories || [],
              supportedBrands: app.supportedBrands || [],
              supportedDevices: app.supportedDevices || [],
              isActive: true
            }
          ],
          { session }
        );
        break;
      } catch (err) {
        if ((err as { code?: number }).code === 11000 && attempt < 4) {
          code = shopCodeFromName(app.shopName);
          continue;
        }
        throw err;
      }
    }
    if (!shop) throw new AppError('Unable to create shop', 500, 'SHOP_CREATE_FAILED');

    await ShopMembership.create(
      [
        {
          user: owner._id,
          shop: shop._id,
          role: 'shop_admin',
          isActive: true
        }
      ],
      { session }
    );

    owner.accountStatus = 'active';
    await owner.save({ session });

    app.status = 'approved';
    app.provisionedShop = shop._id;
    app.reviewRemarks = input.remarks || '';
    app.reviewedAt = new Date();
    app.approvedAt = new Date();
    if (input.reviewerId) {
      app.reviewedBy = new mongoose.Types.ObjectId(input.reviewerId);
    }
    await app.save({ session });

    await session.commitTransaction();

    await writeAudit({
      action: 'shop_application.approve',
      entityType: 'ShopApplication',
      entityId: app._id,
      shop: shop._id,
      actor: input.reviewerId || owner._id,
      details: {
        publicId: app.publicId,
        shopId: shop._id,
        ownerId: owner._id,
        actorLabel: input.actorLabel,
        reviewerId: input.reviewerId || null,
        remarks: input.remarks || ''
      }
    });

    return {
      publicId: app.publicId,
      status: app.status,
      shopId: shop._id,
      shopCode: shop.code,
      ownerId: owner._id,
      ownerEmail: owner.email,
      reviewedBy: input.reviewerId || null,
      reviewedAt: app.reviewedAt
    };
  } catch (err) {
    await session.abortTransaction().catch(() => undefined);
    throw err;
  } finally {
    session.endSession();
  }
}

export async function rejectShopApplication(input: {
  publicId: string;
  actorLabel: string;
  reason: string;
  reviewerId?: string;
}) {
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) {
    throw new AppError('Rejection reason is required (min 5 characters)', 400, 'REASON_REQUIRED');
  }

  const app = await ShopApplication.findOne({ publicId: input.publicId.trim() });
  if (!app) throw new AppError('Application not found', 404, 'NOT_FOUND');
  assertNotSelfReview(app, input.reviewerId);
  if (isApprovedApplicationStatus(app.status)) {
    throw new AppError('Approved applications cannot be rejected', 409, 'INVALID_STATE');
  }
  if (app.status === 'rejected') {
    throw new AppError('Application already rejected', 409, 'ALREADY_REJECTED');
  }

  app.status = 'rejected';
  app.rejectionReason = reason;
  app.reviewRemarks = reason;
  app.reviewedAt = new Date();
  if (input.reviewerId) {
    app.reviewedBy = new mongoose.Types.ObjectId(input.reviewerId);
  }
  await app.save();

  if (app.owner) {
    const owner = await User.findById(app.owner);
    if (owner && owner.accountStatus === 'pending_shop_owner') {
      // Keep account for status viewing; still blocked from shop APIs (no membership).
      await owner.save();
    }
  }

  await writeAudit({
    action: 'shop_application.reject',
    entityType: 'ShopApplication',
    entityId: app._id,
    actor: input.reviewerId,
    details: {
      publicId: app.publicId,
      actorLabel: input.actorLabel,
      reviewerId: input.reviewerId || null,
      reason
    }
  });

  return serializeApplication(app);
}

/**
 * Manual claim after verifying a historical application belongs to a pending owner.
 * Never auto-claims from email match alone — operator must supply both IDs.
 */
export async function claimShopApplication(input: {
  publicId: string;
  ownerEmail: string;
  actorLabel: string;
}) {
  const app = await ShopApplication.findOne({ publicId: input.publicId.trim() });
  if (!app) throw new AppError('Application not found', 404, 'NOT_FOUND');
  if (app.owner) {
    throw new AppError('Application already linked to an owner', 409, 'ALREADY_CLAIMED');
  }
  if (!isPendingApplicationStatus(app.status)) {
    throw new AppError('Only pending applications can be claimed', 409, 'INVALID_STATE');
  }

  const email = input.ownerEmail.trim().toLowerCase();
  const owner = await User.findOne({ email });
  if (!owner) throw new AppError('Owner account not found', 404, 'OWNER_NOT_FOUND');
  if (owner.accountStatus !== 'pending_shop_owner' || owner.role !== 'shop_admin') {
    throw new AppError('Account is not a pending shop owner', 409, 'OWNER_INVALID');
  }
  // Manual claim still requires exact email match — never soft-match unverified addresses.
  if (app.businessEmail !== owner.email) {
    throw new AppError(
      'Owner email must match the application business email',
      409,
      'EMAIL_MISMATCH'
    );
  }

  const other = await ShopApplication.findOne({
    owner: owner._id,
    status: { $in: ['pending', 'pending_review', 'contacted', 'approved', 'provisioned'] }
  });
  if (other) {
    throw new AppError('Owner already linked to another application', 409, 'OWNER_BUSY');
  }

  app.owner = owner._id;
  app.contactPerson = app.contactPerson || owner.name;
  await app.save();

  await writeAudit({
    action: 'shop_application.claim',
    entityType: 'ShopApplication',
    entityId: app._id,
    actor: owner._id,
    details: { publicId: app.publicId, ownerEmail: email, actorLabel: input.actorLabel }
  });

  return serializeApplication(app);
}
