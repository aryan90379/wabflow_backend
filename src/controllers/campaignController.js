import { Campaign } from '../models/Campaign.js';
import path from 'path';
import fs from 'fs';

export const getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ doctorId: req.user._id }).sort({ createdAt: -1 });
    res.status(200).json(campaigns);
  } catch (error) {
    console.error("Fetch campaigns error:", error);
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
};

export const createCampaign = async (req, res) => {
  try {
    // Add fallback {} to prevent destructuring crashes
    const { title, type, description, link, imageBase64 } = req.body || {};
    let imageUrl = '';

    // If an image was sent as Base64, decode and save it
    if (imageBase64) {
      const matches = imageBase64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const filename = `img-${Date.now()}-${Math.round(Math.random() * 1E9)}.${ext}`;
        
        const cdnDir = path.join(process.cwd(), 'cdn');
        if (!fs.existsSync(cdnDir)) {
          fs.mkdirSync(cdnDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(cdnDir, filename), buffer);
        imageUrl = `/cdn/${filename}`;
      }
    }

    const newCampaign = await Campaign.create({
      doctorId: req.user._id,
      title,
      type: type || 'WhatsApp Broadcast',
      description,
      link,
      imageUrl,
      status: 'active',
      sent: 0,
      repliesCount: 0,
      booked: 0
    });

    res.status(201).json({ success: true, campaign: newCampaign });
  } catch (error) {
    console.error("Create campaign error:", error);
    res.status(500).json({ error: "Failed to create campaign" });
  }
};