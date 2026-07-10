export function requirePermission(permissionPath) {
  return (req, res, next) => {
    // Owners always have full access
    if (req.authType === "owner") {
      return next();
    }

    if (req.authType === "staff") {
      if (!req.permissions) {
        return res.status(403).json({ success: false, error: "Access denied. No permissions." });
      }

      // permissionPath like 'flows.view' or 'inbox.reply'
      const parts = permissionPath.split(".");
      let current = req.permissions;

      for (const part of parts) {
        // If the key doesn't exist (e.g. old members missing 'flows'), treat as false
        if (current === null || current === undefined || typeof current !== 'object') {
          return res.status(403).json({ success: false, error: `Access denied. Missing permission: ${permissionPath}` });
        }
        if (!(part in current) || current[part] === undefined) {
          return res.status(403).json({ success: false, error: `Access denied. Missing permission: ${permissionPath}` });
        }
        current = current[part];
      }

      if (current === true) {
        return next();
      }

      return res.status(403).json({ success: false, error: `Access denied. Requires permission: ${permissionPath}` });
    }

    return res.status(401).json({ success: false, error: "Access denied. Invalid auth type." });
  };
}
