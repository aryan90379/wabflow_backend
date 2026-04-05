import { google } from 'googleapis';
import { User } from '../models/User.js';
import jwt from 'jsonwebtoken';

// Setup the OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.NEXT_PUBLIC_API_URL || "https://api.instasnap.tech"}/api/calendar/callback` // MUST match exactly in Google Cloud Console
);

// 1. Generate the URL for the user to click
export const getCalendarAuthUrl = async (req, res) => {
  try {
    // We pass the user's current Auth token as the "state" so we remember who they are after Google redirects them back
    const authHeader = req.headers.authorization;
    const token = authHeader.split(' ')[1];

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Critical: Gets us the refresh token
      prompt: 'consent', // Forces the consent screen to ensure we get a refresh token
      scope: ['https://www.googleapis.com/auth/calendar.events'], // Permission to read/write events
      state: token, 
    });

    res.status(200).json({ url });
  } catch (error) {
    console.error("Error generating auth url:", error);
    res.status(500).json({ error: "Failed to generate auth url" });
  }
};

// 2. Handle the redirect back from Google
export const handleCalendarCallback = async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect('http://localhost:3000/settings?calendar=error');
  }

  try {
    // Decode the state to figure out which user this is
    const secret = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
    const decodedUser = jwt.verify(state, secret);

    // Exchange the code for the actual tokens
    const { tokens } = await oauth2Client.getToken(code);

    // Save tokens and flip the integration switch to true
    await User.findByIdAndUpdate(decodedUser._id, {
      googleCalendarTokens: tokens,
      'integrations.googleCalendar': true
    });

    // Send them back to the Next.js frontend
    res.redirect('http://localhost:3000/settings?calendar=success');
  } catch (err) {
    console.error("Calendar callback error:", err);
    res.redirect('http://localhost:3000/settings?calendar=error');
  }
};