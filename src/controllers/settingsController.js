import { User } from '../models/User.js';

export const getSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json({ success: true, settings: user });
  } catch (error) {
    console.error("Fetch settings error:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const { name, clinicName, contactPhone, operatingHours, address, preferences ,treatments} = req.body;
    
    // We update the specific fields to avoid overwriting unrelated data
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { 
        $set: {
          name,
          clinicName,
          contactPhone,
          operatingHours,
          address,
          preferences,
          treatments // 👇 2. ADD 'treatments' to the database save object
        }
      },
      { new: true, runValidators: true }
    );

    if (!updatedUser) return res.status(404).json({ error: "User not found" });
    res.status(200).json({ success: true, settings: updatedUser });
  } catch (error) {
    console.error("Update settings error:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
};