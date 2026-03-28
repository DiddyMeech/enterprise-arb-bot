const https = require('https');

const tokens = [
    "HB7JKXjI1MCJ4cVb36OiqmB5wcOYs1cLy024jUZolqTPHYssj2oKvbHJgnWiluVg",
    "shR0HilwOeX1WhUOYFAlZgt2J3LbhMTNQVXtyRMvadB8ZA9cBnCpJDVE0oBQIGDM",
    "G5CCO9M8ByDAPymfULHcJuMTwfgyTmjUP53cNk3APh4CpvNbQlVz2a69yMmyDMH0",
    "BFpwGfbfmUbcyOnMqdX5JzfsPOtxWReN3INQveUP9o14Bp38wucgFkhR2vfe3ql0",
    "A3BG6jeRsqQUYsKylb5D20YSHXx5VszaPV4I34hpmTGDK1GwLYSokFoudch7LrJj",
    "sidhIpnp5PXw5TObO5PiaJZQRucA5lp81QoivHJBws7eDZhHMCzCNh38CvTYXE2D",
    "766Ol2mxC0FDKZ1VCIDKn5S7DPk5WxyNHi97cwGsJYrzS9mjSm9dqhAWBfftilPG"
];

function checkToken(token, index) {
    return new Promise((resolve) => {
        const req = https.get('https://api.hetzner.cloud/v1/servers', {
            headers: { 'Authorization': `Bearer ${token}` }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log(`[VALID] Token ${index} works. Servers active: ${JSON.parse(data).servers.length}`);
                } else {
                    console.log(`[INVALID] Token ${index} failed: ${res.statusCode}`);
                }
                resolve();
            });
        });
        req.on('error', (e) => {
            console.log(`[ERROR] Token ${index} error: ${e.message}`);
            resolve();
        });
        req.end();
    });
}

async function run() {
    console.log("Checking tokens via HTTPS module...");
    for (let i = 0; i < tokens.length; i++) {
        await checkToken(tokens[i], i);
    }
}
run();
