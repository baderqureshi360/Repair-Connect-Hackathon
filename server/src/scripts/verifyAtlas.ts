/**
 * Atlas persistence + concurrent reservation verification.
 * Requires MONGODB_URI in the monorepo root .env (USE_MEMORY_DB=false).
 *
 * Usage: npm run verify:atlas -w server
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDb, disconnectDb, getDbMode } from '../config/db.js';
import {
  Part,
  RepairShop,
  ShopMembership,
  User,
  PartsRequest,
  PartsReservation,
  InventoryMovement,
  RepairRequest
} from '../models/index.js';
import { describeReserveError, reserveStock, stockIn } from '../services/inventory.js';
import { AppError } from '../utils/errors.js';
import { createRepairRequest, assignMechanic, addDiagnosis, submitEstimate, decideEstimate, requestParts, completeRepair, startRepairWork } from '../services/repairs.js';
import type { AuthUser } from '../middleware/auth.js';

async function main() {
  if (env.useMemoryDb) {
    console.error(
      `FAIL: Atlas verification refuses memory mode. Set USE_MEMORY_DB=false and MONGODB_URI in ${env.envFile || 'monorepo .env'}.`
    );
    process.exit(2);
  }
  if (!env.mongodbUri) {
    console.error(
      `FAIL: MONGODB_URI is required for Atlas verification (loaded from ${env.envFile || 'monorepo .env'}).`
    );
    process.exit(2);
  }

  const { mode } = await connectDb();
  if (mode !== 'atlas') {
    console.error('FAIL: Connected in memory mode; refusing Atlas verification.');
    process.exit(1);
  }
  console.log('OK: connected mode=', getDbMode(), 'envFile=', env.envFile);

  const marker = `atlas-verify-${Date.now()}`;
  const passwordHash = await bcrypt.hash('Password123!', 10);
  const shop = await RepairShop.create({
    name: `Atlas Verify ${marker}`,
    code: `AV${Date.now().toString().slice(-6)}`,
    address: 'Atlas St',
    city: 'Lahore',
    phone: '000'
  });

  const [customer, mechanic, parts, admin] = await User.create([
    { email: `${marker}-c@test.local`, passwordHash, name: 'C', role: 'customer' },
    { email: `${marker}-m@test.local`, passwordHash, name: 'M', role: 'mechanic' },
    { email: `${marker}-p@test.local`, passwordHash, name: 'P', role: 'parts_coordinator' },
    { email: `${marker}-a@test.local`, passwordHash, name: 'A', role: 'shop_admin' }
  ]);

  await ShopMembership.create([
    { user: mechanic._id, shop: shop._id, role: 'mechanic' },
    { user: parts._id, shop: shop._id, role: 'parts_coordinator' },
    { user: admin._id, shop: shop._id, role: 'shop_admin' }
  ]);

  const screen = await Part.create({
    shop: shop._id,
    sku: `SCR-${Date.now()}`,
    name: 'Atlas Screen',
    quantityAvailable: 0,
    quantityReserved: 0,
    reorderLevel: 1,
    unitCost: 1000
  });

  const repair = await createRepairRequest({
    customerId: customer._id.toString(),
    shopId: shop._id.toString(),
    deviceType: 'Laptop',
    brand: 'Dell',
    model: 'XPS',
    problemDescription: 'Atlas persistence cracked screen',
    idempotencyKey: marker
  });

  const adminUser: AuthUser = {
    id: admin._id.toString(),
    email: admin.email,
    role: 'shop_admin',
    name: admin.name,
    preferredLanguage: 'en',
    shopIds: [shop._id.toString()]
  };
  const mechanicUser: AuthUser = {
    id: mechanic._id.toString(),
    email: mechanic.email,
    role: 'mechanic',
    name: mechanic.name,
    preferredLanguage: 'en',
    shopIds: [shop._id.toString()]
  };
  const customerUser: AuthUser = {
    id: customer._id.toString(),
    email: customer.email,
    role: 'customer',
    name: customer.name,
    preferredLanguage: 'en',
    shopIds: []
  };

  await assignMechanic({
    repairId: repair._id.toString(),
    mechanicId: mechanic._id.toString(),
    admin: adminUser
  });
  await addDiagnosis({
    repairId: repair._id.toString(),
    mechanic: mechanicUser,
    findings: 'Broken LCD panel confirmed',
    recommendedActions: 'Replace screen'
  });
  const estimate = await submitEstimate({
    repairId: repair._id.toString(),
    mechanic: mechanicUser,
    laborCost: 1000,
    partsCost: 1000
  });
  await decideEstimate({
    estimateId: estimate._id.toString(),
    customer: customerUser,
    decision: 'approved'
  });
  const pr = await requestParts({
    repairId: repair._id.toString(),
    partId: screen._id.toString(),
    quantity: 1,
    mechanic: mechanicUser
  });

  let shortageOk = false;
  try {
    await reserveStock({
      partsRequestId: pr._id.toString(),
      quantity: 1,
      userId: parts._id.toString()
    });
  } catch (err) {
    shortageOk = (err as { code?: string }).code === 'INSUFFICIENT_STOCK';
  }
  if (!shortageOk) throw new Error('Expected shortage before stock-in');

  await stockIn({ partId: screen._id.toString(), quantity: 1, userId: parts._id.toString() });
  await reserveStock({
    partsRequestId: pr._id.toString(),
    quantity: 1,
    userId: parts._id.toString()
  });

  await startRepairWork({ repairId: repair._id.toString(), mechanic: mechanicUser });
  await completeRepair({
    repairId: repair._id.toString(),
    mechanic: mechanicUser,
    workPerformed: 'Replaced screen on Atlas verify run',
    finalCost: 2000
  });

  const { confirmCollection } = await import('../services/repairs.js');
  await confirmCollection({
    repairId: repair._id.toString(),
    staff: adminUser,
    notes: 'Atlas verify collection'
  });

  const repairId = repair._id.toString();
  const partId = screen._id.toString();

  // Restart connection to prove persistence
  await disconnectDb();
  const again = await connectDb();
  if (again.mode !== 'atlas') throw new Error('Reconnected in non-atlas mode');

  const persistedRepair = await mongoose.connection.db
    ?.collection('repairrequests')
    .findOne({ _id: new mongoose.Types.ObjectId(repairId) });
  const persistedPart = await mongoose.connection.db
    ?.collection('parts')
    .findOne({ _id: new mongoose.Types.ObjectId(partId) });
  const collections = await mongoose.connection.db?.listCollections().toArray();

  if (!persistedRepair || persistedRepair.status !== 'completed') {
    throw new Error('Repair did not persist as completed after reconnect');
  }
  if (!persistedPart || persistedPart.quantityReserved !== 0 || persistedPart.quantityAvailable !== 0) {
    throw new Error(
      `Inventory incorrect after reconnect: available=${persistedPart?.quantityAvailable} reserved=${persistedPart?.quantityReserved}`
    );
  }

  console.log('OK: Atlas persistence verified');
  console.log('OK: collections present =', collections?.map((c) => c.name).sort().join(', '));
  console.log('OK: repair status =', persistedRepair.status, 'ref =', persistedRepair.referenceNumber);
  console.log('OK: final stock available=', persistedPart.quantityAvailable, 'reserved=', persistedPart.quantityReserved);

  // -------------------------------------------------------------------------
  // Concurrent reservation: dedicated awaiting_parts repair + last unit of stock
  // (Must NOT reuse the completed repair — that caused INVALID_TRANSITION aborts.)
  // -------------------------------------------------------------------------
  const concurrencyRepair = await RepairRequest.create({
    referenceNumber: `RC-CONC-${Date.now()}`,
    customer: customer._id,
    shop: shop._id,
    deviceType: 'Laptop',
    brand: 'Lenovo',
    model: 'T14',
    problemDescription: 'Concurrent reservation fixture',
    status: 'awaiting_parts',
    assignedMechanic: mechanic._id
  });

  const last = await Part.create({
    shop: shop._id,
    sku: `LAST-${Date.now()}`,
    name: 'Last Unit Concurrent',
    quantityAvailable: 1,
    quantityReserved: 0,
    reorderLevel: 0,
    unitCost: 10
  });

  const pr1 = await PartsRequest.create({
    repairRequest: concurrencyRepair._id,
    shop: shop._id,
    part: last._id,
    requestedBy: mechanic._id,
    quantityRequested: 1,
    status: 'pending'
  });
  const pr2 = await PartsRequest.create({
    repairRequest: concurrencyRepair._id,
    shop: shop._id,
    part: last._id,
    requestedBy: mechanic._id,
    quantityRequested: 1,
    status: 'pending'
  });

  const runLabeled = async (label: string, partsRequestId: string) => {
    try {
      const data = await reserveStock({
        partsRequestId,
        quantity: 1,
        userId: parts._id.toString()
      });
      const reservationId = (data as { reservation?: { _id?: unknown } }).reservation?._id;
      console.log(`[concurrent:${label}] SUCCESS reservation=${reservationId}`);
      return { label, ok: true as const, data };
    } catch (err) {
      const diag = describeReserveError(err);
      console.log(`[concurrent:${label}] FAILURE`, JSON.stringify(diag));
      return { label, ok: false as const, err, diag };
    }
  };

  const [rA, rB] = await Promise.all([
    runLabeled('A', pr1._id.toString()),
    runLabeled('B', pr2._id.toString())
  ]);

  const successes = [rA, rB].filter((r) => r.ok);
  const failures = [rA, rB].filter((r) => !r.ok);
  const lastAfter = await Part.findById(last._id);
  const activeReservations = await PartsReservation.find({
    part: last._id,
    status: 'active'
  });
  const reserveMovements = await InventoryMovement.find({
    part: last._id,
    type: 'reserve'
  });

  console.log(
    `[concurrent] stock available=${lastAfter?.quantityAvailable} reserved=${lastAfter?.quantityReserved}`
  );
  console.log(
    `[concurrent] activeReservations=${activeReservations.length} reserveMovements=${reserveMovements.length}`
  );

  const shortageFailures = failures.filter(
    (f) => f.diag && (f.diag as { code?: string }).code === 'INSUFFICIENT_STOCK'
  );
  const unexpectedFailures = failures.filter(
    (f) => !f.diag || (f.diag as { code?: string }).code !== 'INSUFFICIENT_STOCK'
  );

  if (unexpectedFailures.length) {
    throw new Error(
      `Concurrent reserve had unexpected failures: ${JSON.stringify(unexpectedFailures.map((f) => f.diag))}`
    );
  }

  if (
    !(
      successes.length === 1 &&
      shortageFailures.length === 1 &&
      lastAfter?.quantityAvailable === 0 &&
      lastAfter?.quantityReserved === 1 &&
      activeReservations.length === 1 &&
      reserveMovements.length === 1
    )
  ) {
    throw new Error(
      `Concurrent reserve failed: successes=${successes.length} shortages=${shortageFailures.length} ` +
        `stock=${JSON.stringify({
          available: lastAfter?.quantityAvailable,
          reserved: lastAfter?.quantityReserved
        })} reservations=${activeReservations.length} movements=${reserveMovements.length}`
    );
  }

  // Confirm loser is AppError 409 INSUFFICIENT_STOCK
  const loser = failures[0];
  if (!(loser.err instanceof AppError) || loser.err.statusCode !== 409) {
    throw new Error(`Expected HTTP 409 AppError for loser, got ${JSON.stringify(loser.diag)}`);
  }

  console.log('OK: concurrent Atlas reservation — one win, one INSUFFICIENT_STOCK (409)');

  // Cleanup only concurrency fixture records
  await PartsReservation.deleteMany({ part: last._id });
  await InventoryMovement.deleteMany({ part: last._id });
  await PartsRequest.deleteMany({ _id: { $in: [pr1._id, pr2._id] } });
  await Part.deleteOne({ _id: last._id });
  await RepairRequest.deleteOne({ _id: concurrencyRepair._id });

  await disconnectDb();
  console.log('ATLAS_VERIFY_PASSED');
}

main().catch(async (err) => {
  console.error('ATLAS_VERIFY_FAILED', err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
