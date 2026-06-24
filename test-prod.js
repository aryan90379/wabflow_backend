import axios from 'axios';

async function test() {
  try {
    const login = await axios.post('https://api.wabflow.synqra.in/api/auth/demo-login', {
      email: 'applereview@wabflow.com',
      password: 'WabFlowApple2026!'
    });
    const token = login.data.token;
    
    const getBusinesses = await axios.get('https://api.wabflow.synqra.in/api/businesses', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const businessId = getBusinesses.data.businesses[0]._id;
    console.log("Logged in. Business ID:", businessId);

    const getAccounts = await axios.get(`https://api.wabflow.synqra.in/api/businesses/${businessId}/whatsapp/accounts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const waAccountId = getAccounts.data.accounts[0]._id;

    console.log("CREATING LINK...");
    const createRes = await axios.post(`https://api.wabflow.synqra.in/api/businesses/${businessId}/qr-links`, {
      whatsappAccountId: waAccountId,
      title: "Test QR",
      phoneNumber: "+15550100"
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("CREATE LINK SUCCESS:");
    console.log(JSON.stringify(createRes.data, null, 2));

  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
}

test();
