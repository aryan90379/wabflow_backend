export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: "Route not found." });
}

export function errorHandler(error, req, res, next) {
  console.error("[error]", {
    method: req.method,
    path: req.originalUrl,
    message: error.message,
    meta: error.meta,
    stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
  });

  if (res.headersSent) return next(error);

  if (error?.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      error: "Validation failed.",
      details: Object.values(error.errors).map((item) => item.message),
    });
  }

  if (error?.code === 11000) {
    return res.status(409).json({ success: false, error: "A record with these values already exists." });
  }

  res.status(error.status || 500).json({
    success: false,
    error: error.message || "Internal server error.",
    ...(error.meta ? { meta: error.meta } : {}),
  });
}
