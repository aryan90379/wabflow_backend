import mongoose from "mongoose";

const whatsappAccountSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    wabaId: { type: String, required: true, index: true },
    phoneNumberId: { type: String, required: true, unique: true, index: true },
    displayPhoneNumber: { type: String, default: "" },
    verifiedName: { type: String, default: "" },
    profileDisplayName: { type: String, default: "" },
    profileAbout: { type: String, default: "" },
    profileDescription: { type: String, default: "" },
    profilePictureUrl: { type: String, default: "" },
    encryptedValue: { type: String, required: true, select: false },
    encryptionIv: { type: String, required: true, select: false },
    encryptionTag: { type: String, required: true, select: false },
    encryptedFlowPrivateKey: { type: String, default: "", select: false },
    flowPrivateKeyIv: { type: String, default: "", select: false },
    flowPrivateKeyTag: { type: String, default: "", select: false },
    flowPublicKeySetAt: { type: Date, default: null },
    tokenType: { type: String, default: "" },
    tokenExpiresAt: { type: Date, default: null },
    connectedAt: { type: Date, default: Date.now },
    lastWebhookAt: { type: Date, default: null },
    bookingFlowId: { type: String, default: null },
    bookingFlowConfigId: { type: String, default: null },
    status: {
      type: String,
      enum: ["active", "disconnected", "error"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

whatsappAccountSchema.index({ businessId: 1, status: 1 });

export const WhatsappAccount =
  mongoose.models.WhatsappAccount || mongoose.model("WhatsappAccount", whatsappAccountSchema);
