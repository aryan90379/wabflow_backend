import mongoose from "mongoose";

const listGroupSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

listGroupSchema.index({ businessId: 1, active: 1 });

export const ListGroup =
  mongoose.models.ListGroup || mongoose.model("ListGroup", listGroupSchema);
