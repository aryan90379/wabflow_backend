import mongoose from "mongoose";

const qrDailyScanSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { _id: false }
);

const qrRecentScanSchema = new mongoose.Schema(
  {
    scannedAt: { type: Date, default: Date.now },
    userAgent: { type: String, default: "" },
    referer: { type: String, default: "" },
  },
  { _id: false }
);

const qrShortLinkSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    whatsappAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsappAccount", default: null, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    title: { type: String, default: "Bot QR Code", trim: true },
    phoneNumber: { type: String, required: true, trim: true },
    starterMessage: { type: String, default: "Hi, I would like to know more." },
    active: { type: Boolean, default: true, index: true },
    disabledAt: { type: Date, default: null },
    scanCount: { type: Number, default: 0 },
    lastScannedAt: { type: Date, default: null },
    dailyScans: { type: [qrDailyScanSchema], default: [] },
    recentScans: { type: [qrRecentScanSchema], default: [] },
  },
  { timestamps: true }
);

qrShortLinkSchema.index({ businessId: 1, createdAt: -1 });
qrShortLinkSchema.index({ businessId: 1, whatsappAccountId: 1, createdAt: -1 });

export const QrShortLink =
  mongoose.models.QrShortLink || mongoose.model("QrShortLink", qrShortLinkSchema);
