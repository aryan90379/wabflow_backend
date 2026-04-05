import { GoogleAdsApi, enums } from 'google-ads-api';
import { User } from '../../models/User.js';

export const launchAutomatedCampaign = async (req, res) => {
  try {
    // 🚀 Now accepting location from the new Advanced Builder
    const { budgetAmount, selectedTreatments, location = 'Mumbai' } = req.body;
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

    const budgetResource = await customer.campaignBudgets.create([{
      name: `Auto Budget: ${location} - ${Date.now()}`,
      amount_micros: budgetAmount * 1_000_000, 
      delivery_method: enums.BudgetDeliveryMethod.STANDARD
    }]);

    const campaignResource = await customer.campaigns.create([{
      name: `Search: ${selectedTreatments.join(', ')} (${location}) - ${Date.now()}`,
      advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
      status: enums.CampaignStatus.PAUSED, 
      campaign_budget: budgetResource.results[0].resource_name,
      network_settings: { 
        target_google_search: true, target_search_network: false, target_content_network: false, target_partner_search_network: false
      },
      bidding_strategy_type: enums.BiddingStrategyType.MANUAL_CPC,
      manual_cpc: {},
      contains_eu_political_advertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING'
    }]);

    const campaignId = campaignResource.results[0].resource_name;

    for (const treatment of selectedTreatments) {
      const adGroupResource = await customer.adGroups.create([{
        name: `${treatment} Auto-Group`,
        campaign: campaignId,
        status: enums.AdGroupStatus.ENABLED,
        type: enums.AdGroupType.SEARCH_STANDARD,
        cpc_bid_micros: 5000000 
      }]);
      const adGroupId = adGroupResource.results[0].resource_name;

      // 🚀 Injecting the location directly into the keywords
      await customer.adGroupCriteria.create([
        { ad_group: adGroupId, status: enums.AdGroupCriterionStatus.ENABLED, keyword: { text: `${treatment.toLowerCase()} ${location.toLowerCase()}`, match_type: enums.KeywordMatchType.EXACT } },
        { ad_group: adGroupId, status: enums.AdGroupCriterionStatus.ENABLED, keyword: { text: `${treatment.toLowerCase()} near me`, match_type: enums.KeywordMatchType.PHRASE } }
      ]);

      // 🚀 Injecting location into Ad Copy
      const safeHeadline1 = `Top ${treatment} in ${location}`.substring(0, 30);
      const safeHeadline2 = `Book Dr. ${user.name ? user.name.split(' ')[0] : 'Now'}`.substring(0, 30);
      const safeHeadline3 = `${user.clinicName || 'Dental'} Experts`.substring(0, 30);
      
      const safeDesc1 = `Need a ${treatment}? ${user.clinicName || 'Our clinic'} in ${location} is accepting new patients. Book today!`.substring(0, 90);
      const safeDesc2 = `Expert dental care in your area. Comfortable, fast, and highly rated.`.substring(0, 90);

      await customer.adGroupAds.create([{
        ad_group: adGroupId,
        status: enums.AdGroupAdStatus.ENABLED,
        ad: {
          final_urls: [`https://zenithlab.com/booking/${user._id}`], 
          responsive_search_ad: {
            headlines: [{ text: safeHeadline1, pinned_field: enums.ServedAssetFieldType.HEADLINE_1 }, { text: safeHeadline2 }, { text: safeHeadline3 }],
            descriptions: [{ text: safeDesc1 }, { text: safeDesc2 }]
          }
        }
      }]);
    }

    res.json({ success: true, message: "Full campaign structure launched!" });
  } catch (error) {
    let errorMessage = "Unknown API Error";
    if (error?.errors && error.errors.length > 0) {
      const err = error.errors[0];
      const fieldPath = err.location?.field_path_elements?.map(e => e.field_name).join('.') || 'unknown_field';
      errorMessage = `${err.message} (Missing/Invalid Field: ${fieldPath})`;
    } else {
      errorMessage = error.message;
    }
    console.error("🔴 Detailed Campaign Launch Error:", JSON.stringify(error?.errors || error, null, 2));
    res.status(500).json({ error: errorMessage });
  }
};