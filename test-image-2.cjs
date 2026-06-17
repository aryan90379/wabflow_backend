async function test() {
  const axios = (await import('axios')).default;
  try {
    const url = `https://wsrv.nl/?url=${encodeURIComponent('https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png')}&w=500&q=80&output=jpg`;
    console.log("Fetching:", url);
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
    console.log("Success! Bytes:", Buffer.from(res.data).length);
  } catch (e) {
    console.error("Error:", e.message);
  }
}
test();
