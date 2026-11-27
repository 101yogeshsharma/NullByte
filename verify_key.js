const https = require('https');
const path = require('path');
const fs = require('fs');
const { curateModels } = require('./modelCatalog');

// Read API key from command line argument or from saved config
let apiKey = (process.argv[2] || '').trim(); // Pass as: node verify_key.js YOUR_API_KEY

if (!apiKey) {
  // Try to read from saved config
  try {
    const userDataPath = process.env.APPDATA || process.env.HOME;
    const configPath = path.join(userDataPath, 'nullbyte', 'config', 'settings.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      apiKey = (config.apiKey || '').trim();
      if (!apiKey) {
        console.error('❌ No API key found in config. Key is stored encrypted and cannot be read from this script.');
        console.error('   Usage: node verify_key.js YOUR_API_KEY');
        process.exit(1);
      }
    } else {
      console.error('❌ No API key provided and no config file found.');
      console.error('   Usage: node verify_key.js YOUR_API_KEY');
      process.exit(1);
    }
  } catch (e) {
    console.error('❌ No API key provided.');
    console.error('   Usage: node verify_key.js YOUR_API_KEY');
    process.exit(1);
  }
}

const options = {
  hostname: 'generativelanguage.googleapis.com',
  path: '/v1beta/models?pageSize=100',
  method: 'GET',
  headers: {
    'x-goog-api-key': apiKey
  }
};

console.log(`Checking API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);

https.get(options, (res) => {
  let data = '';

  console.log(`Status Code: ${res.statusCode}`);

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    if (res.statusCode === 200) {
      try {
        const json = JSON.parse(data);
        if (json.models) {
          const curated = curateModels(json.models);
          console.log('\n✅ Success! Active Curated Models:');
          curated.forEach(m => {
            console.log(` - ${m.id} (${m.displayName}) [${m.tier.toUpperCase()}]${m.isDefault ? ' (Default)' : ''}`);
          });
        } else {
          console.log('⚠️  Response JSON valid but no "models" array found.');
          console.log(data);
        }
      } catch (e) {
        console.error('❌ Error parsing JSON:', e.message);
      }
    } else {
      console.error(`❌ Request failed with status ${res.statusCode}`);
      console.error('Body:', data);
    }
  });
}).on('error', (err) => {
  console.error('❌ Network Error:', err.message);
});
