import express from "express";
import bodyParser from "body-parser";
import connectDB from "./src/config/db.js";
import "dotenv/config";

// --- IMPORT YOUR ROUTES HERE ---
import settingsRoutes from "./src/routes/settingsRoutes.js";
import authRoutes from "./src/routes/authRoutes.js"; // 👈 ADD THIS
import calendarRoutes from "./src/routes/calendarRoutes.js"; // 👈 ADD THIS
import campaignRoutes from "./src/routes/campaignRoutes.js"; // 👈 ADD THIS

import appointmentRoutes from "./src/routes/appointmentRoutes.js"; // 👈 ADD THIS
import patientRoutes from "./src/routes/patientRoutes.js";
import whatsappBotRoutes from "./src/routes/whatsappBotRoutes.js";

import adsRoutes from './src/routes/adsRoutes.js'; // 👈 Import the new Ads routes

connectDB();
const app = express();
import path from 'path';
import { fileURLToPath } from 'url';

// Setup __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));

app.use('/api/appointments', appointmentRoutes); // 👈 ADD THIS
// Expose the cdn folder to the public
app.use('/cdn', express.static(path.join(__dirname, 'cdn')));
// --- MOUNT YOUR ROUTES HERE ---
app.use('/api/campaigns', campaignRoutes); // 👈 ADD THIS
app.use('/api/settings', settingsRoutes);
app.use('/api/auth', authRoutes); // 👈 ADD THIS SO /api/auth/google WORKS
app.use('/api/calendar', calendarRoutes); // Mount it below your other routes
// Database
app.use('/api/patients', patientRoutes);
app.use('/api/ads', adsRoutes); // 👈 Mount the Ads routes here

app.use("/api/whatsapp", whatsappBotRoutes);

// Simple test route
app.get("/", async (req, res) => {
  res.setHeader("Content-Type", "text/plain");

  const text = `
███████╗██████╗ ██╗
██╔════╝██╔══██╗██║
█████╗  ██████╔╝██║
██╔══╝  ██╔══██╗██║
███████╗██║  ██║██║
╚══════╝╚═╝  ╚═╝╚═╝

🚫 API ZONE 🚫

Bro what are you doing here 👀

This is an API endpoint.
Not a tourist attraction.


`;

  for (const char of text) {
    res.write(char);
    await new Promise(r => setTimeout(r, 5)); // animation speed
  }

  res.end();
});

// Server
const PORT = process.env.PORT || 4080;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});