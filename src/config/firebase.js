import admin from 'firebase-admin';
import { createRequire } from 'module'; // Needed to import JSON in ES Modules

const require = createRequire(import.meta.url);
const serviceAccount = require('../../serviceAccountKey.json'); // Adjust path to your JSON file

// Prevent multiple initializations
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

export const messaging = admin.messaging();
export default admin;