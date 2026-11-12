import { z } from 'zod';
import { strongPasswordSchema } from './password.js';
import {
  nullableDateTimeString,
  optionalDateTimeString,
  optionalFormString,
  requiredDateTimeString
} from './dateTime.js';

/** Public self-registration — customers only. Privileged roles are rejected. */
export const registerSchema = z.object({
  email: z.string().email(),
  password: strongPasswordSchema,
  name: z.string().min(2).max(120),
  role: z.literal('customer').default('customer'),
  phone: z.string().optional(),
  preferredLanguage: z.enum(['en', 'ur']).optional()
});

const staffRoles = ['mechanic', 'parts_coordinator', 'shop_admin'] as const;

/** Admin-only staff provisioning — never allows platform_operator or customer. */
export const createStaffSchema = z
  .object({
    email: z.string().email(),
    password: strongPasswordSchema,
    name: z.string().min(2).max(120),
    role: z.enum(staffRoles),
    shopId: z.string().min(1),
    phone: z.string().optional(),
    preferredLanguage: z.enum(['en', 'ur']).optional(),
    invite: z.boolean().optional()
  })
  .strict();

export const updateStaffSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    phone: z.string().max(40).optional(),
    role: z.enum(staffRoles).optional(),
    shopId: z.string().min(1).optional(),
    preferredLanguage: z.enum(['en', 'ur']).optional()
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const staffPasswordResetSchema = z
  .object({
    temporaryPassword: strongPasswordSchema.optional(),
    invite: z.boolean().optional()
  })
  .strict();

export const staffActiveSchema = z
  .object({
    isActive: z.boolean()
  })
  .strict();

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const languageSchema = z.object({
  preferredLanguage: z.enum(['en', 'ur'])
});

const photoInputSchema = z.object({
  // Allow ~350KB binary uploads after base64 expansion (~4/3) plus data-URL prefix.
  url: z.string().min(1).max(500_000),
  caption: z.string().max(200).optional(),
  kind: z.enum(['device', 'before', 'after', 'other']).optional(),
  visibility: z.enum(['customer', 'internal']).optional()
});

export const repairCreateSchema = z.object({
  shopId: z.string().min(1, 'Please select a repair shop'),
  deviceType: z.string().min(1, 'Device type is required').max(80),
  brand: z.string().min(1, 'Brand is required').max(80),
  model: z.string().min(1, 'Model is required').max(80),
  serialNumber: optionalFormString(120),
  accessories: optionalFormString(500),
  problemDescription: z
    .string()
    .min(5, 'Describe the problem in at least 5 characters')
    .max(2000),
  photos: z.array(photoInputSchema).max(5).optional(),
  appointmentAt: optionalDateTimeString,
  idempotencyKey: z.string().min(8).max(120).optional()
});

export const appointmentCreateSchema = z.object({
  shopId: z.string().min(1, 'Please select a repair shop'),
  startsAt: requiredDateTimeString,
  notes: optionalFormString(500),
  repairRequestId: z.string().optional()
});

export const appointmentRescheduleSchema = z.object({
  startsAt: requiredDateTimeString,
  notes: optionalFormString(500)
});

export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional()
});

export const mechanicUpdateSchema = z.object({
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  deadline: nullableDateTimeString,
  laborMinutes: z.number().int().min(0).optional(),
  customerNotes: z.string().max(2000).optional(),
  internalNotes: z.string().max(2000).optional(),
  diagnosisChecklist: z
    .array(z.object({ label: z.string().min(1), done: z.boolean(), visibility: z.enum(['customer', 'internal']).optional() }))
    .optional(),
  completionChecklist: z
    .array(z.object({ label: z.string().min(1), done: z.boolean(), visibility: z.enum(['customer', 'internal']).optional() }))
    .optional(),
  photos: z.array(photoInputSchema).max(8).optional()
});

export const supplierSchema = z.object({
  shopId: z.string().min(1),
  name: z.string().min(2).max(120),
  contactName: z.string().max(120).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  notes: z.string().max(500).optional()
});

export const restockSchema = z.object({
  partId: z.string().min(1),
  quantity: z.number().int().min(1),
  supplierId: z.string().optional(),
  notes: z.string().max(500).optional()
});

export const adjustStockSchema = z.object({
  quantityDelta: z.number().int(),
  reason: z.string().min(3).max(500)
});

export const transferCreateSchema = z.object({
  fromPartId: z.string().min(1),
  toShopId: z.string().min(1),
  quantity: z.number().int().min(1),
  reason: z.string().max(500).optional(),
  repairRequestId: z.string().optional(),
  partsRequestId: z.string().optional(),
  expectedArrivalDate: optionalDateTimeString,
  /** Only true when the date is verified — otherwise UI shows Unconfirmed. */
  expectedArrivalConfirmed: z.boolean().optional(),
  reserveOnReceive: z.boolean().optional()
});

export const collectSchema = z.object({
  notes: z.string().max(1000).optional(),
  caseSummary: z.string().max(4000).optional(),
  waiveOutstanding: z.boolean().optional(),
  waiveReason: z.string().max(2000).optional()
});

export const partsNotRequiredSchema = z.object({
  notes: z.string().max(500).optional()
});

export const shopSettingsSchema = z.object({
  dailyCapacity: z.number().int().min(1).max(200).optional(),
  slotMinutes: z.number().int().min(15).max(240).optional(),
  cancelPolicyHours: z.number().min(0).max(72).optional(),
  operatingHours: z.record(z.string(), z.object({
    open: z.string(),
    close: z.string(),
    closed: z.boolean().optional()
  })).optional()
});

export const notificationPrefsSchema = z.object({
  repairUpdates: z.boolean().optional(),
  estimateRequests: z.boolean().optional(),
  partsAlerts: z.boolean().optional(),
  appointmentReminders: z.boolean().optional()
});

export const profileUpdateSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    phone: z.string().max(40).optional(),
    avatarUrl: z.string().max(400_000).nullable().optional(),
    preferredLanguage: z.enum(['en', 'ur']).optional()
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No profile fields provided' });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128)
});

export const appearancePrefsSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    accent: z.enum(['indigo', 'blue', 'teal', 'violet', 'emerald']).optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
    fontScale: z.enum(['standard', 'large']).optional(),
    reducedMotion: z.boolean().optional(),
    highContrast: z.boolean().optional(),
    sidebarCollapsed: z.boolean().optional(),
    dashboardWidgets: z.array(z.string().min(1).max(40)).max(40).optional(),
    chartStyle: z.enum(['bar', 'line', 'donut']).optional()
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No preference fields provided' });

export const analyticsQuerySchema = z.object({
  range: z.enum(['7d', '30d', '90d', 'custom']).default('30d'),
  from: optionalDateTimeString,
  to: optionalDateTimeString,
  shopId: z.string().optional()
});

export const assignSchema = z.object({
  mechanicId: z.string().min(1),
  notes: z.string().max(500).optional()
});

export const diagnosisSchema = z.object({
  findings: z.string().min(5).max(2000),
  recommendedActions: z.string().min(5).max(2000),
  notes: z.string().max(1000).optional()
});

export const estimateSchema = z.object({
  laborCost: z.number().min(0),
  partsCost: z.number().min(0),
  lineItems: z
    .array(z.object({ description: z.string(), amount: z.number().min(0) }))
    .optional(),
  notes: z.string().max(1000).optional()
});

export const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(1000).optional()
});

export const partsRequestSchema = z.object({
  partId: z.string().min(1),
  quantity: z.number().int().min(1),
  notes: z.string().max(500).optional()
});

export const reserveSchema = z.object({
  quantity: z.number().int().min(1)
});

export const stockInSchema = z.object({
  quantity: z.number().int().min(1),
  notes: z.string().max(500).optional()
});

export const partCreateSchema = z.object({
  shopId: z.string().min(1),
  sku: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  category: z.string().max(80).optional(),
  quantityAvailable: z.number().int().min(0).default(0),
  reorderLevel: z.number().int().min(0).default(2),
  unitCost: z.number().min(0),
  supplier: z.string().max(120).optional(),
  supplierSku: z.string().max(80).optional()
});

export const partUpdateSchema = partCreateSchema.partial().omit({ shopId: true });

export const completeSchema = z.object({
  workPerformed: z.string().min(5).max(2000),
  finalCost: z.number().min(0),
  completionSummary: z.string().max(2000).optional()
});

export const shopCreateSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(20),
  address: z.string().min(5),
  city: z.string().min(2),
  phone: z.string().min(5),
  email: z.string().email().optional(),
  contactPerson: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  description: z.string().optional(),
  dailyCapacity: z.number().int().min(1).optional(),
  slotMinutes: z.number().int().min(15).optional(),
  cancelPolicyHours: z.number().min(0).optional(),
  serviceCategories: z
    .array(
      z.enum([
        'mobile_phones_tablets',
        'computers_laptops',
        'tvs_home_appliances',
        'gaming_consoles',
        'printers_office',
        'other_electronics'
      ])
    )
    .max(6)
    .optional(),
  supportedBrands: z.array(z.string().min(1).max(60)).max(40).optional(),
  supportedDevices: z.array(z.string().min(1).max(60)).max(40).optional(),
  showPhonePublic: z.boolean().optional(),
  showEmailPublic: z.boolean().optional()
});

export const forgotPasswordSchema = z.object({
  email: z.string().email()
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(128),
  newPassword: z.string().min(8).max(128)
});

export const repairMessageSchema = z.object({
  body: z.string().min(1).max(4000),
  visibility: z.enum(['customer_visible', 'internal']).optional(),
  messageType: z.enum(['general', 'status_update', 'estimate', 'payment', 'system']).optional(),
  attachments: z
    .array(
      z.object({
        url: z.string().min(1).max(400_000),
        caption: z.string().max(200).optional(),
        contentType: z.string().max(80).optional()
      })
    )
    .max(3)
    .optional()
});
