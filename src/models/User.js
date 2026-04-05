import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // Basic Auth
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    googleId: { type: String, unique: true, sparse: true },
    name: { type: String }, // Doctor's Name (e.g., Dr. Ali)
    profilepic: { type: String },

    // Clinic Identity
    clinicName: { type: String, default: "" }, // e.g., The Tooth Junction
    contactPhone: { type: String, default: "" },
    operatingHours: {
      open: { type: String, default: "09:00 AM" },
      close: { type: String, default: "10:00 PM" }
    },

    // Location / Address
// Location / Address
    address: {
      fullAddress: { type: String, default: "" },
      mapUrl: { type: String, default: "" } // For the iframe embed
    },

    // Notification Preferences
    preferences: {
      alertsEnabled: { type: Boolean, default: true },
      emailEnabled: { type: Boolean, default: true },
      whatsappEnabled: { type: Boolean, default: true }
    },
treatments: [{ type: String }], // e.g., ["Root Canal", "Teeth Whitening", "Consultation"]
    // Integrations Status (Booleans for UI, you can add tokens later if needed)
    integrations: {
      googleCalendar: { type: Boolean, default: false },
      whatsappApi: { type: Boolean, default: false },
      googleBusiness: { type: Boolean, default: false },
      googleAds: { type: Boolean, default: false } // 👈 YOU MUST ADD THIS!
    },
googleAdsDetails: {
  customerId: { type: String }, // The 10-digit ID
  refresh_token: { type: String },
  developerToken: { type: String, default: process.env.GOOGLE_ADS_DEVELOPER_TOKEN }
},
    
    googleCalendarTokens: {
      access_token: { type: String },
      refresh_token: { type: String },
      expiry_date: { type: Number }
    },
    whatsappApiDetails: {
      accessToken: { type: String },     // The long-lived token
      wabaId: { type: String },          // WhatsApp Business Account ID
      phoneNumberId: { type: String },   // The specific Phone Number ID used to send messages
    }
  },
  { timestamps: true }
);

export const User = mongoose.models.User || mongoose.model("User", userSchema);