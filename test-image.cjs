async function test() {
  const axios = (await import('axios')).default;
  try {
    const url = `https://wsrv.nl/?url=${encodeURIComponent('https://wabflow.b-cdn.net/businesses/6a2dea4a60be54f68e5a5ac1/6a2ded18104c276cf8ae9941.jpeg')}&w=500&q=80&output=jpg`;
    console.log("Fetching:", url);
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
    console.log("Success! Bytes:", Buffer.from(res.data).length);
  } catch (e) {
    console.error("Error:", e.message);
  }
}
test();
