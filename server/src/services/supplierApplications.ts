import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {
  isApprovedSupplierApplicationStatus,
  isPendingSupplierApplicationStatus,
  SupplierApplication
} from '../models/SupplierApplication.js';
import { SupplierBusiness, User, Notification } from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import { revokeAllUserSessions } from './refreshSessions.js';
import { isPartCategoryId, type PartCategoryId } from '../constants/partCategories.js';

function publicApplicationId() {
  return `SPA-${crypto.randomBytes(8).toString('hex')}`;
}

function publicBusinessId() {
  return `SUP-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function normalizeCategories(input?: string[]): PartCategoryId[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((c): c is PartCategoryId => isPartCategoryId(c)))].slice(0, 12);
}

function normalizeList(input?: string[], max = 40) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((s) => String(s).trim()).filter(Boolean))].slice(0, max);
}

function normalizeDocs(
  input?: Array<{ name: string; dataUrl: string }>
): Array<{ name: string; dataUrl: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .map((d) => ({
      name: String(d.name || '').trim().slice(0, 160),
      dataUrl: String(d.dataUrl || '').trim().slice(0, 400_000)
    }))
    .filter((d) => d.name && d.dataUrl)
    .slice(0, 5);
}

function nextStepsFor(status: string) {
  if (isPendingSupplierApplicationStatus(status)) {
    return 'Your supplier application is under review. Sign in anytime to check status. Marketplace access is granted only after authorized approval.';
  }
  if (isApprovedSupplierApplicationStatus(status)) {
    return 'Your supplier account has been approved. Sign in to open the Supplier portal and manage your profile and catalog.';
  }
  if (status === 'rejected') {
    return 'This application was not approved. Review the remarks below or contact RepairConnect support.';
  }
  if (status === 'suspended') {
    return 'This supplier account is suspended and is hidden from marketplace search.';
  }
  if (status === 'cancelled') {
    return 'This application was cancelled.';
  }
  return 'Contact RepairConnect support for assistance with this application.';
}

async function notifyOwner(
  userId: mongoose.Types.ObjectId | string | null | undefined,
  type: string,
  title: string,
  message: string,
  meta?: Record<string, unknown>
) {
  if (!userId) return;
  try {
    await Notification.create({
      user: userId,
      type,
      title,
      message,
      meta
    });
  } catch {
    /* non-blocking */
  }
}

export async function registerSupplierApplication(input: {
  contactPerson: string;
  email: string;
  phone: string;
  password: string;
  businessName: string;
  address: string;
  city: string;
  region: string;
  description: string;
  partCategories?: string[];
  supportedBrands?: string[];
  deliveryCities?: string[];
  logoUrl?: string;
  verificationDocuments?: Array<{ name: string; dataUrl: string }>;
  termsAccepted: boolean;
  ip?: string;
}) {
  if (!input.termsAccepted) {
    throw new AppError('You must accept the Terms and Privacy Policy', 400, 'TERMS_REQUIRED');
  }

  const email = input.email.trim().toLowerCase();
  const businessName = input.businessName.trim();
  const city = input.city.trim();
  const partCategories = normalizeCategories(input.partCategories);
  if (!partCategories.length) {
    throw new AppError('Select at least one spare-part category', 400, 'CATEGORIES_REQUIRED');
  }

  const deliveryCities = normalizeList(input.deliveryCities, 40);
  if (!deliveryCities.length) {
    throw new AppError('Select at least one delivery coverage city', 400, 'DELIVERY_REQUIRED');
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new AppError('Email already registered', 409, 'DUPLICATE_EMAIL');
  }

  const pendingDup = await SupplierApplication.findOne({
    $or: [
      { businessEmail: email, status: 'pending_review' },
      {
        businessName: new RegExp(`^${businessName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        city: new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        status: { $in: ['pending_review', 'approved'] }
      }
    ]
  });
  if (pendingDup) {
    throw new AppError(
      'A supplier application already exists for this email or business in this city',
      409,
      'DUPLICATE_APPLICATION'
    );
  }

  const activeBusiness = await SupplierBusiness.findOne({
    $or: [
      { businessEmail: email },
      {
        businessName: new RegExp(`^${businessName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        city: new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      }
    ]
  });
  if (activeBusiness) {
    throw new AppError('A supplier business already exists with this email or name', 409, 'DUPLICATE_BUSINESS');
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const publicId = publicApplicationId();
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const [owner] = await User.create(
      [
        {
          email,
          passwordHash,
          name: input.contactPerson.trim(),
          phone: input.phone.trim(),
          role: 'supplier',
          accountStatus: 'pending_supplier',
          preferredLanguage: 'en',
          isActive: true
        }
      ],
      { session }
    );

    const [app] = await SupplierApplication.create(
      [
        {
          businessName,
          businessEmail: email,
          businessPhone: input.phone.trim(),
          contactPerson: input.contactPerson.trim(),
          ownerPhone: input.phone.trim(),
          address: input.address.trim(),
          city,
          region: input.region.trim(),
          description: input.description.trim(),
          partCategories,
          supportedBrands: normalizeList(input.supportedBrands),
          deliveryCities,
          logoUrl: String(input.logoUrl || '').trim().slice(0, 400_000),
          verificationDocuments: normalizeDocs(input.verificationDocuments),
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

    await writeAudit({
      actor: owner._id,
      action: 'supplier_application.register',
      entityType: 'SupplierApplication',
      entityId: app._id,
      details: { publicId, email, ip: input.ip }
    });

    return {
      id: publicId,
      status: 'pending_review' as const,
      businessName: app.businessName,
      submittedAt: app.createdAt,
      ownerId: owner._id,
      applicationId: app._id,
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

function serializeApplication(app: InstanceType<typeof SupplierApplication>) {
  return {
    id: app.publicId,
    status: app.status,
    businessName: app.businessName,
    businessEmail: app.businessEmail,
    businessPhone: app.businessPhone,
    contactPerson: app.contactPerson,
    address: app.address,
    city: app.city,
    region: app.region,
    description: app.description,
    partCategories: app.partCategories || [],
    supportedBrands: app.supportedBrands || [],
    deliveryCities: app.deliveryCities || [],
    logoUrl: app.logoUrl || '',
    verificationDocuments: (app.verificationDocuments || []).map((d) => ({
      name: d.name,
      hasData: Boolean(d.dataUrl)
    })),
    reviewRemarks: app.reviewRemarks || '',
    rejectionReason: app.rejectionReason || '',
    reviewedAt: app.reviewedAt || null,
    approvedAt: app.approvedAt || null,
    submittedAt: app.createdAt,
    nextSteps: nextStepsFor(app.status)
  };
}

export function serializeApplicationForOperator(app: InstanceType<typeof SupplierApplication>) {
  return {
    ...serializeApplication(app),
    ownerId: app.owner?.toString() || null,
    provisionedBusinessId: app.provisionedBusiness?.toString() || null,
    reviewedBy: app.reviewedBy?.toString() || null,
    verificationDocuments: (app.verificationDocuments || []).map((d) => ({
      name: d.name,
      dataUrl: d.dataUrl
    })),
    submittedIp: app.submittedIp || '',
    location: `${app.city}, ${app.region}`
  };
}

export async function getMySupplierApplication(ownerId: string) {
  const app = await SupplierApplication.findOne({ owner: ownerId }).sort({ createdAt: -1 });
  if (!app) return null;
  return serializeApplication(app);
}

export async function listSupplierApplicationsForOperator(input: {
  status: string;
  limit: number;
  skip: number;
}) {
  const filter: Record<string, unknown> = {};
  if (input.status === 'pending' || input.status === 'pending_review') {
    filter.status = 'pending_review';
  } else if (input.status === 'approved') {
    filter.status = 'approved';
  } else if (input.status === 'rejected') {
    filter.status = 'rejected';
  } else if (input.status === 'suspended') {
    filter.status = 'suspended';
  } else if (input.status !== 'all') {
    filter.status = 'pending_review';
  }

  const [items, total] = await Promise.all([
    SupplierApplication.find(filter).sort({ createdAt: -1 }).skip(input.skip).limit(input.limit),
    SupplierApplication.countDocuments(filter)
  ]);

  return {
    items: items.map((app) => ({
      id: app.publicId,
      status: app.status,
      ownerName: app.contactPerson,
      businessEmail: app.businessEmail,
      businessName: app.businessName,
      city: app.city,
      region: app.region,
      location: `${app.city}, ${app.region}`,
      partCategories: app.partCategories || [],
      submittedAt: app.createdAt
    })),
    total
  };
}

export async function getSupplierApplicationForOperator(publicId: string) {
  const app = await SupplierApplication.findOne({ publicId: String(publicId || '').trim() });
  if (!app) throw new AppError('Application not found', 404, 'NOT_FOUND');
  return serializeApplicationForOperator(app);
}

function assertNotSelfReview(app: InstanceType<typeof SupplierApplication>, reviewerId?: string) {
  if (reviewerId && app.owner && app.owner.toString() === reviewerId) {
    throw new AppError('Cannot review your own application', 403, 'SELF_REVIEW');
  }
}

export async function approveSupplierApplication(input: {
  publicId: string;
  actorLabel: string;
  remarks?: string;
  reviewerId?: string;
}) {
  const app = await SupplierApplication.findOne({ publicId: input.publicId.trim() });
  if (!app) throw new AppError('Application not found', 404, 'NOT_FOUND');
  assertNotSelfReview(app, input.reviewerId);
  if (isApprovedSupplierApplicationStatus(app.status)) {
    throw new AppError('Application already approved', 409, 'ALREADY_APPROVED');
  }
  if (app.status === 'rejected' || app.status === 'cancelled' || app.status === 'suspended') {
    throw new AppError('Rejected, cancelled, or suspended applications cannot be approved this way', 409, 'INVALID_STATE');
  }
  if (!isPendingSupplierApplicationStatus(app.status)) {
    throw new AppError('Application is not pending review', 409, 'INVALID_STATE');
  }
  if (!app.owner) {
    throw new AppError('Application has no linked owner account', 409, 'OWNER_REQUIRED');
  }
  if (app.provisionedBusiness) {
    throw new AppError('Business already provisioned for this application', 409, 'DUPLICATE_BUSINESS');
  }

  const owner = await User.findById(app.owner);
  if (!owner || !owner.isActive) {
    throw new AppError('Owner account missing or inactive', 409, 'OWNER_INVALID');
  }
  if (owner.role !== 'supplier') {
    throw new AppError('Owner account is not eligible for supplier provisioning', 409, 'OWNER_INVALID');
  }

  const existingBusiness = await SupplierBusiness.findOne({ owner: owner._id });
  if (existingBusiness) {
    throw new AppError('Owner already has a supplier business', 409, 'ALREADY_PROVISIONED');
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const [business] = await SupplierBusiness.create(
      [
        {
          publicId: publicBusinessId(),
          owner: owner._id,
          application: app._id,
          businessName: app.businessName,
          businessEmail: app.businessEmail,
          businessPhone: app.businessPhone,
          contactPerson: app.contactPerson,
          address: app.address,
          city: app.city,
          region: app.region,
          description: app.description,
          partCategories: app.partCategories || [],
          supportedBrands: app.supportedBrands || [],
          deliveryCities: app.deliveryCities || [],
          logoUrl: app.logoUrl || '',
          verificationDocuments: app.verificationDocuments || [],
          status: 'approved',
          isActive: true,
          verified: true,
          availability: 'available'
        }
      ],
      { session }
    );

    owner.accountStatus = 'active';
    await owner.save({ session });

    app.status = 'approved';
    app.provisionedBusiness = business._id;
    app.reviewRemarks = input.remarks || '';
    app.reviewedAt = new Date();
    app.approvedAt = new Date();
    if (input.reviewerId) {
      app.reviewedBy = new mongoose.Types.ObjectId(input.reviewerId);
    }
    await app.save({ session });

    await session.commitTransaction();

    await writeAudit({
      action: 'supplier_application.approve',
      entityType: 'SupplierApplication',
      entityId: app._id,
      actor: input.reviewerId || owner._id,
      details: {
        publicId: app.publicId,
        businessId: business._id,
        ownerId: owner._id,
        actorLabel: input.actorLabel,
        reviewerId: input.reviewerId || null,
        remarks: input.remarks || ''
      }
    });

    await notifyOwner(
      owner._id,
      'supplier_application.approved',
      'Supplier application approved',
      `Your supplier business "${app.businessName}" has been approved and is now visible in the marketplace.`,
      { publicId: app.publicId }
    );

    return {
      publicId: app.publicId,
      status: app.status,
      businessId: business._id,
      businessPublicId: business.publicId,
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

export async function rejectSupplierApplication(input: {
  publicId: string;
  actorLabel: string;
  reason: string;
  reviewerId?: string;
}) {
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) {
    throw new AppError('Rejection reason is required (min 5 characters)', 400, 'REASON_REQUIRED');
  }

  const app = await SupplierApplication.findOne({ publicId: input.publicId.trim() });
  if (!app) throw new AppError('Application not found', 404, 'NOT_FOUND');
  assertNotSelfReview(app, input.reviewerId);
  if (isApprovedSupplierApplicationStatus(app.status) && app.provisionedBusiness) {
    throw new AppError('Approved applications cannot be rejected — suspend instead', 409, 'INVALID_STATE');
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

  await writeAudit({
    action: 'supplier_application.reject',
    entityType: 'SupplierApplication',
    entityId: app._id,
    actor: input.reviewerId,
    details: {
      publicId: app.publicId,
      actorLabel: input.actorLabel,
      reviewerId: input.reviewerId || null,
      reason
    }
  });

  await notifyOwner(
    app.owner,
    'supplier_application.rejected',
    'Supplier application rejected',
    `Your supplier application was not approved. Reason: ${reason}`,
    { publicId: app.publicId }
  );

  return serializeApplication(app);
}

export async function suspendSupplierBusiness(input: {
  publicId: string;
  actorLabel: string;
  reason: string;
  reviewerId?: string;
}) {
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) {
    throw new AppError('Suspension reason is required (min 5 characters)', 400, 'REASON_REQUIRED');
  }

  const app = await SupplierApplication.findOne({ publicId: input.publicId.trim() });
  if (!app) throw new AppError('Application not found', 404, 'NOT_FOUND');
  if (!isApprovedSupplierApplicationStatus(app.status) && app.status !== 'suspended') {
    throw new AppError('Only approved suppliers can be suspended', 409, 'INVALID_STATE');
  }
  if (!app.provisionedBusiness) {
    throw new AppError('No provisioned supplier business to suspend', 409, 'NOT_PROVISIONED');
  }

  const business = await SupplierBusiness.findById(app.provisionedBusiness);
  if (!business) throw new AppError('Supplier business not found', 404, 'NOT_FOUND');

  business.isActive = false;
  business.status = 'suspended';
  business.suspendedAt = new Date();
  business.suspendReason = reason;
  await business.save();

  app.status = 'suspended';
  app.suspendedAt = new Date();
  app.reviewRemarks = reason;
  app.reviewedAt = new Date();
  if (input.reviewerId) {
    app.reviewedBy = new mongoose.Types.ObjectId(input.reviewerId);
  }
  await app.save();

  if (app.owner) {
    await revokeAllUserSessions(app.owner, 'supplier_suspended');
  }

  await writeAudit({
    action: 'supplier_application.suspend',
    entityType: 'SupplierApplication',
    entityId: app._id,
    actor: input.reviewerId,
    details: {
      publicId: app.publicId,
      businessId: business._id,
      actorLabel: input.actorLabel,
      reason
    }
  });

  await notifyOwner(
    app.owner,
    'supplier_application.suspended',
    'Supplier account suspended',
    `Your supplier business has been suspended and is hidden from marketplace search. Reason: ${reason}`,
    { publicId: app.publicId }
  );

  return serializeApplicationForOperator(app);
}

export async function reactivateSupplierBusiness(input: {
  publicId: string;
  actorLabel: string;
  remarks?: string;
  reviewerId?: string;
}) {
  const app = await SupplierApplication.findOne({ publicId: input.publicId.trim() });
  if (!app) throw new AppError('Application not found', 404, 'NOT_FOUND');
  if (app.status !== 'suspended') {
    throw new AppError('Only suspended suppliers can be reactivated', 409, 'INVALID_STATE');
  }
  if (!app.provisionedBusiness) {
    throw new AppError('No provisioned supplier business to reactivate', 409, 'NOT_PROVISIONED');
  }

  const business = await SupplierBusiness.findById(app.provisionedBusiness);
  if (!business) throw new AppError('Supplier business not found', 404, 'NOT_FOUND');

  business.isActive = true;
  business.status = 'approved';
  business.suspendedAt = undefined;
  business.suspendReason = '';
  await business.save();

  app.status = 'approved';
  app.suspendedAt = undefined;
  app.reviewRemarks = input.remarks || 'Reactivated';
  app.reviewedAt = new Date();
  if (input.reviewerId) {
    app.reviewedBy = new mongoose.Types.ObjectId(input.reviewerId);
  }
  await app.save();

  await writeAudit({
    action: 'supplier_application.reactivate',
    entityType: 'SupplierApplication',
    entityId: app._id,
    actor: input.reviewerId,
    details: {
      publicId: app.publicId,
      businessId: business._id,
      actorLabel: input.actorLabel,
      remarks: input.remarks || ''
    }
  });

  await notifyOwner(
    app.owner,
    'supplier_application.reactivated',
    'Supplier account reactivated',
    `Your supplier business "${app.businessName}" has been reactivated and is visible in the marketplace again.`,
    { publicId: app.publicId }
  );

  return serializeApplicationForOperator(app);
}

export async function listSupplierApplicationAudit(publicId: string) {
  const app = await SupplierApplication.findOne({ publicId: String(publicId || '').trim() });
  if (!app) throw new AppError('Application not found', 404, 'NOT_FOUND');
  const { AuditLog } = await import('../models/AuditLog.js');
  const logs = await AuditLog.find({
    entityType: 'SupplierApplication',
    entityId: app._id
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return logs.map((l) => ({
    id: String(l._id),
    action: l.action,
    details: l.details,
    actor: l.actor ? String(l.actor) : null,
    createdAt: (l as { createdAt?: Date }).createdAt || null
  }));
}
