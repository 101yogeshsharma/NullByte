const https = require('https');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Read API key from command line argument or from saved config
let apiKey = process.argv[2]; // Pass as: node verify_key.js YOUR_API_KEY

if (!apiKey) {
  // Try to read from saved config
  try {
    const userDataPath = process.env.APPDATA || process.env.HOME;
    const configPath = path.join(userDataPath, 'nullbyte', 'config', 'settings.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      apiKey = config.apiKey;
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

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

console.log(`Checking API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);

https.get(url, (res) => {
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
          console.log('\n✅ Success! Available Models:');
          json.models.forEach(m => {
             if(m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')) {
                 console.log(` - ${m.name.replace('models/', '')} (${m.displayName})`);
             }
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
