import Cloudflare from "cloudflare";
import "dotenv/config";

console.log('process.env.CLOUDFLARE_API_TOKEN=====>>>>', process.env.CLOUDFLARE_API_TOKEN);
const client = new Cloudflare({
  apiToken: 'O1k9WtlpmWZN0eDw4f1Fy-Pxk7qzrjnk8ZGirJH8',
});

async function testD1() {
  try {
    const dbs = await client.d1.database.list({
      account_id: process.env.CLOUDFLARE_ACCOUNT_ID,
    });
    console.log("Databases:", dbs);
  } catch (err) {
    console.error(err);
  }
}

testD1();
