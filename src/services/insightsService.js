export const generateInsights = (totals, averages) => {
  const insights = [];

  // Insight 1: CPA Health
  if (averages.cpa > 0 && averages.cpa < 600) {
    insights.push({
      type: 'success',
      title: 'Excellent Patient Acquisition Cost',
      message: `You are acquiring leads at ₹${averages.cpa.toFixed(0)}. Consider increasing your daily budget to scale this success.`
    });
  } else if (averages.cpa >= 1000) {
    insights.push({
      type: 'warning',
      title: 'High CPA Detected',
      message: 'Your cost per lead is high. Check the Keywords tab to pause terms that are spending money without booking appointments.'
    });
  }

  // Insight 2: CTR Health (Relevance)
  if (averages.ctr > 0 && averages.ctr < 2.0 && totals.impressions > 500) {
    insights.push({
      type: 'warning',
      title: 'Low Ad Relevance',
      message: `Your CTR is only ${averages.ctr.toFixed(2)}%. Your ads are being seen, but not clicked. We recommend rewriting your headlines.`
    });
  } else if (averages.ctr >= 4.0) {
    insights.push({
      type: 'success',
      title: 'High Ad Engagement',
      message: `Your CTR is ${averages.ctr.toFixed(2)}%, well above the industry average. Your ad copy is resonating perfectly with patients.`
    });
  }

  // Fallback if no data yet
  if (totals.clicks === 0) {
    insights.push({ 
      type: 'info', 
      title: 'Gathering Data', 
      message: 'Your campaign is running. It usually takes 24-48 hours for Google to start showing your ads to local patients.' 
    });
  }

  return insights;
};