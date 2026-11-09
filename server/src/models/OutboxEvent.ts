import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * Transactional outbox — durable event log for notifications / customer-visible messages.
 * Writers insert here inside the same MongoDB transaction as the business commit.
 * A single processor delivers into the existing Notification / RepairMessage collections.
 */
const outboxEventSchema = new Schema(
  {
    channel: {
      type: String,
      enum: ['notification', 'repair_message'],
      required: true,
      index: true
    },
    /** Unique business key — prevents duplicate customer-visible deliveries. */
    dedupeKey: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'delivered', 'failed', 'dead'],
      default: 'pending',
      index: true
    },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    availableAt: { type: Date, default: Date.now },
    payload: { type: Schema.Types.Mixed, required: true },
    lastError: { type: String, default: '' },
    deliveredAt: { type: Date },
    orderingKey: { type: String, index: true },
    sequence: { type: Number, default: 0 }
  },
  { timestamps: true }
);

outboxEventSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);
outboxEventSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
outboxEventSchema.index({ orderingKey: 1, sequence: 1, createdAt: 1 });

export type OutboxEventDoc = InferSchemaType<typeof outboxEventSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const OutboxEvent: Model<OutboxEventDoc> =
  mongoose.models.OutboxEvent || mongoose.model<OutboxEventDoc>('OutboxEvent', outboxEventSchema);
