import { env } from './src/config/env.js';
import { uploadToBunny } from './src/services/bunnyStorage.js';
async function run() {
  const buf = Buffer.from("hello world", "utf8");
  try {
    const url = await uploadToBunny(buf, "test-bunny.txt", "test-folder", "text/plain");
    console.log("Uploaded successfully:", url);
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
