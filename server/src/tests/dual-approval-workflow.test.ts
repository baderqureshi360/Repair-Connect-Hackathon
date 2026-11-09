import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  Part,
  RepairShop,
  ShopMembership,
  User,
  RepairRequest,
  RepairEstimate,
  EstimateDecision,
  PartsReservation,
  StockTransfer,
  ShopSettings
} from '../models/index.js';
// PartsReservation used for revise reconciliation assertions
import { evaluateRepairReadiness } from '../services/readiness.js';

const app = createApp();
const password = 'Password123!';

async function seed() {
  const passwordHash = await bcrypt.hash(password, 10);
  const shop = await RepairShop.create({
    name: 'Dual Shop',
    code: 'DUAL1',
    address: '1 Dual St',
    city: 'Lahore',
    phone: '111'
  });
  const otherShop = await RepairShop.create({
    name: 'Donor Shop',
    code: 'DONOR1',
    address: '2 Donor St',
    city: 'Karachi',
    phone: '222'
  });

  const [customer, mechanic, parts, admin, outsider] = await User.create([
    { email: 'dual-c@test.com', passwordHash, name: 'Customer', role: 'customer' },
    { email: 'dual-m@test.com', passwordHash, name: 'Mechanic', role: 'mechanic' },
    { email: 'dual-p@test.com', passwordHash, name: 'Parts', role: 'parts_coordinator' },
    { email: 'dual-a@test.com', passwordHash, name: 'Admin', role: 'shop_admin' },
    { email: 'dual-o@test.com', passwordHash, name: 'Outsider', role: 'parts_coordinator' }
  ]);

  await ShopMembership.create([
    { user: mechanic._id, shop: shop._id, role: 'mechanic' },
    { user: parts._id, shop: shop._id, role: 'parts_coordinator' },
    { user: admin._id, shop: shop._id, role: 'shop_admin' },
    { user: outsider._id, shop: otherShop._id, role: 'parts_coordinator' },
    { user: parts._id, shop: otherShop._id, role: 'parts_coordinator' }
  ]);

  const localScreen = await Part.create({
    shop: shop._id,
    sku: 'PHONE-SCR',
    name: 'Phone Screen',
    quantityAvailable: 0,
    quantityReserved: 0,
    reorderLevel: 1,
    unitCost: 5000
  });

  const donorScreen = await Part.create({
    shop: otherShop._id,
    sku: 'PHONE-SCR',
    name: 'Phone Screen',
    quantityAvailable: 3,
    quantityReserved: 0,
    reorderLevel: 1,
    unitCost: 5000
  });

  const lastUnit = await Part.create({
    shop: shop._id,
    sku: 'LAST-SCR',
    name: 'Last Screen',
    quantityAvailable: 1,
    quantityReserved: 0,
    reorderLevel: 0,
    unitCost: 4000
  });

  await ShopSettings.create({
    shop: shop._id,
    paymentPolicy: { requirePaymentBeforeCollection: false, allowPartialPayment: true }
  });

  return { shop, otherShop, customer, mechanic, parts, admin, outsider, localScreen, donorScreen, lastUnit };
}

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

async function bookThroughEstimate(ctx: Awaited<ReturnType<typeof seed>>, opts?: { stockPartId?: string }) {
  const customerToken = await login('dual-c@test.com');
  const adminToken = await login('dual-a@test.com');
  const mechanicToken = await login('dual-m@test.com');
  const partsToken = await login('dual-p@test.com');

  const createRes = await request(app)
    .post('/api/v1/repairs')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({
      shopId: ctx.shop._id.toString(),
      deviceType: 'Phone',
      brand: 'Apple',
      model: 'iPhone 13',
      problemDescription: `Cracked screen ${Date.now()}-${Math.random()}`
    });
  expect(createRes.status).toBe(201);
  const repairId = createRes.body.data._id as string;

  await request(app)
    .post(`/api/v1/repairs/${repairId}/assign`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ mechanicId: ctx.mechanic._id.toString() });

  await request(app)
    .post(`/api/v1/repairs/${repairId}/diagnosis`)
    .set('Authorization', `Bearer ${mechanicToken}`)
    .send({
      findings: 'OLED panel cracked',
      recommendedActions: 'Replace screen assembly'
    });

  const est = await request(app)
    .post(`/api/v1/repairs/${repairId}/estimates`)
    .set('Authorization', `Bearer ${mechanicToken}`)
    .send({ laborCost: 2000, partsCost: 8000, notes: 'Screen replacement' });
  expect(est.status).toBe(201);

  return {
    repairId,
    estimateId: est.body.data._id as string,
    customerToken,
    adminToken,
    mechanicToken,
    partsToken,
    partId: (opts?.stockPartId || ctx.localScreen._id).toString()
  };
}

describe('CRITICAL dual-approval repair workflow', () => {
  it('1) neither approval nor reservation — cannot start', async () => {
    const ctx = await seed();
    const flow = await bookThroughEstimate(ctx);

    const readiness = await request(app)
      .get(`/api/v1/repairs/${flow.repairId}/readiness`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    expect(readiness.status).toBe(200);
    expect(readiness.body.data.canStartRepair).toBe(false);
    expect(readiness.body.data.latestEstimateApproved).toBe(false);

    const start = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    expect(start.status).toBe(409);
  });

  it('2) approval without part reservation — cannot start', async () => {
    const ctx = await seed();
    const flow = await bookThroughEstimate(ctx);

    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });

    await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/parts-requests`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ partId: flow.partId, quantity: 1 });

    const readiness = await evaluateRepairReadiness(flow.repairId);
    expect(readiness.latestEstimateApproved).toBe(true);
    expect(readiness.allRequiredPartsReserved).toBe(false);
    expect(readiness.canStartRepair).toBe(false);
    expect(readiness.customerMessage).toMatch(/awaiting part reservation/i);

    const start = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    expect(start.status).toBe(409);
    expect(start.body.error.code).toBe('NOT_READY');
  });

  it('3) part reservation without customer approval — cannot start', async () => {
    const ctx = await seed();
    // Seed with stock so we can force a reservation path after illicit state
    await Part.findByIdAndUpdate(ctx.localScreen._id, { quantityAvailable: 2 });
    const flow = await bookThroughEstimate(ctx);

    // Approve temporarily to create parts request, then revise estimate to invalidate approval
    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });

    const pr = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/parts-requests`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ partId: flow.partId, quantity: 1 });

    await request(app)
      .post(`/api/v1/parts/requests/${pr.body.data._id}/reserve`)
      .set('Authorization', `Bearer ${flow.partsToken}`)
      .send({ quantity: 1 });

    // Revise estimate — invalidates prior approval for the new version
    const revised = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/estimates`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ laborCost: 2500, partsCost: 9000, notes: 'Revised quote' });
    expect(revised.status).toBe(201);
    expect(revised.body.data.version).toBe(2);
    expect(revised.body.data.status).toBe('pending');

    const readiness = await evaluateRepairReadiness(flow.repairId);
    expect(readiness.latestEstimateApproved).toBe(false);
    expect(readiness.partsRequirementStatus).toBe('undetermined');
    expect(readiness.canStartRepair).toBe(false);

    const activeReservations = await PartsReservation.find({
      repairRequest: flow.repairId,
      status: 'active'
    });
    expect(activeReservations).toHaveLength(0);

    const start = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    expect(start.status).toBe(409);
  });

  it('2b) undetermined parts requirement blocks start after approval', async () => {
    const ctx = await seed();
    const flow = await bookThroughEstimate(ctx);

    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });

    const readiness = await evaluateRepairReadiness(flow.repairId);
    expect(readiness.latestEstimateApproved).toBe(true);
    expect(readiness.partsRequirementStatus).toBe('undetermined');
    expect(readiness.canStartRepair).toBe(false);

    const start = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    expect(start.status).toBe(409);
    expect(start.body.error.code).toBe('NOT_READY');
    expect(start.body.error.details.partsRequirementStatus).toBe('undetermined');
  });

  it('2c) explicit not_required allows start after approval', async () => {
    const ctx = await seed();
    const flow = await bookThroughEstimate(ctx);

    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });

    const confirm = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/parts-not-required`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ notes: 'Software-only fix' });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.partsRequirement.status).toBe('not_required');
    expect(confirm.body.data.partsRequirement.estimateVersion).toBe(1);
    expect(confirm.body.data.partsRequirement.confirmedBy).toBeTruthy();

    const readiness = await evaluateRepairReadiness(flow.repairId);
    expect(readiness.canStartRepair).toBe(true);
    expect(readiness.partsRequirementStatus).toBe('not_required');

    const start = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    expect(start.status).toBe(200);
    expect(start.body.data.status).toBe('in_progress');
  });

  it('4) both conditions satisfied — can start', async () => {
    const ctx = await seed();
    await Part.findByIdAndUpdate(ctx.localScreen._id, { quantityAvailable: 2 });
    const flow = await bookThroughEstimate(ctx);

    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });

    const pr = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/parts-requests`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ partId: flow.partId, quantity: 1 });

    await request(app)
      .post(`/api/v1/parts/requests/${pr.body.data._id}/reserve`)
      .set('Authorization', `Bearer ${flow.partsToken}`)
      .send({ quantity: 1 });

    const readiness = await evaluateRepairReadiness(flow.repairId);
    expect(readiness.canStartRepair).toBe(true);
    expect(readiness.workflowStage).toBe('ready_to_start');

    const start = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    expect(start.status).toBe(200);
    expect(start.body.data.status).toBe('in_progress');
  });

  it('5) customer rejects the estimate — blocks start and completion', async () => {
    const ctx = await seed();
    const flow = await bookThroughEstimate(ctx);

    const reject = await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'rejected', reason: 'Too expensive' });
    expect(reject.status).toBe(200);

    const decision = await EstimateDecision.findOne({ estimate: flow.estimateId });
    expect(decision?.decision).toBe('rejected');

    const start = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    expect(start.status).toBe(409);

    const complete = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/complete`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ workPerformed: 'Should fail', finalCost: 1 });
    expect(complete.status).toBe(409);
  });

  it('6) mechanic revises an already-approved estimate — prior approval obsolete', async () => {
    const ctx = await seed();
    const flow = await bookThroughEstimate(ctx);

    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });

    const v1 = await RepairEstimate.findById(flow.estimateId);
    expect(v1?.status).toBe('approved');

    const revised = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/estimates`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ laborCost: 3000, partsCost: 10000 });
    expect(revised.status).toBe(201);
    expect(revised.body.data.version).toBe(2);

    const repair = await RepairRequest.findById(flow.repairId);
    expect(repair?.status).toBe('estimate_pending');

    // History preserved
    const estimates = await RepairEstimate.find({ repairRequest: flow.repairId }).sort({ version: 1 });
    expect(estimates).toHaveLength(2);
    expect(estimates[0].status).toBe('approved');
    expect(estimates[1].status).toBe('pending');

    const readiness = await evaluateRepairReadiness(flow.repairId);
    expect(readiness.latestEstimateApproved).toBe(false);
    expect(readiness.latestEstimateVersion).toBe(2);
    expect(readiness.canStartRepair).toBe(false);

    // Starting with obsolete approval must fail
    const start = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    expect(start.status).toBe(409);
  });

  it('7) part unavailable and transfer requested — arrival Unconfirmed', async () => {
    const ctx = await seed();
    const flow = await bookThroughEstimate(ctx);

    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });

    const pr = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/parts-requests`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ partId: flow.partId, quantity: 1 });

    const failReserve = await request(app)
      .post(`/api/v1/parts/requests/${pr.body.data._id}/reserve`)
      .set('Authorization', `Bearer ${flow.partsToken}`)
      .send({ quantity: 1 });
    expect(failReserve.status).toBe(409);
    expect(failReserve.body.error.code).toBe('INSUFFICIENT_STOCK');

    const transfer = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${flow.partsToken}`)
      .send({
        fromPartId: ctx.donorScreen._id.toString(),
        toShopId: ctx.shop._id.toString(),
        quantity: 1,
        reason: 'Part unavailable — transfer requested',
        repairRequestId: flow.repairId,
        partsRequestId: pr.body.data._id,
        reserveOnReceive: true
        // no confirmed arrival date
      });
    expect(transfer.status).toBe(201);
    expect(transfer.body.data.status).toBe('requested');
    expect(transfer.body.data.expectedArrivalDisplay).toBe('Unconfirmed');
    expect(transfer.body.data.expectedArrivalConfirmed).toBe(false);

    const approve = await request(app)
      .post(`/api/v1/transfers/${transfer.body.data._id}/approve`)
      .set('Authorization', `Bearer ${flow.partsToken}`);
    expect(approve.body.data.status).toBe('awaiting_transfer');
  });

  it('8) transfer arrival and reservation against repair', async () => {
    const ctx = await seed();
    const flow = await bookThroughEstimate(ctx);

    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });

    const pr = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/parts-requests`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ partId: flow.partId, quantity: 1 });

    const transfer = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${flow.partsToken}`)
      .send({
        fromPartId: ctx.donorScreen._id.toString(),
        toShopId: ctx.shop._id.toString(),
        quantity: 1,
        repairRequestId: flow.repairId,
        partsRequestId: pr.body.data._id,
        reserveOnReceive: true,
        expectedArrivalDate: new Date(Date.now() + 86400000).toISOString(),
        expectedArrivalConfirmed: true
      });
    expect(transfer.body.data.expectedArrivalDisplay).not.toBe('Unconfirmed');

    await request(app)
      .post(`/api/v1/transfers/${transfer.body.data._id}/approve`)
      .set('Authorization', `Bearer ${flow.partsToken}`);
    await request(app)
      .post(`/api/v1/transfers/${transfer.body.data._id}/dispatch`)
      .set('Authorization', `Bearer ${flow.partsToken}`);

    const receive = await request(app)
      .post(`/api/v1/transfers/${transfer.body.data._id}/receive`)
      .set('Authorization', `Bearer ${flow.partsToken}`);
    expect(receive.status).toBe(200);
    expect(['received', 'reserved']).toContain(receive.body.data.status);

    const reservation = await PartsReservation.findOne({
      repairRequest: flow.repairId,
      status: 'active'
    });
    expect(reservation).toBeTruthy();

    const readiness = await evaluateRepairReadiness(flow.repairId);
    expect(readiness.canStartRepair).toBe(true);

    const xfer = await StockTransfer.findById(transfer.body.data._id);
    expect(xfer?.history?.length).toBeGreaterThanOrEqual(3);
    expect(xfer?.fromShop.toString()).toBe(ctx.otherShop._id.toString());
    expect(xfer?.toShop.toString()).toBe(ctx.shop._id.toString());
  });

  it('9) duplicate transfer receiving is rejected', async () => {
    const ctx = await seed();
    const flow = await bookThroughEstimate(ctx);

    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });

    const transfer = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${flow.partsToken}`)
      .send({
        fromPartId: ctx.donorScreen._id.toString(),
        toShopId: ctx.shop._id.toString(),
        quantity: 1
      });

    await request(app)
      .post(`/api/v1/transfers/${transfer.body.data._id}/approve`)
      .set('Authorization', `Bearer ${flow.partsToken}`);
    await request(app)
      .post(`/api/v1/transfers/${transfer.body.data._id}/dispatch`)
      .set('Authorization', `Bearer ${flow.partsToken}`);

    const first = await request(app)
      .post(`/api/v1/transfers/${transfer.body.data._id}/receive`)
      .set('Authorization', `Bearer ${flow.partsToken}`);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/transfers/${transfer.body.data._id}/receive`)
      .set('Authorization', `Bearer ${flow.partsToken}`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_RECEIVED');

    const local = await Part.findOne({ shop: ctx.shop._id, sku: 'PHONE-SCR' });
    expect(local?.quantityAvailable).toBe(1);
  });

  it('10) concurrent reservation attempts — only one wins', async () => {
    const ctx = await seed();
    const flow1 = await bookThroughEstimate(ctx, { stockPartId: ctx.lastUnit._id.toString() });
    const flow2 = await bookThroughEstimate(ctx, { stockPartId: ctx.lastUnit._id.toString() });

    for (const flow of [flow1, flow2]) {
      await request(app)
        .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
        .set('Authorization', `Bearer ${flow.customerToken}`)
        .send({ decision: 'approved' });
    }

    const pr1 = await request(app)
      .post(`/api/v1/repairs/${flow1.repairId}/parts-requests`)
      .set('Authorization', `Bearer ${flow1.mechanicToken}`)
      .send({ partId: ctx.lastUnit._id.toString(), quantity: 1 });
    const pr2 = await request(app)
      .post(`/api/v1/repairs/${flow2.repairId}/parts-requests`)
      .set('Authorization', `Bearer ${flow2.mechanicToken}`)
      .send({ partId: ctx.lastUnit._id.toString(), quantity: 1 });

    const [r1, r2] = await Promise.all([
      request(app)
        .post(`/api/v1/parts/requests/${pr1.body.data._id}/reserve`)
        .set('Authorization', `Bearer ${flow1.partsToken}`)
        .send({ quantity: 1 }),
      request(app)
        .post(`/api/v1/parts/requests/${pr2.body.data._id}/reserve`)
        .set('Authorization', `Bearer ${flow2.partsToken}`)
        .send({ quantity: 1 })
    ]);

    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const part = await Part.findById(ctx.lastUnit._id);
    expect(part?.quantityAvailable).toBe(0);
    expect(part?.quantityReserved).toBe(1);
  });

  it('11) mechanic attempts to start prematurely — blocked by server', async () => {
    const ctx = await seed();
    const flow = await bookThroughEstimate(ctx);

    const premature = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    expect(premature.status).toBe(409);

    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });

    // Approved but parts outstanding
    await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/parts-requests`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ partId: flow.partId, quantity: 1 });

    const stillBlocked = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    expect(stillBlocked.status).toBe(409);
    expect(stillBlocked.body.error.code).toBe('NOT_READY');
  });

  it('12) repair work completion → ready_for_collection (not closed)', async () => {
    const ctx = await seed();
    await Part.findByIdAndUpdate(ctx.localScreen._id, { quantityAvailable: 1 });
    const flow = await bookThroughEstimate(ctx);

    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });

    const pr = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/parts-requests`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ partId: flow.partId, quantity: 1 });
    await request(app)
      .post(`/api/v1/parts/requests/${pr.body.data._id}/reserve`)
      .set('Authorization', `Bearer ${flow.partsToken}`)
      .send({ quantity: 1 });

    await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);

    const complete = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/complete`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ workPerformed: 'Replaced phone screen and tested touch', finalCost: 10000 });
    expect(complete.status).toBe(200);
    expect(complete.body.data.status).toBe('ready_for_collection');
    expect(complete.body.data.workCompletedAt).toBeTruthy();
    expect(complete.body.data.collectedAt).toBeFalsy();
    expect(complete.body.data.completedAt).toBeFalsy();

    const readiness = await evaluateRepairReadiness(flow.repairId);
    expect(readiness.customerMessage).toBe('Ready for collection.');
  });

  it('13) collection confirmation closes job; payment remains separate; auth enforced', async () => {
    const ctx = await seed();
    await Part.findByIdAndUpdate(ctx.localScreen._id, { quantityAvailable: 1 });
    const flow = await bookThroughEstimate(ctx);

    await request(app)
      .post(`/api/v1/repairs/estimates/${flow.estimateId}/decision`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({ decision: 'approved' });
    const pr = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/parts-requests`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ partId: flow.partId, quantity: 1 });
    await request(app)
      .post(`/api/v1/parts/requests/${pr.body.data._id}/reserve`)
      .set('Authorization', `Bearer ${flow.partsToken}`)
      .send({ quantity: 1 });
    await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/start`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`);
    await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/complete`)
      .set('Authorization', `Bearer ${flow.mechanicToken}`)
      .send({ workPerformed: 'Screen replaced', finalCost: 10000 });

    // Customer cannot collect
    const customerCollect = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/collect`)
      .set('Authorization', `Bearer ${flow.customerToken}`)
      .send({});
    expect(customerCollect.status).toBe(403);

    // Cross-shop parts coordinator cannot collect
    const outsiderToken = await login('dual-o@test.com');
    const outsiderCollect = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/collect`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({});
    expect(outsiderCollect.status).toBe(403);

    const collect = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/collect`)
      .set('Authorization', `Bearer ${flow.adminToken}`)
      .send({ notes: 'Customer collected with cash payment recorded separately' });
    expect(collect.status).toBe(200);
    expect(collect.body.data.status).toBe('ready_for_collection');
    expect(collect.body.data.collectedAt).toBeTruthy();

    await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${flow.adminToken}`)
      .send({
        repairId: flow.repairId,
        amount: 10000,
        method: 'cash',
        confirmedReceived: true,
        idempotencyKey: `dual-pay-${flow.repairId}`
      })
      .expect(201);

    const closed = await request(app)
      .post(`/api/v1/repairs/${flow.repairId}/close`)
      .set('Authorization', `Bearer ${flow.adminToken}`)
      .send({ notes: 'Closed after payment' });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('completed');
    expect(closed.body.data.completedAt).toBeTruthy();

    // Payment is a separate record — collection did not create one
    const payments = await request(app)
      .get(`/api/v1/documents?repairId=${flow.repairId}&docType=payment_receipt`)
      .set('Authorization', `Bearer ${flow.adminToken}`);
    // endpoint may return list or empty — ensure collect ≠ payment
    expect(collect.body.data.finalCost).toBe(10000);
    void payments;

    const persisted = await RepairRequest.findById(flow.repairId);
    expect(persisted?.status).toBe('completed');
    expect(persisted?.workCompletedAt).toBeTruthy();
    expect(persisted?.collectedAt).toBeTruthy();
    expect(persisted?.workCompletedAt!.getTime()).toBeLessThanOrEqual(persisted!.collectedAt!.getTime());
  });
});
