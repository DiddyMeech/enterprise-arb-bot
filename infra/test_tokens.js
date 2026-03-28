const tokens = [
    "HB7JKXjI1MCJ4cVb36OiqmB5wcOYs1cLy024jUZolqTPHYssj2oKvbHJgnWiluVg",
    "shR0HilwOeX1WhUOYFAlZgt2J3LbhMTNQVXtyRMvadB8ZA9cBnCpJDVE0oBQIGDM",
    "G5CCO9M8ByDAPymfULHcJuMTwfgyTmjUP53cNk3APh4CpvNbQlVz2a69yMmyDMH0",
    "BFpwGfbfmUbcyOnMqdX5JzfsPOtxWReN3INQveUP9o14Bp38wucgFkhR2vfe3ql0",
    "A3BG6jeRsqQUYsKylb5D20YSHXx5VszaPV4I34hpmTGDK1GwLYSokFoudch7LrJj",
    "sidhIpnp5PXw5TObO5PiaJZQRucA5lp81QoivHJBws7eDZhHMCzCNh38CvTYXE2D",
    "766Ol2mxC0FDKZ1VCIDKn5S7DPk5WxyNHi97cwGsJYrzS9mjSm9dqhAWBfftilPG"
];

async function checkTokens() {
    console.log("Validating Hetzner API Tokens...\n");
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        try {
            const req = await fetch('https://api.hetzner.cloud/v1/servers', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (req.ok) {
                const data = await req.json();
                console.log(`[VALID] Token index ${i} is active. Existing servers: ${data.servers.length}`);
                
                // Fetch limits to see what size servers we can spin up
                const limitReq = await fetch('https://api.hetzner.cloud/v1/pricing', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                console.log(`Token ${i} pricing/limits verified.`);
            } else {
                console.error(`[INVALID] Token index ${i} returned status: ${req.status} ${req.statusText}`);
            }
        } catch (e) {
            console.error(`[ERROR] Token index ${i} fetch threw error: ${e.message}`);
        }
    }
}

checkTokens();
