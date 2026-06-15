export function requirePermission(permissionPath) {
  return (req, res, next) => {
    if (req.authType === "owner") {
      return next();
    }

    if (req.authType === "staff") {
      if (!req.permissions) {
        return res.status(403).json({ success: false, error: "Access denied. No permissions." });
      }

      // permissionPath like 'inbox.reply'
      const parts = permissionPath.split(".");
      let current = req.permissions;

      for (const part of parts) {
        if (current[part] === undefined) {
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
