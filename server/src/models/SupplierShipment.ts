import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

export const SUPPLIER_SHIPMENT_STATUSES = [
  'draft',
  'dispatched',
  'in_transit',
  'delayed',
  'delivered',
  'cancelled'
] as const;
export type SupplierShipmentStatus = (typeof SUPPLIER_SHIPMENT_STATUSES)[number];

const attachmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    dataUrl: { type: String, required: true, maxlength: 400_000 },
    contentType: { type: String, default: 'application/octet-stream', maxlength: 120 },
    size: { type: Number, min: 0, default: 0 }
  },
  { _id: false }
);

const shipmentLineSchema = new Schema(
  {
    poLineId: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 }
  },
  { _id: false }
);

const supplierShipmentSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    purchaseOrder: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierPurchaseOrder',
      required: true,
      index: true
    },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    supplierBusiness: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierBusiness',
      required: true,
      index: true
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: SUPPLIER_SHIPMENT_STATUSES,
      default: 'draft',
      index: true
    },
    carrier: { type: String, trim: true, maxlength: 120, default: '' },
    trackingNumber: { type: String, trim: true, maxlength: 120, default: '' },
    dispatchDate: { type: Date },
    expectedArrivalDate: { type: Date },
    actualArrivalDate: { type: Date },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    delayReason: { type: String, trim: true, maxlength: 1000, default: '' },
    lines: { type: [shipmentLineSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] }
  },
  { timestamps: true }
);

supplierShipmentSchema.index({ purchaseOrder: 1, createdAt: -1 });
supplierShipmentSchema.index({ supplierBusiness: 1, status: 1, createdAt: -1 });

export type SupplierShipmentDoc = InferSchemaType<typeof supplierShipmentSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const SupplierShipment: Model<SupplierShipmentDoc> =
  mongoose.models.SupplierShipment ||
  mongoose.model<SupplierShipmentDoc>('SupplierShipment', supplierShipmentSchema);
