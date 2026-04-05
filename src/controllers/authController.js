import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import appleSignin from 'apple-signin-auth'; 
import { User } from '../models/User.js'; // 👈 Pointing to your new single User model

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// --- 1. GOOGLE AUTH ---
export const googleAuth = async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: "idToken is required." });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture, email_verified } = payload; 

    if (!email_verified) {
      return res.status(400).json({ error: "Google account email is not verified." });
    }

    // Look for existing user
    let user = await User.findOne({ email });

    if (user) {
      // Update existing user with latest Google info
      user.googleId = googleId;
      user.name = name || user.name;
      user.profilepic = picture || user.profilepic;
      await user.save();
    } else {
      // Create new doctor user
      user = new User({
        googleId,
        email,
        name,
        profilepic: picture,
      });
      await user.save();
    }

    // Generate token (No roles anymore!)
    const appToken = jwt.sign(
      { _id: user._id, email: user.email },
      process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET,
      { expiresIn: '30d' }
    );

    res.status(200).json({
      success: true,
      token: appToken,
      user: user.toObject(),
    });

  } catch (err) {
    console.error("❌ Google auth error:", err);
    res.status(500).json({ error: "Authentication failed." });
  }
};

// --- 2. APPLE AUTH ---
export const appleAuth = async (req, res) => {
  const { identityToken, email, firstName, lastName } = req.body;

  if (!identityToken) {
    return res.status(400).json({ error: "Identity token is required." });
  }

  try {
    // A. Verify Apple Token
    const appleIdTokenClaims = await appleSignin.verifyIdToken(identityToken, {
      ignoreExpiration: true, 
    });

    const { email: tokenEmail, sub: appleUserId } = appleIdTokenClaims;
    const finalEmail = tokenEmail || email;

    // We reuse the googleId field for Apple Sub ID to keep the schema simple
    let user = await User.findOne({ googleId: appleUserId }); 

    if (!user) {
        if (!finalEmail) {
            return res.status(400).json({ 
                error: "Email missing. Please revoke Apple Sign-in permissions and try again." 
            });
        }

        // Check if email exists to link accounts
        const existingUser = await User.findOne({ email: finalEmail });
        
        if (existingUser) {
            existingUser.googleId = appleUserId;
            await existingUser.save();
            user = existingUser;
        } else {
            // Create New User
            const name = (firstName && lastName) ? `${firstName} ${lastName}` : "Apple User";
            user = new User({
                googleId: appleUserId, 
                email: finalEmail,
                name: name,
                profilepic: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Apple_logo_white.svg/1010px-Apple_logo_white.svg.png", 
            });
            await user.save();
        }
    }

    // C. Generate Token
    const appToken = jwt.sign(
      { _id: user._id, email: user.email },
      process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET,
      { expiresIn: '30d' }
    );

    res.status(200).json({
      success: true,
      token: appToken,
      user: user.toObject(),
    });

  } catch (err) {
    console.error("❌ Apple auth error:", err);
    res.status(500).json({ error: "Apple authentication failed." });
  }
};

// --- 3. CHECK EMAIL ---
export const checkEmail = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required." });

  try {
    const user = await User.findOne({ email });
    // Stripped out all role logic, just returns if they exist
    return res.json({ exists: !!user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};