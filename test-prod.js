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

    const getLinks = await axios.get(`https://api.wabflow.synqra.in/api/businesses/${businessId}/qr-links`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const linkId = getLinks.data.data[0].id;

    console.log("UPDATING LINK...");
    const updateRes = await axios.patch(`https://api.wabflow.synqra.in/api/businesses/${businessId}/qr-links/${linkId}`, {
      phoneNumber: "+1 555-0100"
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log(JSON.stringify(updateRes.data, null, 2));

  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
}

test();
