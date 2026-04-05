export const apiKeyAuth = (req, res, next) => {
  // Look for the key in the request headers
  const providedKey = req.headers['x-api-key'];
  
  // The master key stored securely in your .env file
  const validKey = process.env.SCRAPER_API_KEY;

  if (!providedKey || providedKey !== validKey) {
    console.warn(`Blocked unauthorized scraping attempt from IP: ${req.ip}`);
    return res.status(403).json({ error: "Forbidden: Invalid or missing API key" });
  }

  next(); // Key is valid, proceed to the controller
};