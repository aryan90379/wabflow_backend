import { GoogleAdsApi, enums } from 'google-ads-api';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/User.js';

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_ADS_CLIENT_ID,
  process.env.GOOGLE_ADS_CLIENT_SECRET,
  `${process.env.NEXT_PUBLIC_API_URL}/api/ads/callback`
);

// 1. Generate Auth URL for the Frontend
export const getAdsAuthUrl = async (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/adwords'],
    state: req.user._id.toString() 
  });
  res.json({ url });
};

// 2. Handle Google OAuth Callback
export const handleAdsCallback = async (req, res) => {
  try {
    const { code, state: userId } = req.query; 
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    if (!code) return res.redirect(`${frontendUrl}/ads?error=no_code`);

    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.refresh_token) {
      console.error("❌ No refresh token returned. User might need to re-consent.");
    }

    const updateData = {
      'integrations.googleAds': true,
      'googleAdsDetails.refresh_token': tokens.refresh_token,
      // Hardcoded for testing to guarantee it matches the Test Client Account
      'googleAdsDetails.customerId': "4062454707"
    };

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true });
    console.log("✅ Database Updated for User:", updatedUser.email);

    res.redirect(`${frontendUrl}/ads?success=true`); 

  } catch (error) {
    console.error("🔴 Fatal Ads Callback Error:", error.message);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/ads?error=auth_failed`);
  }
};

// 3. Get Campaign Metrics
export const getCampaignMetrics = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user.integrations.googleAds) return res.json({ metrics: null });

    const client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });

    const customer = client.Customer({
      // 🚀 FIXED: Hardcoded to Test Client to prevent the Permission Error
      customer_id: "4062454707", 
      refresh_token: user.googleAdsDetails.refresh_token,
      // 🚀 FIXED: Hardcoded to Test Manager ID
      login_customer_id: "1758646949",
    });

    const query = `
      SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions 
      FROM customer 
      WHERE segments.date DURING LAST_30_DAYS
    `;
    
    const response = await customer.query(query);
    
    let totals = { impressions: 0, clicks: 0, spend: 0, conversions: 0 };
    response.forEach(row => {
      totals.impressions += parseInt(row.metrics.impressions || 0);
      totals.clicks += parseInt(row.metrics.clicks || 0);
      totals.spend += parseInt(row.metrics.cost_micros || 0) / 1_000_000; 
      totals.conversions += parseFloat(row.metrics.conversions || 0);
    });

    res.json({ success: true, metrics: totals });
  } catch (error) {
    // Better error logging
    console.error("Metrics Fetch Error:", error?.errors?.[0]?.message || error.message);
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
};

// 4. The Ultimate Campaign Builder
export const launchAutomatedCampaign = async (req, res) => {
  try {
    const { budgetAmount, selectedTreatments } = req.body;
    const user = await User.findById(req.user._id);

    const client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });

    const customer = client.Customer({
      customer_id: "4062454707", 
      refresh_token: user.googleAdsDetails.refresh_token,
      login_customer_id: "1758646949",
    });

    // STEP 1 & 2: Create Budget & Campaign
    const budgetResource = await customer.campaignBudgets.create([{
      name: `DentFlow Auto Budget - ${Date.now()}`,
      amount_micros: budgetAmount * 1_000_000, 
      delivery_method: enums.BudgetDeliveryMethod.STANDARD
    }]);

const campaignResource = await customer.campaigns.create([{
      name: `Search: ${selectedTreatments.join(', ')} - ${Date.now()}`,
      advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
      status: enums.CampaignStatus.PAUSED, 
      campaign_budget: budgetResource.results[0].resource_name,
      
      network_settings: { 
        target_google_search: true, 
        target_search_network: false,
        target_content_network: false,
        target_partner_search_network: false
      },
      
      bidding_strategy_type: enums.BiddingStrategyType.MANUAL_CPC,
      manual_cpc: {},

      // 🚀 FIXED: Google strictly requires this exact string, not a boolean!
      contains_eu_political_advertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING'
    }]);
    
    const campaignId = campaignResource.results[0].resource_name;
// STEP 3: Iterate through selected treatments to build specific Ad Groups & Ads
    for (const treatment of selectedTreatments) {
      const adGroupResource = await customer.adGroups.create([{
        name: `${treatment} Auto-Group`,
        campaign: campaignId,
        status: enums.AdGroupStatus.ENABLED,
        type: enums.AdGroupType.SEARCH_STANDARD,
        // 🚀 FIXED: Google strictly REQUIRES a default bid on Ad Groups when using Manual CPC
        cpc_bid_micros: 5000000 // Sets a default bid of ₹5 (5 million micros)
      }]);
      const adGroupId = adGroupResource.results[0].resource_name;

    await customer.adGroupCriteria.create([
        // 🚀 FIXED: Removed brackets and quotes from the text strings.
        { ad_group: adGroupId, status: enums.AdGroupCriterionStatus.ENABLED, keyword: { text: `${treatment.toLowerCase()} near me`, match_type: enums.KeywordMatchType.EXACT } },
        { ad_group: adGroupId, status: enums.AdGroupCriterionStatus.ENABLED, keyword: { text: `${treatment.toLowerCase()} clinic`, match_type: enums.KeywordMatchType.PHRASE } }
      ]);

      const safeHeadline1 = `Top Rated ${treatment}`.substring(0, 30);
      const safeHeadline2 = `Book Dr. ${user.name ? user.name.split(' ')[0] : 'Now'}`.substring(0, 30);
      const safeHeadline3 = `${user.clinicName || 'Dental'} Experts`.substring(0, 30);
      
      const safeDesc1 = `Need a ${treatment}? ${user.clinicName || 'Our clinic'} is accepting new patients. Book today!`.substring(0, 90);
      const safeDesc2 = `Expert dental care in your area. Comfortable, fast, and highly rated.`.substring(0, 90);

      // STEP 4: Generate Responsive Search Ads
      await customer.adGroupAds.create([{
        ad_group: adGroupId,
        status: enums.AdGroupAdStatus.ENABLED,
        ad: {
          // 🚀 FIXED: Hardcoded URL so it doesn't fail if FRONTEND_URL is missing
          final_urls: [`https://zenithlab.com/booking/${user._id}`], 
          responsive_search_ad: {
            headlines: [
              { text: safeHeadline1, pinned_field: enums.ServedAssetFieldType.HEADLINE_1 },
              { text: safeHeadline2 },
              { text: safeHeadline3 }
            ],
            descriptions: [
              { text: safeDesc1 },
              { text: safeDesc2 }
            ]
          }
        }
      }]);
    }

    res.json({ success: true, message: "Full campaign structure launched!" });
  } catch (error) {
    // 🚀 FIXED: Deeply extracts the EXACT missing field name from Google's complex error object
    let errorMessage = "Unknown API Error";
    if (error?.errors && error.errors.length > 0) {
      const err = error.errors[0];
      // Grabs the exact field path (e.g., 'campaign.manual_cpc')
      const fieldPath = err.location?.field_path_elements?.map(e => e.field_name).join('.') || 'unknown_field';
      errorMessage = `${err.message} (Missing/Invalid Field: ${fieldPath})`;
    } else {
      errorMessage = error.message;
    }

    console.error("🔴 Detailed Campaign Launch Error:", JSON.stringify(error?.errors || error, null, 2));
    res.status(500).json({ error: errorMessage });
  }
};