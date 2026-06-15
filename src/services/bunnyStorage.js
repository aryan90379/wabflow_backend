import axios from "axios";

const BUNNY_BASE_URL =
  process.env.BUNNY_STORAGE_BASE_URL || "https://uk.storage.bunnycdn.com";

export const uploadToBunny = async (fileBuffer, fileName, folder = "uploads") => {
  if (!process.env.BUNNY_STORAGE_ZONE) {
    throw new Error("BUNNY_STORAGE_ZONE is missing.");
  }

  if (!process.env.BUNNY_API_KEY) {
    throw new Error("BUNNY_API_KEY is missing.");
  }

  if (!process.env.BUNNY_CDN_URL) {
    throw new Error("BUNNY_CDN_URL is missing.");
  }

  const cleanFolder = String(folder || "uploads").replace(/^\/+|\/+$/g, "");
  const cleanFileName = String(fileName || `${Date.now()}.bin`).replace(
    /[^a-zA-Z0-9._-]/g,
    "-"
  );

  const storageUrl = `${BUNNY_BASE_URL}/${process.env.BUNNY_STORAGE_ZONE}/${cleanFolder}/${cleanFileName}`;

  try {
    await axios.put(storageUrl, fileBuffer, {
      headers: {
        AccessKey: process.env.BUNNY_API_KEY,
        "Content-Type": "application/octet-stream",
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  } catch (error) {
    console.error("[BunnyCDN Upload Error]", error.response?.data || error.message);
    const err = new Error("Failed to upload file to storage.");
    err.status = 502;
    throw err;
  }

  return `${process.env.BUNNY_CDN_URL}/${cleanFolder}/${cleanFileName}`;
};

export const deleteFromBunny = async (fileName, folder = "uploads") => {
  if (!process.env.BUNNY_STORAGE_ZONE) {
    throw new Error("BUNNY_STORAGE_ZONE is missing.");
  }

  if (!process.env.BUNNY_API_KEY) {
    throw new Error("BUNNY_API_KEY is missing.");
  }

  const cleanFolder = String(folder || "uploads").replace(/^\/+|\/+$/g, "");
  const cleanFileName = String(fileName || "").replace(/[^a-zA-Z0-9._-]/g, "-");

  if (!cleanFileName) {
    throw new Error("fileName is required.");
  }

  const storageUrl = `${BUNNY_BASE_URL}/${process.env.BUNNY_STORAGE_ZONE}/${cleanFolder}/${cleanFileName}`;

  try {
    await axios.delete(storageUrl, {
      headers: {
        AccessKey: process.env.BUNNY_API_KEY,
      },
    });
  } catch (error) {
    console.error("[BunnyCDN Delete Error]", error.response?.data || error.message);
    const err = new Error("Failed to delete file from storage.");
    err.status = 502;
    throw err;
  }

  return true;
};

export const fileNameFromUrl = (url) => {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return String(url).split("/").filter(Boolean).pop() || "";
  }
};
