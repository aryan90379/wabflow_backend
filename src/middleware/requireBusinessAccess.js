import mongoose from "mongoose";
import { Business } from "../models/Business.js";

export async function requireBusinessAccess(req, res, next) {
  try {
    const businessId = req.params.businessId || req.body.businessId || req.query.businessId;

    if (!businessId || !mongoose.isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, error: "Valid businessId is required." });
    }

    let business;
    if (req.authType === "staff") {
      if (req.businessId.toString() !== businessId.toString()) {
        return res.status(403).json({ success: false, error: "Access denied." });
      }
      business = await Business.findOne({ _id: businessId, active: true });
    } else {
      business = await Business.findOne({ _id: businessId, ownerId: req.userId, active: true });
    }
    
    if (!business) {
      return res.status(404).json({ success: false, error: "Business not found or access denied." });
    }

    req.business = business;
    next();
  } catch (error) {
    next(error);
  }
}
