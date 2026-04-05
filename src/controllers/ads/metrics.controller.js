import { GoogleAdsApi } from 'google-ads-api';
import { User } from '../../models/User.js';
import { generateInsights } from '../../services/insightsService.js';

export const getAdvancedMetrics = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user.integrations.googleAds) return res.json({ metrics: null });

    const client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });

    const customer = client.Customer({
      customer_id: "4062454707", // Test Client
      refresh_token: user.googleAdsDetails.refresh_token,
      login_customer_id: "1758646949", // Test Manager
    });

    // QUERY 1: Overall Account Metrics (What you already had)
    const metricsQuery = `
      SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion
      FROM customer 
      WHERE segments.date DURING LAST_30_DAYS
    `;
    
    // QUERY 2: Individual Campaign Details (NEW 🔥)
    const campaignsQuery = `
      SELECT 
        campaign.id, 
        campaign.name, 
        campaign.status, 
        campaign_budget.amount_micros,
        metrics.clicks,
        metrics.cost_micros
      FROM campaign 
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.id DESC
      LIMIT 10
    `;

    // Run both queries at the same time for speed
    const [metricsResponse, campaignsResponse] = await Promise.all([
      customer.query(metricsQuery),
      customer.query(campaignsQuery)
    ]);
    
    // Format Overall Metrics
    let totals = { impressions: 0, clicks: 0, spend: 0, conversions: 0 };
    let averages = { ctr: 0, cpc: 0, cpa: 0 };

    if (metricsResponse.length > 0) {
      const row = metricsResponse[0].metrics;
      totals.impressions = parseInt(row.impressions || 0);
      totals.clicks = parseInt(row.clicks || 0);
      totals.spend = parseInt(row.cost_micros || 0) / 1_000_000;
      totals.conversions = parseFloat(row.conversions || 0);
      averages.ctr = parseFloat(row.ctr || 0) * 100;
      averages.cpc = parseInt(row.average_cpc || 0) / 1_000_000;
      averages.cpa = parseInt(row.cost_per_conversion || 0) / 1_000_000;
    }

    // Format Campaign List
    const campaignsList = campaignsResponse.map(row => ({
      id: row.campaign.id,
      name: row.campaign.name,
      status: row.campaign.status, // Usually 'ENABLED' or 'PAUSED'
      budget: parseInt(row.campaign_budget?.amount_micros || 0) / 1_000_000,
      spend: parseInt(row.metrics?.cost_micros || 0) / 1_000_000,
      clicks: parseInt(row.metrics?.clicks || 0)
    }));

    const insights = generateInsights(totals, averages);

    // Send the campaigns list back with the rest of the metrics
    res.json({ success: true, metrics: { totals, averages, insights, campaigns: campaignsList } });
  } catch (error) {
    console.error("Metrics Fetch Error:", error?.errors?.[0]?.message || error.message);
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
};