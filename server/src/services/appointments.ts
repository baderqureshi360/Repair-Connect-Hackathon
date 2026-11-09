import { Appointment, RepairShop } from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import { notify } from './notifications.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export async function listAvailableSlots(shopId: string, dateIso: string) {
  const shop = await RepairShop.findById(shopId);
  if (!shop || !shop.isActive) throw new AppError('Shop not found', 404, 'NOT_FOUND');

  const day = new Date(dateIso);
  if (Number.isNaN(day.getTime())) throw new AppError('Invalid date', 400, 'INVALID_DATE');
  day.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);

  const key = DAY_KEYS[day.getDay()];
  const hoursMap = shop.operatingHours as Map<string, { open: string; close: string; closed?: boolean }> | undefined;
  const hours = hoursMap?.get?.(key) || (hoursMap as unknown as Record<string, { open: string; close: string; closed?: boolean }>)?.[key] || {
    open: '09:00',
    close: '18:00',
    closed: key === 'sun'
  };
  if (hours.closed) return { shopId, date: dateIso, slots: [] as string[] };

  const slotMinutes = shop.slotMinutes || 60;
  const capacity = shop.dailyCapacity || 16;
  const startMin = parseHm(hours.open);
  const endMin = parseHm(hours.close);

  const booked = await Appointment.find({
    shop: shopId,
    status: 'booked',
    startsAt: { $gte: day, $lte: dayEnd }
  }).select('startsAt');

  const bookedSet = new Set(booked.map((b) => new Date(b.startsAt).toISOString()));
  const slots: string[] = [];

  for (let m = startMin; m + slotMinutes <= endMin && slots.length < capacity; m += slotMinutes) {
    const slot = new Date(day);
    slot.setHours(Math.floor(m / 60), m % 60, 0, 0);
    const iso = slot.toISOString();
    if (!bookedSet.has(iso) && slot.getTime() > Date.now()) {
      slots.push(iso);
    }
  }

  return { shopId, date: dateIso, slots, capacity, bookedCount: booked.length };
}

export async function bookAppointment(input: {
  customerId: string;
  shopId: string;
  startsAt: string;
  notes?: string;
  repairRequestId?: string;
}) {
  const shop = await RepairShop.findById(input.shopId);
  if (!shop || !shop.isActive) throw new AppError('Shop not found', 404, 'NOT_FOUND');

  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
    throw new AppError('Appointment must be in the future', 400, 'INVALID_SLOT');
  }

  const day = startsAt.toISOString().slice(0, 10);
  const availability = await listAvailableSlots(input.shopId, day);
  if (!availability.slots.includes(startsAt.toISOString())) {
    throw new AppError('Slot unavailable', 409, 'SLOT_UNAVAILABLE');
  }

  const endsAt = new Date(startsAt.getTime() + (shop.slotMinutes || 60) * 60_000);

  let appointment;
  try {
    appointment = await Appointment.create({
      shop: input.shopId,
      customer: input.customerId,
      repairRequest: input.repairRequestId,
      startsAt,
      endsAt,
      status: 'booked',
      notes: input.notes || ''
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new AppError('Slot already booked', 409, 'SLOT_UNAVAILABLE');
    }
    throw err;
  }

  await writeAudit({
    actor: input.customerId,
    action: 'appointment.book',
    entityType: 'Appointment',
    entityId: appointment._id,
    shop: input.shopId
  });

  await notify({
    user: input.customerId,
    type: 'appointment_booked',
    title: 'Appointment booked',
    message: `Your appointment at ${shop.name} is scheduled for ${startsAt.toLocaleString()}`,
    meta: { appointmentId: appointment._id }
  });

  return appointment;
}

export async function cancelAppointment(input: {
  appointmentId: string;
  customerId: string;
  reason?: string;
}) {
  const appointment = await Appointment.findById(input.appointmentId);
  if (!appointment) throw new AppError('Appointment not found', 404, 'NOT_FOUND');
  if (appointment.customer.toString() !== input.customerId) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
  if (appointment.status !== 'booked') {
    throw new AppError('Appointment cannot be cancelled', 409, 'INVALID_STATE');
  }

  const shop = await RepairShop.findById(appointment.shop);
  const policyHours = shop?.cancelPolicyHours ?? 2;
  const hoursUntil = (appointment.startsAt.getTime() - Date.now()) / 3_600_000;
  if (hoursUntil < policyHours) {
    throw new AppError(
      `Cancellations require at least ${policyHours} hours notice`,
      409,
      'CANCEL_POLICY'
    );
  }

  appointment.status = 'cancelled';
  appointment.cancelReason = input.reason || '';
  await appointment.save();
  return appointment;
}

export async function rescheduleAppointment(input: {
  appointmentId: string;
  customerId: string;
  startsAt: string;
  notes?: string;
}) {
  const appointment = await Appointment.findById(input.appointmentId);
  if (!appointment) throw new AppError('Appointment not found', 404, 'NOT_FOUND');
  if (appointment.customer.toString() !== input.customerId) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
  if (appointment.status !== 'booked') {
    throw new AppError('Only booked appointments can be rescheduled', 409, 'INVALID_STATE');
  }

  const shop = await RepairShop.findById(appointment.shop);
  if (!shop) throw new AppError('Shop not found', 404, 'NOT_FOUND');

  appointment.status = 'rescheduled';
  await appointment.save();

  return bookAppointment({
    customerId: input.customerId,
    shopId: appointment.shop.toString(),
    startsAt: input.startsAt,
    notes: input.notes || appointment.notes,
    repairRequestId: appointment.repairRequest?.toString()
  });
}
