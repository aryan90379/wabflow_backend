import { AppContent } from "../models/AppContent.js";

const META_CONNECT_KEY = "meta_connect_tutorial";
const LISTS_TUTORIAL_KEY = "lists_tutorial";

const normalizeMetaConnectContent = (value = {}) => ({
  videoUrlEn: String(value.videoUrlEn || "").trim(),
  videoUrlHi: String(value.videoUrlHi || "").trim(),
});

const normalizeListsTutorialContent = (value = {}) => ({
  titleEn: String(value.titleEn || "").trim(),
  titleHi: String(value.titleHi || "").trim(),
  videoUrlEn: String(value.videoUrlEn || "").trim(),
  videoUrlHi: String(value.videoUrlHi || "").trim(),
});

export const getMetaConnectContent = async (_req, res) => {
  const content = await AppContent.findOne({ key: META_CONNECT_KEY }).lean();

  res.json({
    success: true,
    data: normalizeMetaConnectContent(content?.value),
  });
};

export const updateMetaConnectContent = async (req, res) => {
  const value = normalizeMetaConnectContent(req.body);

  const content = await AppContent.findOneAndUpdate(
    { key: META_CONNECT_KEY },
    { $set: { value } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  res.json({
    success: true,
    data: normalizeMetaConnectContent(content?.value),
  });
};

export const getListsTutorialContent = async (_req, res) => {
  const content = await AppContent.findOne({ key: LISTS_TUTORIAL_KEY }).lean();

  res.json({
    success: true,
    data: normalizeListsTutorialContent(content?.value),
  });
};

export const updateListsTutorialContent = async (req, res) => {
  const value = normalizeListsTutorialContent(req.body);

  const content = await AppContent.findOneAndUpdate(
    { key: LISTS_TUTORIAL_KEY },
    { $set: { value } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  res.json({
    success: true,
    data: normalizeListsTutorialContent(content?.value),
  });
};
