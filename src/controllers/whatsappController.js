import { User } from '../models/User.js';

export const connectWhatsApp = async (req, res) => {
  console.log("\n==========================================");
  console.log("--- Starting WhatsApp Connection Flow ---");
  
  const loginCode = req.body?.code; 
  if (!loginCode) return res.status(400).json({ error: "Missing auth code from frontend" });

  try {
    const appId = process.env.META_APP_ID; 
    const appSecret = process.env.META_APP_SECRET; 
    
    // Step 1 & 2: Token Exchange
    const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=&code=${loginCode}`);
    const tokenData = await tokenRes.json();
    
    const longTokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`);
    const longTokenData = await longTokenRes.json();
    const validAccessToken = longTokenData.access_token;

    // Step 3: Extract WABA ID
    const debugRes = await fetch(`https://graph.facebook.com/v19.0/debug_token?input_token=${validAccessToken}&access_token=${appId}|${appSecret}`);
    const debugData = await debugRes.json();
    const wabaScope = debugData.data.granular_scopes?.find(s => s.scope === "whatsapp_business_management");
    const wabaId = wabaScope.target_ids[0];

    // Step 4: Extract Phone Number ID
    const phoneRes = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?access_token=${validAccessToken}`);
    const phoneData = await phoneRes.json();
    const phoneNumberId = phoneData.data[0].id;
    console.log(`✅ Phone Number ID found: ${phoneNumberId}`);

    // 🔥 THE MISSING LINK: REGISTER THE NUMBER TO CLEAR 'PENDING'
    console.log("[Step 5] Registering number to clear 'Pending' status...");
    const generatedPin = "123456"; // Meta requires a 6-digit PIN for 2FA to activate the number
    
    const registerRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/register`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${validAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        pin: generatedPin
      })
    });
    
    const registerData = await registerRes.json();
    if (!registerRes.ok) throw new Error(`Registration API failed: ${JSON.stringify(registerData)}`);
    console.log("✅ Number officially REGISTERED and CONNECTED!");

    // Step 6: Save to DB and fully activate
    const userId = req.user?.id || req.user?._id;
    await User.findByIdAndUpdate(userId, {
      whatsappApiDetails: { 
        accessToken: validAccessToken, 
        wabaId, 
        phoneNumberId,
        pin: generatedPin // Save this in case you ever need to deregister via API
      },
      'integrations.whatsappApi': true,      // It is officially live!
      'integrations.whatsappPending': false 
    });

    console.log("==========================================\n");
    // Just return success to the frontend
    res.status(200).json({ success: true, message: "WhatsApp fully connected!" });

  } catch (error) {
    console.error("❌ WhatsApp Connect Error:", error.message);
    res.status(500).json({ error: error.message });
  }
};