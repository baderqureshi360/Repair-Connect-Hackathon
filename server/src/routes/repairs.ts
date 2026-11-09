import { Router } from 'express';
import {
  Diagnosis,
  EstimateDecision,
  PartsRequest,
  RepairAssignment,
  RepairEstimate,
  RepairRequest,
  RepairStatusHistory
} from '../models/index.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  assignSchema,
  completeSchema,
  decisionSchema,
  diagnosisSchema,
  estimateSchema,
  feedbackSchema,
  mechanicUpdateSchema,
  partsRequestSchema,
  repairCreateSchema
} from '../validators/schemas.js';
import { ok, paginated } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import {
  addDiagnosis,
  assignMechanic,
  closeRepairCase,
  completeRepair,
  confirmCollection,
  confirmPartsNotRequired,
  createRepairRequest,
  decideEstimate,
  evaluateRepairReadiness,
  postCustomerStatusUpdate,
  regenerateTrackingCredentials,
  reopenRepairCase,
  requestParts,
  startRepairWork,
  submitEstimate
} from '../services/repairs.js';
import { collectSchema, partsNotRequiredSchema, repairMessageSchema } from '../validators/schemas.js';
import { getRepairPaymentSummary } from '../services/documents.js';
import { customerStatusPayload } from '../services/customerStatus.js';
import { listRepairMessages, postRepairMessage } from '../services/repairMessages.js';
import { listTrackingEventsForRepair } from '../services/trackingEvents.js';
import {
  assertCanMutateRepair,
  assertCanViewRepair,
  assertShopAccess,
  repairScopeFilter,
  repairStatsMatch,
  sanitizeRepairForViewer
} from '../services/access.js';

const router = Router();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const user = req.user!;
    const filter: Record<string, unknown> = { ...repairScopeFilter(user) };

    if (req.query.status) filter.status = req.query.status;
    if (req.query.shopId) {
      const shopId = String(req.query.shopId);
      assertShopAccess(user, shopId);
      // Narrow shop filter without widening role scope.
      if (user.role === 'mechanic') {
        filter.shop = shopId;
        filter.assignedMechanic = user.id;
      } else if (user.role !== 'customer') {
        filter.shop = shopId;
      }
    }
    if (req.query.search) {
      const q = String(req.query.search).trim();
      if (q) {
        filter.$or = [
          { referenceNumber: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { brand: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { model: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { deviceType: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
        ];
      }
    }

    const [items, total] = await Promise.all([
      RepairRequest.find(filter)
        .populate('shop', 'name code city')
        .populate('customer', 'name email phone')
        .populate('assignedMechanic', 'name email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      RepairRequest.countDocuments(filter)
    ]);

    // Optional batch payment summaries — avoids N+1 /payments calls from admin filters.
    if (String(req.query.includePayments || '') === '1' && items.length) {
      const { PaymentRecord } = await import('../models/index.js');
      const ids = items.map((r) => r._id);
      const paidRows = await PaymentRecord.aggregate<{
        _id: (typeof ids)[number];
        paid: number;
      }>([
        { $match: { repairRequest: { $in: ids } } },
        {
          $group: {
            _id: '$repairRequest',
            paid: {
              $sum: {
                $cond: [{ $eq: ['$entryType', 'reversal'] }, { $multiply: ['$amount', -1] }, '$amount']
              }
            }
          }
        }
      ]);
      const paidMap = new Map(paidRows.map((r) => [String(r._id), Math.max(0, r.paid || 0)]));
      const enriched = items.map((r) => {
        const obj = r.toObject({ virtuals: true }) as Record<string, unknown>;
        const totalDue = Number(r.finalCost || 0);
        const amountPaid = paidMap.get(String(r._id)) || 0;
        const outstanding = Math.max(0, Math.round((totalDue - amountPaid) * 100) / 100);
        let paymentStatus: string = 'not_applicable';
        if (totalDue > 0) {
          if (amountPaid <= 0) paymentStatus = 'unpaid';
          else if (outstanding <= 0.009) paymentStatus = 'paid';
          else paymentStatus = 'partially_paid';
        }
        obj.paymentSummary = { totalDue, amountPaid, outstanding, status: paymentStatus };
        return obj;
      });
      return paginated(res, enriched, { page, limit, total });
    }

    return paginated(res, items, { page, limit, total });
  } catch (err) {
    next(err);
  }
});

router.get('/stats/summary', async (req, res, next) => {
  try {
    const user = req.user!;
    const match = repairStatsMatch(user);

    const rows = await RepairRequest.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    const total = rows.reduce((s, r) => s + r.count, 0);
    return ok(res, {
      total,
      active: total - (byStatus.completed || 0) - (byStatus.cancelled || 0),
      completed: byStatus.completed || 0,
      pendingApprovals: byStatus.estimate_pending || 0,
      awaitingParts: byStatus.awaiting_parts || 0,
      byStatus
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const repair = await RepairRequest.findById(req.params.id)
      .populate('shop', 'name code city address phone')
      .populate('customer', 'name email phone')
      .populate('assignedMechanic', 'name email');
    if (!repair) throw new AppError('Not found', 404, 'NOT_FOUND');

    const user = req.user!;
    assertCanViewRepair(user, repair);

    const [history, diagnoses, estimates, decisions, assignment, partsRequests, readiness, paymentSummary] =
      await Promise.all([
        RepairStatusHistory.find({ repairRequest: repair._id }).sort({ changedAt: 1 }),
        Diagnosis.find({ repairRequest: repair._id }).sort({ createdAt: -1 }),
        RepairEstimate.find({ repairRequest: repair._id }).sort({ version: -1 }),
        EstimateDecision.find({ repairRequest: repair._id }).sort({ decidedAt: -1 }),
        RepairAssignment.findOne({ repairRequest: repair._id }),
        PartsRequest.find({ repairRequest: repair._id }).populate('part', 'sku name'),
        evaluateRepairReadiness(repair._id),
        getRepairPaymentSummary(String(repair._id))
      ]);

    const repairObj = sanitizeRepairForViewer(
      user,
      repair.toObject({ virtuals: true }) as Record<string, unknown>
    );

    const lang = user.preferredLanguage === 'ur' ? 'ur' : 'en';
    return ok(res, {
      repair: repairObj,
      customerStatus: customerStatusPayload(repair, lang),
      history,
      diagnoses,
      estimates,
      decisions,
      assignment,
      partsRequests,
      readiness,
      paymentSummary
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRoles('customer'), validate(repairCreateSchema), async (req, res, next) => {
  try {
    const repair = await createRepairRequest({
      customerId: req.user!.id,
      shopId: req.body.shopId,
      deviceType: req.body.deviceType,
      brand: req.body.brand,
      model: req.body.model,
      serialNumber: req.body.serialNumber,
      accessories: req.body.accessories,
      photos: req.body.photos,
      appointmentAt: req.body.appointmentAt,
      problemDescription: req.body.problemDescription,
      idempotencyKey: req.body.idempotencyKey || (req.headers['idempotency-key'] as string)
    });
    return ok(res, repair, 201);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/assign',
  requireRoles('shop_admin'),
  validate(assignSchema),
  async (req, res, next) => {
    try {
      const assignment = await assignMechanic({
        repairId: String(req.params.id),
        mechanicId: req.body.mechanicId,
        admin: req.user!,
        notes: req.body.notes
      });
      return ok(res, assignment);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/diagnosis',
  requireRoles('mechanic', 'shop_admin'),
  validate(diagnosisSchema),
  async (req, res, next) => {
    try {
      const diagnosis = await addDiagnosis({
        repairId: String(req.params.id),
        mechanic: req.user!,
        findings: req.body.findings,
        recommendedActions: req.body.recommendedActions,
        notes: req.body.notes
      });
      return ok(res, diagnosis, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/estimates',
  requireRoles('mechanic', 'shop_admin'),
  validate(estimateSchema),
  async (req, res, next) => {
    try {
      const estimate = await submitEstimate({
        repairId: String(req.params.id),
        mechanic: req.user!,
        laborCost: req.body.laborCost,
        partsCost: req.body.partsCost,
        lineItems: req.body.lineItems,
        notes: req.body.notes
      });
      return ok(res, estimate, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/estimates/:estimateId/decision',
  requireRoles('customer'),
  validate(decisionSchema),
  async (req, res, next) => {
    try {
      const result = await decideEstimate({
        estimateId: String(req.params.estimateId),
        customer: req.user!,
        decision: req.body.decision,
        reason: req.body.reason
      });
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/parts-requests',
  requireRoles('mechanic', 'shop_admin'),
  validate(partsRequestSchema),
  async (req, res, next) => {
    try {
      const partsRequest = await requestParts({
        repairId: String(req.params.id),
        partId: req.body.partId,
        quantity: req.body.quantity,
        mechanic: req.user!,
        notes: req.body.notes
      });
      return ok(res, partsRequest, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/parts-not-required',
  requireRoles('mechanic', 'shop_admin'),
  validate(partsNotRequiredSchema),
  async (req, res, next) => {
    try {
      const repair = await confirmPartsNotRequired({
        repairId: String(req.params.id),
        mechanic: req.user!,
        notes: req.body.notes
      });
      return ok(res, repair);
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:id/readiness', async (req, res, next) => {
  try {
    const repair = await RepairRequest.findById(req.params.id);
    if (!repair) throw new AppError('Not found', 404, 'NOT_FOUND');
    assertCanViewRepair(req.user!, repair);
    return ok(res, await evaluateRepairReadiness(repair._id));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/start', requireRoles('mechanic', 'shop_admin'), async (req, res, next) => {
  try {
    const repair = await startRepairWork({ repairId: String(req.params.id), mechanic: req.user! });
    return ok(res, repair);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/complete',
  requireRoles('mechanic', 'shop_admin'),
  validate(completeSchema),
  async (req, res, next) => {
    try {
      const repair = await completeRepair({
        repairId: String(req.params.id),
        mechanic: req.user!,
        workPerformed: req.body.workPerformed,
        finalCost: req.body.finalCost,
        completionSummary: req.body.completionSummary
      });
      return ok(res, repair);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/collect',
  requireRoles('shop_admin', 'parts_coordinator', 'mechanic'),
  validate(collectSchema),
  async (req, res, next) => {
    try {
      const repair = await confirmCollection({
        repairId: String(req.params.id),
        staff: req.user!,
        notes: req.body.notes
      });
      return ok(res, repair);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/close',
  requireRoles('shop_admin'),
  validate(collectSchema),
  async (req, res, next) => {
    try {
      const repair = await closeRepairCase({
        repairId: String(req.params.id),
        staff: req.user!,
        notes: req.body.notes,
        caseSummary: req.body.caseSummary,
        waiveOutstanding: req.body.waiveOutstanding,
        waiveReason: req.body.waiveReason
      });
      return ok(res, repair);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/reopen',
  requireRoles('shop_admin'),
  async (req, res, next) => {
    try {
      const repair = await reopenRepairCase({
        repairId: String(req.params.id),
        staff: req.user!,
        reason: String(req.body?.reason || '')
      });
      return ok(res, repair);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/customer-updates',
  requireRoles('shop_admin', 'mechanic', 'parts_coordinator'),
  validate(repairMessageSchema),
  async (req, res, next) => {
    try {
      const message = await postCustomerStatusUpdate({
        repairId: String(req.params.id),
        staff: req.user!,
        message: req.body.body,
        messageType: req.body.messageType || 'status_update'
      });
      return ok(res, message, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:id/payments', async (req, res, next) => {
  try {
    const repair = await RepairRequest.findById(req.params.id);
    if (!repair) throw new AppError('Not found', 404, 'NOT_FOUND');
    assertCanViewRepair(req.user!, repair);
    return ok(res, await getRepairPaymentSummary(String(repair._id)));
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/:id/workspace',
  requireRoles('mechanic', 'shop_admin'),
  validate(mechanicUpdateSchema),
  async (req, res, next) => {
    try {
      const repair = await RepairRequest.findById(req.params.id);
      if (!repair) throw new AppError('Not found', 404, 'NOT_FOUND');
      assertCanMutateRepair(req.user!, repair);

      if (req.body.priority) repair.priority = req.body.priority;
      if (req.body.deadline !== undefined) {
        repair.deadline = req.body.deadline ? new Date(req.body.deadline) : undefined;
      }
      if (req.body.laborMinutes != null) repair.laborMinutes = req.body.laborMinutes;
      if (req.body.customerNotes != null) repair.customerNotes = req.body.customerNotes;
      if (req.body.internalNotes != null) repair.internalNotes = req.body.internalNotes;
      if (req.body.diagnosisChecklist) repair.diagnosisChecklist = req.body.diagnosisChecklist;
      if (req.body.completionChecklist) repair.completionChecklist = req.body.completionChecklist;
      if (req.body.photos?.length) {
        repair.photos = [...(repair.photos || []), ...req.body.photos].slice(-12) as typeof repair.photos;
      }
      await repair.save();
      return ok(res, repair);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/feedback',
  requireRoles('customer'),
  validate(feedbackSchema),
  async (req, res, next) => {
    try {
      const repair = await RepairRequest.findById(req.params.id);
      if (!repair) throw new AppError('Not found', 404, 'NOT_FOUND');
      if (!repair.customer || repair.customer.toString() !== req.user!.id) {
        throw new AppError('Forbidden', 403, 'FORBIDDEN');
      }
      if (repair.status !== 'completed') {
        throw new AppError('Feedback is available after completion', 409, 'INVALID_STATE');
      }
      if (repair.feedbackRating) {
        throw new AppError('Feedback already submitted', 409, 'ALREADY_SUBMITTED');
      }
      repair.feedbackRating = req.body.rating;
      repair.feedbackComment = req.body.comment || '';
      repair.feedbackAt = new Date();
      await repair.save();
      return ok(res, {
        rating: repair.feedbackRating,
        comment: repair.feedbackComment,
        at: repair.feedbackAt
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:id/messages', async (req, res, next) => {
  try {
    return ok(res, await listRepairMessages(String(req.params.id), req.user!));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/messages', validate(repairMessageSchema), async (req, res, next) => {
  try {
    const message = await postRepairMessage({
      repairId: String(req.params.id),
      user: req.user!,
      body: req.body.body,
      visibility: req.body.visibility,
      attachments: req.body.attachments
    });
    return ok(res, message, 201);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/tracking-events', async (req, res, next) => {
  try {
    const repair = await RepairRequest.findById(req.params.id);
    if (!repair) throw new AppError('Not found', 404, 'NOT_FOUND');
    assertCanViewRepair(req.user!, repair);
    const customerVisibleOnly = req.user!.role === 'customer';
    const events = await listTrackingEventsForRepair(repair._id, { customerVisibleOnly });
    return ok(res, events);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/tracking/regenerate',
  requireRoles('customer', 'mechanic', 'shop_admin'),
  async (req, res, next) => {
    try {
      return ok(res, await regenerateTrackingCredentials({ repairId: String(req.params.id), user: req.user! }));
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:id/receipt', requireRoles('customer', 'shop_admin', 'mechanic'), async (req, res, next) => {
  try {
    const repair = await RepairRequest.findById(req.params.id)
      .populate('shop', 'name address city phone')
      .populate('customer', 'name email');
    if (!repair) throw new AppError('Not found', 404, 'NOT_FOUND');
    assertCanViewRepair(req.user!, repair);
    if (!['ready_for_collection', 'completed'].includes(repair.status)) {
      throw new AppError('Receipt available after work completion', 409, 'INVALID_STATE');
    }

    const estimates = await RepairEstimate.find({ repairRequest: repair._id, status: 'approved' }).sort({
      version: -1
    });

    return ok(res, {
      referenceNumber: repair.referenceNumber,
      completedAt: repair.completedAt,
      customer: { name: (repair.customer as { name?: string }).name },
      shop: repair.shop,
      device: {
        type: repair.deviceType,
        brand: repair.brand,
        model: repair.model,
        serialNumber: repair.serialNumber
      },
      workPerformed: repair.workPerformed,
      finalCost: repair.finalCost,
      warrantyExpiresAt: repair.warrantyExpiresAt,
      estimate: estimates[0] || null
    });
  } catch (err) {
    next(err);
  }
});

export default router;
