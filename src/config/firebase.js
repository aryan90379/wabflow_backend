import admin from "firebase-admin";

// Initialize Firebase Admin SDK
// You will need to set FIREBASE_SERVICE_ACCOUNT_BASE64 in your environment variables
// This should be the base64 encoded version of your service-account.json file
// Or you can initialize with default application credentials if running on GCP
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin initialized successfully.");
  } else {
    // If not set, we can still initialize it if we're in GCP, or we just log a warning
    admin.initializeApp();
    console.log("Firebase Admin initialized with default credentials.");
  }
} catch (error) {
  console.error("Failed to initialize Firebase Admin:", error);
}

export const messaging = admin.messaging();
export default admin;
