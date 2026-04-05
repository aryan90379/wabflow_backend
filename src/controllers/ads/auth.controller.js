import { OAuth2Client } from 'google-auth-library';
import { User } from '../../models/User.js';

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_ADS_CLIENT_ID,
  process.env.GOOGLE_ADS_CLIENT_SECRET,
  `${process.env.NEXT_PUBLIC_API_URL}/api/ads/callback`
);

export const getAdsAuthUrl = async (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/adwords'],
    state: req.user._id.toString() 
  });
  res.json({ url });
};

export const handleAdsCallback = async (req, res) => {
  try {
    const { code, state: userId } = req.query; 
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    if (!code) return res.redirect(`${frontendUrl}/ads?error=no_code`);

    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.refresh_token) {
      console.error("❌ No refresh token returned. User might need to re-consent.");
    }

    const updateData = {
      'integrations.googleAds': true,
      'googleAdsDetails.refresh_token': tokens.refresh_token,
      'googleAdsDetails.customerId': "4062454707" // Hardcoded Test Client
    };

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true });
    console.log("✅ Database Updated for User:", updatedUser.email);

    res.redirect(`${frontendUrl}/ads?success=true`); 

  } catch (error) {
    console.error("🔴 Fatal Ads Callback Error:", error.message);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/ads?error=auth_failed`);
  }
};