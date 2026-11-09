import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { TRANSFER_STATUSES } from '../types/roles.js';

const transferEventSchema = new Schema(
  {
    status: { type: String, enum: TRANSFER_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, default: '' }
  },
  { _id: false }
);

const stockTransferSchema = new Schema(
  {
    partSku: { type: String, required: true, uppercase: true, trim: true, index: true },
    partName: { type: String, required: true, trim: true },
    fromShop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    toShop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    fromPart: { type: Schema.Types.ObjectId, ref: 'Part', required: true },
    toPart: { type: Schema.Types.ObjectId, ref: 'Part' },
    quantity: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: TRANSFER_STATUSES,
      default: 'requested',
      index: true
    },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    dispatchedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, default: '' },
    notes: { type: String, default: '' },
    /** Optional link so received stock can be reserved against a specific repair. */
    repairRequest: { type: Schema.Types.ObjectId, ref: 'RepairRequest', index: true },
    partsRequest: { type: Schema.Types.ObjectId, ref: 'PartsRequest', index: true },
    /** Only treat as confirmed when expectedArrivalConfirmed is true. */
    expectedArrivalDate: { type: Date },
    expectedArrivalConfirmed: { type: Boolean, default: false },
    reserveOnReceive: { type: Boolean, default: false },
    history: { type: [transferEventSchema], default: [] },
    receivedAt: { type: Date },
    reservedAt: { type: Date }
  },
  { timestamps: true }
);

export type StockTransferDoc = InferSchemaType<typeof stockTransferSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const StockTransfer: Model<StockTransferDoc> =
  mongoose.models.StockTransfer ||
  mongoose.model<StockTransferDoc>('StockTransfer', stockTransferSchema);
