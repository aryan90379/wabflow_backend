import { StaffSession } from "../models/StaffSession.js";

/**
 * Register or update the push notification token for the current staff session.
 */
export const registerPushToken = async (req, res) => {
  try {
    const { pushToken } = req.body;
    
    if (!pushToken) {
      return res.status(400).json({ success: false, message: "pushToken is required" });
    }

    if (req.authType === "staff" && req.sessionId) {
      const session = await StaffSession.findOne({ sessionId: req.sessionId, status: "active" });
      
      if (!session) {
        return res.status(404).json({ success: false, message: "Active session not found" });
      }

      session.pushToken = pushToken;
      await session.save();

      return res.status(200).json({ success: true, message: "Push token registered successfully." });
    } else {
      // For owners or if no sessionId, we might not have a StaffSession right now,
      // but if owners also get StaffSession in the future, we handle it here.
      return res.status(400).json({ success: false, message: "Push notifications only supported for staff sessions currently." });
    }
  } catch (error) {
    console.error("[DeviceController] Error registering push token:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
