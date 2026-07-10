const ROLE_PERMISSION_DEFAULTS = {
  owner: {
    inbox: { view: true, reply: true, manage: true },
    team: { view: true, create: true, edit: true, revoke: true, resetPassword: true },
    settings: { view: true, edit: true },
    flows: { view: true, create: true, edit: true },
  },
  admin: {
    inbox: { view: true, reply: true, manage: true },
    team: { view: true, create: true, edit: true, revoke: true, resetPassword: true },
    settings: { view: true, edit: true },
    flows: { view: true, create: true, edit: true },
  },
  manager: {
    inbox: { view: true, reply: true, manage: true },
    team: { view: true, create: false, edit: false, revoke: false, resetPassword: false },
    settings: { view: true, edit: false },
    flows: { view: true, create: false, edit: false },
  },
  agent: {
    inbox: { view: true, reply: true, manage: false },
    team: { view: false, create: false, edit: false, revoke: false, resetPassword: false },
    settings: { view: false, edit: false },
    flows: { view: true, create: false, edit: false },
  },
  viewer: {
    inbox: { view: true, reply: false, manage: false },
    team: { view: false, create: false, edit: false, revoke: false, resetPassword: false },
    settings: { view: false, edit: false },
    flows: { view: true, create: false, edit: false },
  },
};

function mergePermissionSection(defaults = {}, overrides = {}) {
  return {
    ...defaults,
    ...(overrides || {}),
  };
}

export function permissionsForRole(role = "viewer", overrides = {}) {
  const defaults = ROLE_PERMISSION_DEFAULTS[role] || ROLE_PERMISSION_DEFAULTS.viewer;
  return Object.fromEntries(
    Object.entries(defaults).map(([section, values]) => [
      section,
      mergePermissionSection(values, overrides?.[section]),
    ])
  );
}

export function fullPermissions() {
  return permissionsForRole("admin");
}
