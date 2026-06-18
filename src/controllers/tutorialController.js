import { Tutorial } from "../models/Tutorial.js";

// @route   GET /api/tutorials
export const getTutorials = async (req, res) => {
  const tutorials = await Tutorial.find().sort({ createdAt: -1 });
  // Map _id to id for the frontend
  const formatted = tutorials.map(t => ({
    id: t._id.toString(),
    title: t.title,
    description: t.description,
    url: t.url,
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
    title: t.title,
    description: t.description,
    url: t.url,
    thumbnail: t.thumbnail,
    createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
  }));
  
  if (docs.length > 0) {
    await Tutorial.insertMany(docs);
  }

  res.json({ success: true });
};
