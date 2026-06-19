import mongoose from "mongoose";

const listItemSchema = new mongoose.Schema(
  {
    listGroupId: { type: mongoose.Schema.Types.ObjectId, ref: "ListGroup", required: true, index: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    title: { type: String, required: true, trim: true },
    details: { type: String, default: "" },
    price: { type: Number, default: null },
    currency: { type: String, default: "INR" },
    imageUrl: { type: String, default: "" },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

listItemSchema.index({ listGroupId: 1, active: 1 });
listItemSchema.index({ businessId: 1, active: 1 });

export const ListItem =
  mongoose.models.ListItem || mongoose.model("ListItem", listItemSchema);
