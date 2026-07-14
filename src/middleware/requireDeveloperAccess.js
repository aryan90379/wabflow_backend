const developerEmails = new Set(
  (process.env.DEVELOPER_ACCESS_EMAILS || "songrimleader@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

export const requireDeveloperAccess = (req, res, next) => {
  const emails = [req.user?.email, req.user?.googleEmail, req.user?.appleEmail]
    .map((email) => String(email || "").trim().toLowerCase())
    .filter(Boolean);

  if (req.authType !== "owner" || !emails.some((email) => developerEmails.has(email))) {
    return res.status(403).json({ error: "Developer access required" });
  }

  next();
};
