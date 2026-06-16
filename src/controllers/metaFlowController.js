import { WhatsappAccount } from "../models/index.js";
import { createFlow, updateFlowAssets, publishFlow, generateBookingFlowJson } from "../services/metaFlowService.js";

export const generateBookingFlow = async (req, res) => {
  const { businessId } = req.params;
  const { config, name } = req.body;

  // Find WhatsappAccount
  const account = await WhatsappAccount.findOne({ businessId, active: true });
  if (!account) {
    return res.status(404).json({ error: "No active WhatsApp account found." });
  }

  try {
    const flowName = name || `Booking Flow ${Date.now()}`;
    const flowCreated = await createFlow(account.wabaId, account.systemAccessToken || account.accessToken, flowName);
    
    const flowJson = generateBookingFlowJson(config);
    await updateFlowAssets(flowCreated.id, account.systemAccessToken || account.accessToken, flowJson);
    
    await publishFlow(flowCreated.id, account.systemAccessToken || account.accessToken);

    res.json({ success: true, flowId: flowCreated.id });
  } catch (error) {
    console.error("Meta Flow Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to generate Meta Flow.", details: error.response?.data });
  }
};
