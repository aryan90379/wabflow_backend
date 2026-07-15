import { Tutorial } from "../models/Tutorial.js";

// @route   GET /api/tutorials
export const getTutorials = async (req, res) => {
  const tutorials = await Tutorial.find().sort({ createdAt: -1 });
  // Map _id to id for the frontend
  const formatted = tutorials.map(t => ({
    id: t._id.toString(),
    title: t.titleEn || t.title || "",
    description: t.descriptionEn || t.description || "",
    url: t.urlEn || t.url || "",
    titleEn: t.titleEn || t.title || "",
    titleHi: t.titleHi || t.titleEn || t.title || "",
    descriptionEn: t.descriptionEn || t.description || "",
    descriptionHi: t.descriptionHi || t.descriptionEn || t.description || "",
    urlEn: t.urlEn || t.url || "",
    urlHi: t.urlHi || t.urlEn || t.url || "",
    thumbnail: t.thumbnail,
    createdAt: new Date(t.createdAt).getTime(),
  }));
  res.json({ success: true, data: formatted });
};

// @route   POST /api/tutorials
export const updateTutorials = async (req, res) => {
  const { tutorials } = req.body;
  
  if (!Array.isArray(tutorials)) {
    return res.status(400).json({ success: false, message: "Invalid data format" });
  }

  // Check if admin
  const user = req.user;
  if (
    user?.email !== "songrimleader@gmail.com" &&
    user?.googleEmail !== "songrimleader@gmail.com" &&
    user?.appleEmail !== "songrimleader@gmail.com"
  ) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  // Clear existing tutorials
  await Tutorial.deleteMany({});
  
  // Insert new list
  const docs = tutorials.map(t => ({
    title: String(t.titleEn || t.title || "").trim(),
    titleEn: String(t.titleEn || t.title || "").trim(),
    titleHi: String(t.titleHi || t.titleEn || t.title || "").trim(),
    description: String(t.descriptionEn || t.description || "").trim(),
    descriptionEn: String(t.descriptionEn || t.description || "").trim(),
    descriptionHi: String(t.descriptionHi || t.descriptionEn || t.description || "").trim(),
    url: String(t.urlEn || t.url || "").trim(),
    urlEn: String(t.urlEn || t.url || "").trim(),
    urlHi: String(t.urlHi || t.urlEn || t.url || "").trim(),
    thumbnail: t.thumbnail,
    createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
  }));
  
  if (docs.length > 0) {
    await Tutorial.insertMany(docs);
  }

  res.json({ success: true });
};
